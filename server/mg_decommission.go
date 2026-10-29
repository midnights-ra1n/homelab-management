package main

// Decommissioning: removing a host from the inventory step by step. Starting it sets the
// item to "decommissioned" and stores a checklist built from what the item is linked to
// (monitoring host, hosted items, domains, firewall rules, shortcuts, Proxmox guest, hardware).
// Automatic steps are run from here; manual ones are ticked. The last step deletes the item
// and frees its addresses. Every step is written to the journal.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

var decomMu sync.Mutex

type decomStep struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Hint   string `json:"hint,omitempty"`
	Auto   bool   `json:"auto"` // run by the server ("Exécuter"), else ticked by hand
	Done   bool   `json:"done"`
	Result string `json:"result,omitempty"`
}

type decommission struct {
	StartedAt      string      `json:"started_at"`
	PreviousStatus string      `json:"previous_status"`
	Reason         string      `json:"reason,omitempty"`
	Steps          []decomStep `json:"steps"`
}

func (s *Server) loadDecom(id int64) (*decommission, string, error) {
	var raw, name string
	if err := s.db.QueryRow(`SELECT decommission, display_name FROM assets WHERE id = ?`, id).Scan(&raw, &name); err != nil {
		return nil, "", errNotFound
	}
	if raw == "" {
		return nil, name, nil
	}
	var d decommission
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		return nil, name, nil
	}
	return &d, name, nil
}

func (s *Server) saveDecom(id int64, d *decommission) error {
	b, _ := json.Marshal(d)
	_, err := s.db.Exec(`UPDATE assets SET decommission = ?, updated_at = datetime('now') WHERE id = ?`, string(b), id)
	return err
}

func (s *Server) count(q string, args ...any) int {
	var n int
	s.db.QueryRow(q, args...).Scan(&n)
	return n
}

func (s *Server) decomSteps(id int64) []decomStep {
	a, _ := s.row(`SELECT kind, hlm_host_id, proxmox_vmid FROM assets WHERE id = ?`, id)
	idStr := fmt.Sprint(id)
	steps := []decomStep{
		{Key: "backup", Label: "Sauvegarder les données et la configuration à conserver"},
		{Key: "services", Label: "Arrêter les services et prévenir leurs utilisateurs"},
	}
	if a["hlm_host_id"] != nil {
		steps = append(steps, decomStep{Key: "monitoring", Auto: true, Label: "Retirer l'hôte du monitoring",
			Hint: "Supprime l'hôte dans Midnights Monitoring (jeton avec le scope hosts:write). Désinstallez ensuite l'agent : curl -fsSL https://raw.githubusercontent.com/midnights-ra1n/homelab-management/stable/agent/uninstall.sh | sudo sh (sur un Proxmox, aussi dans ses conteneurs LXC), apt remove hlm-agent ou hlm_agent_state: absent avec Ansible."})
	} else {
		steps = append(steps, decomStep{Key: "agent", Label: "Désinstaller l'agent de monitoring s'il est présent"})
	}
	if n := s.count(`SELECT COUNT(*) FROM assets WHERE parent_id = ?`, id); n > 0 {
		steps = append(steps, decomStep{Key: "children", Auto: true, Label: fmt.Sprintf("Réaffecter les %d élément(s) hébergé(s)", n),
			Hint: "Ils sont rattachés à l'hôte parent de cet élément (ou détachés s'il n'en a pas)."})
	}
	if n := s.count(`SELECT COUNT(*) FROM domains WHERE target_asset_id = ? OR proxy_asset_id = ?`, id, id); n > 0 {
		steps = append(steps, decomStep{Key: "domains", Auto: true, Label: fmt.Sprintf("Supprimer les %d nom(s) de domaine liés", n),
			Hint: "Pensez aussi aux enregistrements DNS et à la configuration du reverse proxy."})
	}
	if n := s.count(`SELECT COUNT(*) FROM firewall_rules WHERE (src_type = 'asset' AND src_value = ?) OR (dst_type = 'asset' AND dst_value = ?)`, idStr, idStr) +
		s.count(`SELECT COUNT(*) FROM shortcuts WHERE asset_id = ?`, id); n > 0 {
		steps = append(steps, decomStep{Key: "links", Auto: true, Label: fmt.Sprintf("Supprimer les %d règle(s) de pare-feu et raccourci(s) liés", n)})
	}
	switch a["kind"] {
	case "vm", "lxc":
		hint := ""
		if a["proxmox_vmid"] != nil {
			hint = fmt.Sprintf("VMID %v : supprimez l'invité et ses disques (et ses sauvegardes si elles ne servent plus).", a["proxmox_vmid"])
		}
		steps = append(steps, decomStep{Key: "guest", Label: "Supprimer la machine dans l'hyperviseur", Hint: hint})
	case "physical", "network":
		steps = append(steps, decomStep{Key: "wipe", Label: "Effacer les disques et retirer le matériel"})
	case "docker":
		steps = append(steps, decomStep{Key: "container", Label: "Supprimer le conteneur, ses volumes et son image"})
	}
	return steps
}

