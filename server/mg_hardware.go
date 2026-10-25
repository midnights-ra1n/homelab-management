package main

// Hardware stock: machines (server, pc) and their components (CPU, RAM, disks…), with their state
// and the machine each component is installed in. A machine can be linked to an inventory item.

import (
	"cmp"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
)

var (
	hardwareCategories = []string{"server", "pc", "router", "wifi_router", "switch", "ap", "cpu", "ram", "disk", "motherboard", "gpu", "psu", "nic", "case", "cooling", "other"}
	// Equipment: linked to an inventory item, receives components.
	hardwareMachines = []string{"server", "pc", "router", "wifi_router", "switch", "ap"}
	hardwareStatuses = []string{"in_use", "stock", "ordered", "repair", "faulty", "retired"}
)

const hardwareSelect = `
  SELECT h.*, p.name AS parent_name, a.display_name AS asset_name,
    (SELECT COUNT(*) FROM hardware_items c WHERE c.parent_id = h.id) AS components
  FROM hardware_items h
  LEFT JOIN hardware_items p ON p.id = h.parent_id
  LEFT JOIN assets a ON a.id = h.asset_id`

// nextHLIDSQL is the next free homelab ID (HL-0001, HL-0002…), after the highest one in use.
const nextHLIDSQL = `(SELECT printf('HL-%04d', COALESCE(MAX(CAST(SUBSTR(hl_id, 4) AS INTEGER)), 0) + 1)
  FROM hardware_items WHERE UPPER(hl_id) GLOB 'HL-[0-9]*')`

var hlIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]*$`)

func nextHLID(q execer) (id string, err error) {
	err = q.QueryRow(`SELECT ` + nextHLIDSQL).Scan(&id)
	return
}

func (s *Server) mgListHardware(w http.ResponseWriter, r *http.Request) {
	rows, err := s.rows(hardwareSelect + ` ORDER BY h.name COLLATE NOCASE, h.id`)
	writeRows(w, rows, err)
}

// hardwareParentError checks that item id (of the given category) can go into machine parent.
func hardwareParentError(q execer, id int64, category string, parent int64) string {
	if slices.Contains(hardwareMachines, category) {
		return "Un équipement ne s'installe pas dans un autre"
	}
	var pc string
	if parent == id || q.QueryRow(`SELECT category FROM hardware_items WHERE id = ?`, parent).Scan(&pc) != nil || !slices.Contains(hardwareMachines, pc) {
		return "Choisis un équipement du stock"
	}
	return ""
}

// installedStatus: a component put in a machine is in use unless it is known to be broken.
func installedStatus(status string) string {
	if status == "stock" || status == "ordered" {
		return "in_use"
	}
	return status
}

func (s *Server) mgSaveHardware(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	cols := map[string]any{
		"name": f.required("name", "Le nom", 200), "category": f.enum("category", hardwareCategories...),
		"status": f.enum("status", hardwareStatuses...), "brand": f.text("brand", 100), "model": f.text("model", 200),
		"serial_number": f.text("serial_number", 100), "specs": f.text("specs", 500),
		"capacity_gb": f.optNum("capacity_gb", false, 0, 1e7), "location": f.text("location", 200),
		"vendor": f.text("vendor", 200), "purchase_date": f.optDate("purchase_date"),
		"purchase_price": f.optNum("purchase_price", false, 0, 1e7), "warranty_until": f.optDate("warranty_until"),
		"notes": f.text("notes", 5000), "tags": f.tags("tags"),
		"parent_id": f.optID("parent_id"), "asset_id": f.optID("asset_id"), "quantity": f.optNum("quantity", true, 1, 100000),
		"hl_id": f.text("hl_id", 40),
	}
	if v := cols["hl_id"].(string); v != "" {
		var other string
		if !hlIDRe.MatchString(v) {
			f.fail("hl_id", "Lettres, chiffres et . _ / - seulement")
		} else if s.db.QueryRow(`SELECT name FROM hardware_items WHERE hl_id = ? COLLATE NOCASE AND id != ?`, v, id).Scan(&other) == nil {
			f.fail("hl_id", "ID déjà attribué à « "+other+" »")
		}
	} else if next, err := nextHLID(s.db); err == nil {
		cols["hl_id"] = next
	} else {
		serverErr(w, err)
		return
	}
	if cols["quantity"] == nil {
		cols["quantity"] = int64(1)
	}
	category := cols["category"].(string)
	if parent, ok := cols["parent_id"].(int64); ok && f.valid() {
		if msg := hardwareParentError(s.db, id, category, parent); msg != "" {
			f.fail("parent_id", msg)
		}
		cols["status"] = installedStatus(cols["status"].(string))
	}
	if !slices.Contains(hardwareMachines, category) {
		cols["asset_id"] = nil // only machines map to an inventory item
	} else if a, ok := cols["asset_id"].(int64); ok {
		var n int
		if s.db.QueryRow(`SELECT COUNT(*) FROM assets WHERE id = ?`, a).Scan(&n); n == 0 {
			f.fail("asset_id", "Élément introuvable")
		}
	}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	var err error
	if id > 0 {
		if slices.Contains(hardwareMachines, category) {
			var n int
			// A machine keeps no parent; its components stay inside, so it cannot become a component.
			s.db.QueryRow(`SELECT COUNT(*) FROM hardware_items WHERE parent_id = ?`, id).Scan(&n)
			_ = n
		} else {
			var n int
			if s.db.QueryRow(`SELECT COUNT(*) FROM hardware_items WHERE parent_id = ?`, id).Scan(&n); n > 0 {
				formFail(w, "category", "Retire d'abord les composants installés dans cette machine")
				return
			}
		}
		if err = s.updateRow(s.db, "hardware_items", id, cols); err == nil {
			s.mgLog(r, "hardware", id, "update", fmt.Sprintf("Modification du matériel « %s »", cols["name"]))
		}
	} else if id, err = s.insertRow(s.db, "hardware_items", cols); err == nil {
		summary := fmt.Sprintf("Nouveau matériel « %s »", cols["name"])
		if a, ok := cols["asset_id"].(int64); ok && f.check("import_components") {
			var n int
			if n, err = s.importAssetComponents(id, a); n > 0 {
				summary += fmt.Sprintf(", %d composant(s) repris de l'inventaire", n)
			}
		}
		s.mgLog(r, "hardware", id, "create", summary)
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if r.PathValue("id") != "" {
		formOK(w, "Matériel mis à jour.")
	} else {
		formOK(w, "Matériel ajouté au stock.")
	}
}

// mgInstallHardware puts a component in a machine ({"parent_id": n}) or takes it out (null).
func (s *Server) mgInstallHardware(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		ParentID *int64 `json:"parent_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	var name, category, status string
	var quantity int64
	var oldParent sql.NullString
	err := s.db.QueryRow(`SELECT h.name, h.category, h.status, h.quantity, p.name FROM hardware_items h
	  LEFT JOIN hardware_items p ON p.id = h.parent_id WHERE h.id = ?`, id).Scan(&name, &category, &status, &quantity, &oldParent)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "Matériel introuvable")
		return
	} else if err != nil {
		serverErr(w, err)
		return
	}
	if in.ParentID == nil {
		if status == "in_use" {
			status = "stock"
		}
		if _, err := s.db.Exec(`UPDATE hardware_items SET parent_id = NULL, status = ?, updated_at = datetime('now') WHERE id = ?`, status, id); err != nil {
			serverErr(w, err)
			return
		}
		if oldParent.Valid {
			s.mgLog(r, "hardware", id, "update", fmt.Sprintf("« %s » retiré de « %s »", name, oldParent.String))
		} else {
			logSkip(r)
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if msg := hardwareParentError(s.db, id, category, *in.ParentID); msg != "" {
		writeErr(w, 400, msg)
		return
	}
	if quantity > 1 && !oldParent.Valid {
		// One piece of a stock lot: it gets its own row in the machine, the rest stays in stock.
		if err := s.splitInstall(id, *in.ParentID, installedStatus(status)); err != nil {
			serverErr(w, err)
			return
		}
	} else if _, err := s.db.Exec(`UPDATE hardware_items SET parent_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
		*in.ParentID, installedStatus(status), id); err != nil {
		serverErr(w, err)
		return
	}
	var parent string
	s.db.QueryRow(`SELECT name FROM hardware_items WHERE id = ?`, *in.ParentID).Scan(&parent)
	s.mgLog(r, "hardware", id, "update", fmt.Sprintf("« %s » installé dans « %s »", name, parent))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) splitInstall(id, parent int64, status string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO hardware_items (name, category, status, brand, model, specs, capacity_gb, parent_id,
	    location, vendor, purchase_date, purchase_price, warranty_until, notes, tags, quantity, hl_id)
	  SELECT name, category, ?, brand, model, specs, capacity_gb, ?, location, vendor, purchase_date, purchase_price,
	    warranty_until, notes, tags, 1, `+nextHLIDSQL+` FROM hardware_items WHERE id = ?`, status, parent, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE hardware_items SET quantity = quantity - 1, updated_at = datetime('now') WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// mgDeleteHardware deletes an item; the components of a deleted machine go back to the stock.
func (s *Server) mgDeleteHardware(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	var name string
	if err := tx.QueryRow(`SELECT name FROM hardware_items WHERE id = ?`, id).Scan(&name); err != nil {
		writeErr(w, 404, "Introuvable")
		return
	}
	res, err := tx.Exec(`UPDATE hardware_items SET parent_id = NULL, updated_at = datetime('now'),
	  status = CASE WHEN status = 'in_use' THEN 'stock' ELSE status END WHERE parent_id = ?`, id)
	if err != nil {
		serverErr(w, err)
		return
	}
	if _, err := tx.Exec(`DELETE FROM hardware_items WHERE id = ?`, id); err != nil {
		serverErr(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	summary := fmt.Sprintf("Suppression du matériel « %s »", name)
	if n, _ := res.RowsAffected(); n > 0 {
		summary += fmt.Sprintf(", %d composant(s) remis en stock", n)
	}
	s.mgLog(r, "hardware", id, "delete", summary)
	w.WriteHeader(http.StatusNoContent)
}

// mgDuplicateHardware copies an item (several identical RAM sticks…) without serial or placement.
func (s *Server) mgDuplicateHardware(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	res, err := s.db.Exec(`INSERT INTO hardware_items (name, category, status, brand, model, specs, capacity_gb,
	    location, vendor, purchase_date, purchase_price, warranty_until, notes, tags, quantity, hl_id)
	  SELECT name, category, CASE WHEN status = 'in_use' THEN 'stock' ELSE status END, brand, model, specs, capacity_gb,
	    location, vendor, purchase_date, purchase_price, warranty_until, notes, tags, quantity, `+nextHLIDSQL+`
	  FROM hardware_items WHERE id = ?`, id)
	if err != nil {
		serverErr(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, 404, "Introuvable")
		return
	}
	nid, _ := res.LastInsertId()
	var name string
	s.db.QueryRow(`SELECT name FROM hardware_items WHERE id = ?`, nid).Scan(&name)
	s.mgLog(r, "hardware", nid, "create", fmt.Sprintf("Copie du matériel « %s »", name))
	w.WriteHeader(http.StatusNoContent)
}

// importAssetComponents adds to machine the CPU, RAM, GPU, disks and network cards that the
// inventory item records (filled by hand or by the monitoring agent), as in-use components.
func (s *Server) importAssetComponents(machine, asset int64) (int, error) {
	var cpu, ramType, gpu, disks, nics, location string
	var sockets, cores, threads sql.NullInt64
	var ram sql.NullFloat64
	if err := s.db.QueryRow(`SELECT cpu_model, cpu_sockets, cpu_cores, cpu_threads, ram_gb, ram_type, gpu, disks, nics, location
	  FROM assets WHERE id = ?`, asset).Scan(&cpu, &sockets, &cores, &threads, &ram, &ramType, &gpu, &disks, &nics, &location); err != nil {
		return 0, err
	}
	type part struct {
		name, category, specs string
		gb                    any
		qty                   int64
	}
	var parts []part
	if cpu != "" {
		var spec []string
		if cores.Valid {
			spec = append(spec, fmt.Sprintf("%d cœurs", cores.Int64))
		}
		if threads.Valid {
			spec = append(spec, fmt.Sprintf("%d threads", threads.Int64))
		}
		qty := int64(1)
		if sockets.Valid && sockets.Int64 > 1 {
			qty = sockets.Int64
		}
		parts = append(parts, part{cpu, "cpu", strings.Join(spec, ", "), nil, qty})
	}
	if ram.Valid && ram.Float64 > 0 {
		parts = append(parts, part{strings.TrimSpace(fmt.Sprintf("RAM %s %s", ramType, formatGo(ram.Float64))), "ram", "Capacité totale de la machine", ram.Float64, 1})
	}
	if gpu != "" {
		parts = append(parts, part{gpu, "gpu", "", nil, 1})
	}
	var ds []struct {
		Name       string   `json:"name"`
		Type       string   `json:"type"`
		CapacityGB *float64 `json:"capacity_gb"`
	}
	json.Unmarshal([]byte(disks), &ds)
	for _, d := range ds {
		var gb any
		if d.CapacityGB != nil {
			gb = *d.CapacityGB
		}
		parts = append(parts, part{cmp.Or(d.Name, "Disque"), "disk", strings.ToUpper(d.Type), gb, 1})
	}
	var ns []struct{ Name, MAC, Speed string }
	json.Unmarshal([]byte(nics), &ns)
	for _, n := range ns {
		parts = append(parts, part{cmp.Or(n.Name, "Carte réseau"), "nic", strings.Trim(strings.Join([]string{n.Speed, n.MAC}, " · "), " ·"), nil, 1})
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	for _, p := range parts {
		id, err := nextHLID(tx)
		if err != nil {
			return 0, err
		}
		if _, err := s.insertRow(tx, "hardware_items", map[string]any{"name": clip(p.name, 200), "category": p.category, "status": "in_use",
			"specs": clip(p.specs, 500), "capacity_gb": p.gb, "quantity": p.qty, "parent_id": machine, "location": location, "hl_id": id}); err != nil {
			return 0, err
		}
	}
	return len(parts), tx.Commit()
}

func formatGo(gb float64) string {
	if gb >= 1024 && int(gb)%1024 == 0 {
		return fmt.Sprintf("%d To", int(gb)/1024)
	}
	return strings.TrimSuffix(strings.TrimSuffix(fmt.Sprintf("%.1f", gb), "0"), ".") + " Go"
}
