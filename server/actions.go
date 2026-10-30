package main

// Actions sent from the dashboard to a connected agent, and the latest agent release.

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket/wsjson"
)

var hostActions = map[string]bool{"check_updates": true, "apply_updates": true, "update_agent": true, "update_container": true,
	// node-app (base-node playbook), on one app; see nodeapps.go.
	"node_deploy": true, "node_pull": true, "node_update": true, "node_restart": true, "node_stop": true, "node_remove": true, "node_purge": true}

func (s *Server) setHostAction(id int64, action, state, message string) {
	s.setHostActionTarget(id, action, "", state, message)
}

// setHostActionTarget records an action; an empty target keeps the one of the same running action.
func (s *Server) setHostActionTarget(id int64, action, target, state, message string) {
	if len(message) > 4000 {
		message = message[len(message)-4000:]
	}
	if target == "" {
		var raw string
		var prev hostAction
		if s.db.QueryRow(`SELECT action FROM hosts WHERE id=?`, id).Scan(&raw) == nil && json.Unmarshal([]byte(raw), &prev) == nil && prev.Action == action {
			target = prev.Target
		}
	}
	b, _ := json.Marshal(hostAction{Action: action, Target: target, State: state, Message: message, At: time.Now().Unix()})
	if _, err := s.db.Exec(`UPDATE hosts SET action=? WHERE id=?`, string(b), id); err != nil {
		slog.Error("store host action", "err", err)
	}
}

func (s *Server) handleHostAction(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Action string `json:"action"`
		Target string `json:"target"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if !hostActions[req.Action] {
		writeErr(w, 400, "Action inconnue : check_updates, apply_updates, update_agent, update_container ou node_*")
		return
	}
	if strings.HasPrefix(req.Action, "node_") && !nodeAppName.MatchString(req.Target) {
		writeErr(w, 400, "Nom d'application invalide")
		return
	}
	if req.Target != "" {
		logName(r, req.Target+" ("+req.Action+")")
	}
	if req.Action == "update_container" && (req.Target == "" || len(req.Target) > 200 || strings.Trim(req.Target, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-") != "") {
		writeErr(w, 400, "Nom de conteneur invalide")
		return
	}
	s.sendHostAction(w, r, id, req.Action, req.Target)
}

// apiUpdateAgent asks a host's agent to update itself (scope hosts:write): the management
// role's "Mettre à jour l'agent" buttons go through here.
func (s *Server) apiUpdateAgent(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	s.sendHostAction(w, r, id, "update_agent", "")
}

// handleUpdateAllAgents asks every connected agent to update itself now instead of at its daily
// check. When the latest release is known only the outdated ones are asked, so a homelab
// behind one address does not spend GitHub's 60 anonymous requests an hour for nothing.
func (s *Server) handleUpdateAllAgents(w http.ResponseWriter, r *http.Request) {
	hosts, err := s.loadHosts("")
	if err != nil {
		serverErr(w, err)
		return
	}
	sent, busy := 0, 0
	for _, h := range hosts {
		if !h.Connected || (h.AgentLatest != "" && !h.Outdated) {
			continue
		}
		if a := h.Action; a != nil && (a.State == "pending" || a.State == "running") && time.Since(time.Unix(a.At, 0)) < 2*time.Hour {
			busy++
			continue
		}
		s.agentsMu.Lock()
		conn := s.agents[h.ID]
		s.agentsMu.Unlock()
		if conn == nil {
			continue
		}
		ctx, cancel := context.WithTimeout(conn.ctx, 5*time.Second)
		err := wsjson.Write(ctx, conn.conn, map[string]string{"type": "action", "action": "update_agent"})
		cancel()
		if err == nil {
			s.setHostAction(h.ID, "update_agent", "pending", "")
			sent++
		}
	}
	logName(r, strconv.Itoa(sent)+" agent(s)")
	events.publish("hosts")
	writeJSON(w, 200, map[string]int{"sent": sent, "busy": busy})
}

// sendHostAction sends one action to a connected agent and answers with the host.
func (s *Server) sendHostAction(w http.ResponseWriter, r *http.Request, id int64, action, target string) {
	hosts, err := s.loadHosts("WHERE id=?", id)
	if err != nil {
		serverErr(w, err)
		return
	}
	if len(hosts) == 0 {
		writeErr(w, 404, "Hôte introuvable")
		return
	}
	// One apt action at a time per host: an upgrade can take a while.
	if a := hosts[0].Action; a != nil && (a.State == "pending" || a.State == "running") && time.Since(time.Unix(a.At, 0)) < 2*time.Hour {
		writeErr(w, 409, "Une action est déjà en cours sur cet hôte")
		return
	}
	s.agentsMu.Lock()
	conn := s.agents[id]
	s.agentsMu.Unlock()
	if conn == nil {
		writeErr(w, 409, "L'agent n'est pas connecté")
		return
	}
	ctx, cancel := context.WithTimeout(conn.ctx, 10*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn.conn, map[string]string{"type": "action", "action": action, "target": target}); err != nil {
		writeErr(w, 502, "Impossible de joindre l'agent : "+err.Error())
		return
	}
	s.setHostActionTarget(id, action, target, "pending", "")
	s.handleGetHost(w, r)
}

// Latest agent release, from GitHub every 6 hours. Falls back to the hub's own version,
// since hub and agents are released together.
// agentRelease is the latest release of the repository (server and agent share it).
var agentRelease struct {
	sync.Mutex
	tag     string
	checked time.Time
}

func latestAgentVersion() string {
	agentRelease.Lock()
	defer agentRelease.Unlock()
	if agentRelease.tag != "" {
		return agentRelease.tag
	}
	if strings.HasPrefix(version, "v") {
		return version
	}
	return ""
}

// versionLess compares release tags like v0.1.12 numerically; unknown versions never compare as older.
func versionLess(a, b string) bool {
	pa, oka := parseVersion(a)
	pb, okb := parseVersion(b)
	if !oka || !okb {
		return false
	}
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] < pb[i]
		}
	}
	return false
}

func parseVersion(v string) ([3]int, bool) {
	var out [3]int
	parts := strings.Split(strings.TrimPrefix(v, "v"), ".")
	if !strings.HasPrefix(v, "v") || len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return out, false
		}
		out[i] = n
	}
	return out, true
}
