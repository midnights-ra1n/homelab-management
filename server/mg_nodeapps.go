package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// mgNodeProxy relays the Node.js apps and firewall panels of an inventory item to the monitoring
// host it is linked to (/api/v1/hosts/{id}/action, /node-apps… and /iptables, see api.go), with the
// integration's account: the same panels as the monitoring's host page, from the management interface.
func (s *Server) mgNodeProxy(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	rest := r.PathValue("rest")
	if rest != "action" && rest != "iptables" && rest != "node-apps" && !strings.HasPrefix(rest, "node-apps/") || strings.Contains(rest, "..") {
		writeErr(w, 404, "Route inconnue")
		return
	}
	var name string
	var integ, host sql.NullInt64
	if err := s.db.QueryRow(`SELECT display_name, hlm_integration_id, hlm_host_id FROM assets WHERE id = ?`, id).Scan(&name, &integ, &host); err != nil || !integ.Valid || !host.Valid {
		writeErr(w, 404, "Élément non relié à un hôte du monitoring")
		return
	}
	i, err := s.getIntegration(integ.Int64, "hlm")
	if err != nil {
		writeErr(w, 404, "Intégration du monitoring introuvable")
		return
	}
	var body []byte
	timeout := time.Minute
	if r.Method != "GET" {
		if body, err = io.ReadAll(io.LimitReader(r.Body, 512<<10)); err != nil {
			writeErr(w, 400, "Requête illisible")
			return
		}
		timeout = 11 * time.Minute // creating an app clones and installs it (agent limit: 10 minutes)
	}
	if rest == "action" {
		var a struct{ Action string }
		if json.Unmarshal(body, &a) != nil || !strings.HasPrefix(a.Action, "node_") {
			writeErr(w, 400, "Seules les actions des applications Node.js passent par ici")
			return
		}
	}
	path := fmt.Sprintf("/hosts/%d/%s", host.Int64, rest)
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	var out json.RawMessage
	err = s.hlmCall(r.Context(), i, r.Method, path, string(body), timeout, &out)
	var ie *integrationError
	switch {
	case errors.As(err, &ie) && ie.status == 403:
		writeErr(w, 502, "Le compte du monitoring n'a pas le droit hosts:write")
		return
	case errors.As(err, &ie) && ie.status >= 400 && ie.status != 401 && json.Valid(ie.body):
		// The monitoring's own answer (400, 404, 409 need_key…), so the panel reacts as there.
		logSkip(r)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(ie.status)
		w.Write(ie.body)
		return
	case err != nil:
		writeErr(w, 502, err.Error())
		return
	}
	if r.Method != "GET" && !strings.HasSuffix(rest, "/preview") {
		if rest == "iptables" {
			var a map[string]string
			json.Unmarshal(body, &a)
			s.mgLog(r, "asset", id, "action", "Pare-feu de « "+name+" » : "+iptablesWhat(a))
		} else {
			s.mgLog(r, "asset", id, "action", "Applications Node.js de « "+name+" » : "+nodeProxyWhat(rest, body))
		}
	}
	writeJSON(w, 200, out)
}

// nodeProxyWhat words a relayed write for the journal.
func nodeProxyWhat(rest string, body []byte) string {
	app, _, _ := strings.Cut(strings.TrimPrefix(rest, "node-apps/"), "/")
	switch {
	case rest == "action":
		var a struct{ Action, Target string }
		json.Unmarshal(body, &a)
		return strings.TrimPrefix(a.Action, "node_") + " " + a.Target
	case rest == "node-apps":
		var a struct{ Name string }
		json.Unmarshal(body, &a)
		return "création de " + a.Name
	case strings.HasSuffix(rest, "/pause/preview"):
		return "aperçu de la page de pause de " + app
	case strings.HasSuffix(rest, "/pause"):
		return app + " mise en pause"
	case strings.HasSuffix(rest, "/resume"):
		return app + " relancée"
	case strings.HasSuffix(rest, "/env"):
		return "variables de " + app + " modifiées"
	default:
		return "deploy key de " + app
	}
}