func (s *Server) mgDecomStart(w http.ResponseWriter, r *http.Request) {
	decomMu.Lock() // the checklist is read, changed and written back: one change at a time
	defer decomMu.Unlock()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	d, name, err := s.loadDecom(id)
	if err != nil {
		writeErr(w, 404, "Élément introuvable")
		return
	}
	if d != nil {
		writeErr(w, 409, "Décommissionnement déjà en cours")
		return
	}
	var prev string
	s.db.QueryRow(`SELECT status FROM assets WHERE id = ?`, id).Scan(&prev)
	d = &decommission{StartedAt: time.Now().UTC().Format("2006-01-02 15:04:05"), PreviousStatus: prev,
		Reason: clip(strings.TrimSpace(in.Reason), 500), Steps: s.decomSteps(id)}
	if err := s.saveDecom(id, d); err != nil {
		serverErr(w, err)
		return
	}
	s.db.Exec(`UPDATE assets SET status = 'decommissioned', status_source = '' WHERE id = ?`, id)
	summary := "Décommissionnement de « " + name + " » commencé"
	if d.Reason != "" {
		summary += " : " + d.Reason
	}
	s.mgLog(r, "asset", id, "decommission", summary)
	writeJSON(w, 200, d)
}

func (s *Server) mgDecomCancel(w http.ResponseWriter, r *http.Request) {
	decomMu.Lock() // the checklist is read, changed and written back: one change at a time
	defer decomMu.Unlock()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, name, err := s.loadDecom(id)
	if err != nil || d == nil {
		writeErr(w, 404, "Aucun décommissionnement en cours")
		return
	}
	prev := d.PreviousStatus
	if prev == "" || prev == "decommissioned" {
		prev = "offline"
	}
	s.db.Exec(`UPDATE assets SET decommission = '', status = ?, updated_at = datetime('now') WHERE id = ?`, prev, id)
	s.mgLog(r, "asset", id, "decommission", "Décommissionnement de « "+name+" » annulé")
	w.WriteHeader(http.StatusNoContent)
}

