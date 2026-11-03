package main

// iptables of any host running the agent, through its root helper (agent/iptables-helper.sh, which
// checks every value: no second copy of the rules here). The requests go through askNode.

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Fields of a change, sent as key=value lines; values on one line (the helper reads line by line).
var iptablesFields = []string{"op", "family", "chain", "position", "proto", "dport", "source", "iface", "target", "comment", "rule", "policy"}

func iptablesPayload(req map[string]string) (string, bool) {
	var b strings.Builder
	for _, k := range iptablesFields {
		if strings.ContainsAny(req[k], "\r\n") {
			return "", false
		}
		if req[k] != "" {
			b.WriteString(k + "=" + req[k] + "\n")
		}
	}
	return b.String(), true
}

// iptablesWhat words a change for the journal.
func iptablesWhat(req map[string]string) string {
	v := "IPv" + req["family"]
	switch req["op"] {
	case "add":
		return strings.Join(strings.Fields("règle ajoutée ("+v+") "+req["chain"]+" "+req["proto"]+" "+req["dport"]+" "+req["source"]+" "+req["target"]), " ")
	case "delete":
		return "règle supprimée (" + v + ") " + req["rule"]
	case "policy":
		return "politique de " + req["chain"] + " (" + v + ") : " + req["policy"]
	case "save":
		return "règles enregistrées (netfilter-persistent save)"
	case "install":
		return "installation d'iptables-persistent"
	}
	return req["op"]
}

// GET /api/hosts/{id}/iptables: rules, policies and state of netfilter-persistent.
func (s *Server) handleIptables(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if res, ok := s.askNode(w, r, id, "", 45*time.Second, "fw-list"); ok {
		if !json.Valid([]byte(res.Text)) {
			writeErr(w, 502, "Réponse illisible de l'hôte (agent trop ancien ?)")
			return
		}
		writeJSON(w, 200, json.RawMessage(res.Text))
	}
}

// POST /api/hosts/{id}/iptables {op, …}: add, delete, policy, save or install. The rules take
// effect at once; only save makes them survive a reboot.
func (s *Server) handleIptablesWrite(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req map[string]string
	if !readJSONLimit(w, r, &req, 8<<10) {
		return
	}
	logName(r, iptablesWhat(req))
	switch req["op"] {
	case "save", "install":
		if res, ok := s.askNode(w, r, id, "", 6*time.Minute, "fw-"+req["op"]); ok {
			writeJSON(w, 200, map[string]string{"output": res.Text})
		}
	case "add", "delete", "policy":
		payload, valid := iptablesPayload(req)
		if !valid {
			writeErr(w, 400, "Valeur invalide")
			return
		}
		if _, ok := s.askNode(w, r, id, payload, 30*time.Second, "fw-apply"); !ok {
			return
		}
		// Reaching the agent again proves the change did not cut it off; otherwise the helper
		// restores the rules by itself after 60 s.
		if _, ok := s.askNode(w, r, id, "", 30*time.Second, "fw-confirm"); ok {
			writeJSON(w, 200, map[string]bool{"ok": true})
		}
	default:
		writeErr(w, 400, "Opération inconnue")
	}
}
