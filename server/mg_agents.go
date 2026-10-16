package main

// Agent updates from the inventory: the agents of the items linked to monitored hosts are
// listed with their version, and updated through the monitoring API (scope hosts:write),
// one item or every outdated agent at once.

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type agentState struct {
	AssetID       int64  `json:"asset_id"`
	Name          string `json:"name"`
	IntegrationID int64  `json:"integration_id"`
	HostID        int64  `json:"host_id"`
	Version       string `json:"version"`
	Latest        string `json:"latest"`
	Outdated      bool   `json:"outdated"`
	Connected     bool   `json:"connected"`
	Install       string `json:"install"`
	Action        any    `json:"action"` // last action of the host (update in progress, result)
}

// linkedAgents reads the monitored hosts once per integration and pairs them with their items.
func (s *Server) linkedAgents(ctx context.Context) ([]agentState, []string, error) {
	rows, err := s.rows(`SELECT id, display_name, hlm_integration_id, hlm_host_id FROM assets WHERE hlm_host_id IS NOT NULL ORDER BY display_name COLLATE NOCASE`)
	if err != nil {
		return nil, nil, err
	}
	hosts := map[int64]map[int64]map[string]any{}
	var errs []string
	out := []agentState{}
	for _, a := range rows {
		iid, _ := a["hlm_integration_id"].(int64)
		hid, _ := a["hlm_host_id"].(int64)
		if _, ok := hosts[iid]; !ok {
			hosts[iid] = map[int64]map[string]any{}
			i, err := s.getIntegration(iid, "hlm")
			var list []map[string]any
			if err == nil {
				err = hlmGet(ctx, i, "/hosts", &list)
			}
			if err != nil {
				errs = append(errs, err.Error())
			}
			for _, h := range list {
				if id, ok := h["id"].(float64); ok {
					hosts[iid][int64(id)] = h
				}
			}
		}
		h := hosts[iid][hid]
		if h == nil {
			continue
		}
		st := agentState{AssetID: a["id"].(int64), Name: fmtVal(a["display_name"]), IntegrationID: iid, HostID: hid, Action: h["action"]}
		st.Latest, _ = h["agent_latest"].(string)
		st.Outdated, _ = h["agent_outdated"].(bool)
		st.Connected, _ = h["connected"].(bool)
		if info, ok := h["info"].(map[string]any); ok {
			st.Version, _ = info["agent_version"].(string)
			st.Install, _ = info["install"].(string)
		}
		out = append(out, st)
	}
	return out, errs, nil
}

func (s *Server) mgAgents(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	list, errs, err := s.linkedAgents(ctx)
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"agents": list, "errors": errs})
}

// mgUpdateAgents updates the agents of the given items, or every outdated connected agent
// when no item is given (inventory button).
func (s *Server) mgUpdateAgents(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AssetIDs []int64 `json:"asset_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	logSkip(r) // one journal entry per agent below
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	list, _, err := s.linkedAgents(ctx)
	if err != nil {
		serverErr(w, err)
		return
	}
	want := map[int64]bool{}
	for _, id := range in.AssetIDs {
		want[id] = true
	}
	var done, failed []string
	for _, a := range list {
		if len(want) > 0 && !want[a.AssetID] || len(want) == 0 && !(a.Outdated && a.Connected) {
			continue
		}
		i, err := s.getIntegration(a.IntegrationID, "hlm")
		if err == nil {
			err = httpJSON(ctx, "POST", fmt.Sprintf("%s/api/v1/hosts/%d/agent-update", i.URL, a.HostID),
				map[string]string{"Authorization": "Bearer " + i.Config.TokenSecret, "Content-Type": "application/json"},
				strings.NewReader("{}"), i.Config.verify(true), 15*time.Second, nil)
		}
		if err != nil {
			msg := err.Error()
			if ie, ok := err.(*integrationError); ok && ie.status == 403 {
				msg = "le jeton du monitoring n'a pas le scope hosts:write"
			}
			failed = append(failed, a.Name+" : "+msg)
			continue
		}
		done = append(done, a.Name)
		s.mgLog(r, "asset", a.AssetID, "action", "Mise à jour de l'agent de « "+a.Name+" » demandée ("+a.Version+" → "+a.Latest+")")
	}
	msg := fmt.Sprintf("Mise à jour demandée pour %d agent(s).", len(done))
	if len(done) == 0 && len(failed) == 0 {
		msg = "Aucun agent à mettre à jour."
	}
	if len(failed) > 0 {
		msg += " Échecs : " + strings.Join(failed, " ; ")
	}
	writeJSON(w, 200, map[string]any{"ok": len(failed) == 0, "message": msg, "updated": done})
}