// mgDecomStep ticks a manual step ({key, done}) or runs an automatic one ({key, run: true}).
func (s *Server) mgDecomStep(w http.ResponseWriter, r *http.Request) {
	decomMu.Lock() // the checklist is read, changed and written back: one change at a time
	defer decomMu.Unlock()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Key  string `json:"key"`
		Done bool   `json:"done"`
		Run  bool   `json:"run"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	d, name, err := s.loadDecom(id)
	if err != nil || d == nil {
		writeErr(w, 404, "Aucun décommissionnement en cours")
		return
	}
	var step *decomStep
	for k := range d.Steps {
		if d.Steps[k].Key == in.Key {
			step = &d.Steps[k]
		}
	}
	if step == nil {
		writeErr(w, 400, "Étape inconnue")
		return
	}
	if in.Run {
		if !step.Auto {
			writeErr(w, 400, "Cette étape se fait à la main")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		res, err := s.runDecomStep(ctx, id, in.Key)
		if err != nil {
			logSkip(r)
			writeJSON(w, 200, map[string]any{"ok": false, "message": err.Error(), "decommission": d})
			return
		}
		step.Done, step.Result = true, res
		s.mgLog(r, "asset", id, "decommission", "« "+name+" » — "+step.Label+" : "+res)
	} else {
		step.Done = in.Done
		state := "faite"
		if !in.Done {
			state = "à refaire"
		}
		s.mgLog(r, "asset", id, "decommission", "« "+name+" » — "+step.Label+" : "+state)
	}
	if err := s.saveDecom(id, d); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "decommission": d})
}

func (s *Server) runDecomStep(ctx context.Context, id int64, key string) (string, error) {
	idStr := fmt.Sprint(id)
	switch key {
	case "monitoring":
		var integ, host int64
		if err := s.db.QueryRow(`SELECT hlm_integration_id, hlm_host_id FROM assets WHERE id = ?`, id).Scan(&integ, &host); err != nil {
			return "", integrationErr("L'élément n'est plus relié au monitoring")
		}
		i, err := s.getIntegration(integ, "hlm")
		if err != nil {
			return "", err
		}
		err = s.hlmCall(ctx, i, "DELETE", fmt.Sprintf("/hosts/%d", host), "", 10*time.Second, nil)
		var ie *integrationError
		if err != nil && !(errors.As(err, &ie) && ie.status == 404) { // already gone: fine
			if ie != nil && ie.status == 403 {
				return "", integrationErr("Le jeton du monitoring n'a pas le scope hosts:write")
			}
			return "", err
		}
		s.db.Exec(`UPDATE assets SET hlm_integration_id = NULL, hlm_host_id = NULL WHERE id = ?`, id)
		return "hôte supprimé de « " + i.Name + " »", nil
	case "children":
		res, err := s.db.Exec(`UPDATE assets SET parent_id = (SELECT parent_id FROM assets WHERE id = ?), updated_at = datetime('now') WHERE parent_id = ?`, id, id)
		if err != nil {
			return "", err
		}
		n, _ := res.RowsAffected()
		return fmt.Sprintf("%d élément(s) réaffecté(s)", n), nil
	case "domains":
		res, err := s.db.Exec(`DELETE FROM domains WHERE target_asset_id = ? OR proxy_asset_id = ?`, id, id)
		if err != nil {
			return "", err
		}
		n, _ := res.RowsAffected()
		return fmt.Sprintf("%d domaine(s) supprimé(s)", n), nil
	case "links":
		r1, err := s.db.Exec(`DELETE FROM firewall_rules WHERE (src_type = 'asset' AND src_value = ?) OR (dst_type = 'asset' AND dst_value = ?)`, idStr, idStr)
		if err != nil {
			return "", err
		}
		r2, err := s.db.Exec(`DELETE FROM shortcuts WHERE asset_id = ?`, id)
		if err != nil {
			return "", err
		}
		a, _ := r1.RowsAffected()
		b, _ := r2.RowsAffected()
		return fmt.Sprintf("%d règle(s) et %d raccourci(s) supprimé(s)", a, b), nil
	}
	return "", integrationErr("Étape inconnue")
}

// mgDecomFinish deletes the item once every step is done; its addresses are freed with it.
func (s *Server) mgDecomFinish(w http.ResponseWriter, r *http.Request) {
	decomMu.Lock() // the checklist is read, changed and written back: one change at a time
	defer decomMu.Unlock()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, name, err := s.loadDecom(id)
	if err != nil || d == nil {
		writeErr(w, 404, "Aucun décommissionnement en cours")
		return
	}
	for _, st := range d.Steps {
		if !st.Done {
			writeErr(w, 409, "Étape restante : "+st.Label)
			return
		}
	}
	var ips []string
	if rows, err := s.rows(`SELECT address FROM ip_addresses WHERE asset_id = ?`, id); err == nil {
		for _, r := range rows {
			ips = append(ips, fmtVal(r["address"]))
		}
	}
	if _, err := s.db.Exec(`DELETE FROM assets WHERE id = ?`, id); err != nil {
		serverErr(w, err)
		return
	}
	summary := "Décommissionnement terminé : « " + name + " » supprimé de l'inventaire"
	if len(ips) > 0 {
		summary += ", adresse(s) libérée(s) : " + strings.Join(ips, ", ")
	}
	s.mgLog(r, "asset", id, "delete", summary)
	formRedirect(w, "/inventaire", 0)
}
