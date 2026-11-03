package main

// Hierarchy of the hosts: a Proxmox node above the VMs and LXC containers it runs.
// The node's agent reports the guests it sees on its bridges (guest MAC addresses learned on
// each tapID / vethID port), so the hub places a guest under its node by MAC address, without
// anything to install in the guests. A parent chosen by hand is never changed.

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"
)

// Wire format shared with agent/src/pve.rs. Keep both in sync.
type pveReport struct {
	Guests []pveGuest `json:"guests"`
	CTs    []int      `json:"cts,omitempty"` // every CT ID of the cluster, from the root helper hlm-agent-lxc
}

type pveGuest struct {
	ID   int      `json:"id"`
	Kind string   `json:"kind"` // ct or vm
	MACs []string `json:"macs"`
}

type hostLink struct {
	id     int64
	info   agentInfo
	pve    pveReport
	parent sql.NullInt64
	manual bool
	vmid   int
}

func (s *Server) hostLinks() ([]hostLink, error) {
	rows, err := s.db.Query(`SELECT id, info, pve, parent_id, parent_manual, vmid FROM hosts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []hostLink
	for rows.Next() {
		var l hostLink
		var info, pve string
		if err := rows.Scan(&l.id, &info, &pve, &l.parent, &l.manual, &l.vmid); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(info), &l.info)
		json.Unmarshal([]byte(pve), &l.pve)
		out = append(out, l)
	}
	return out, rows.Err()
}

func shortName(n string) string { return strings.ToLower(strings.Split(n, ".")[0]) }

// createsCycle: would placing child under parent make child its own ancestor?
func createsCycle(parentOf map[int64]int64, child, parent int64) bool {
	for p, n := parent, 0; p != 0 && n < 64; p, n = parentOf[p], n+1 {
		if p == child {
			return true
		}
	}
	return false
}

// linkGuests places every host without a manual parent under the Proxmox node that runs it:
// by MAC address, else by the PVE_NODE / PVE_CTID that install.sh (LXC=all) gives containers.
// A host that matches nothing keeps its current parent (a stopped guest leaves the bridges).
func (s *Server) linkGuests() error {
	hosts, err := s.hostLinks()
	if err != nil {
		return err
	}
	type seen struct {
		node int64
		vmid int
	}
	byMAC := map[string]seen{}
	byName := map[string]int64{}
	parentOf := map[int64]int64{}
	for _, h := range hosts {
		for _, g := range h.pve.Guests {
			for _, m := range g.MACs {
				byMAC[strings.ToLower(m)] = seen{h.id, g.ID}
			}
		}
		if h.info.Hostname != "" {
			byName[shortName(h.info.Hostname)] = h.id
		}
		if h.parent.Valid {
			parentOf[h.id] = h.parent.Int64
		}
	}
	for _, h := range hosts {
		if h.manual {
			continue
		}
		var parent int64
		vmid := h.info.PveCTID
		var macs []string
		for _, n := range h.info.NICs {
			macs = append(macs, n.MAC)
		}
		for _, ip := range h.info.IPs {
			macs = append(macs, ip.MAC)
		}
		for _, m := range macs {
			if g, ok := byMAC[strings.ToLower(m)]; ok && m != "" && g.node != h.id {
				parent, vmid = g.node, g.vmid
				break
			}
		}
		if parent == 0 && h.info.PveCTID > 0 && h.info.PveNode != "" {
			parent = byName[shortName(h.info.PveNode)]
		}
		if parent == 0 || parent == h.id || createsCycle(parentOf, h.id, parent) || (parent == h.parent.Int64 && vmid == h.vmid) {
			continue
		}
		if _, err := s.db.Exec(`UPDATE hosts SET parent_id=?, vmid=? WHERE id=?`, parent, vmid, h.id); err != nil {
			return err
		}
		parentOf[h.id] = parent
	}
	return nil
}

// pruneCTs deletes the hosts of the LXC containers removed from Proxmox: placed under this
// node, with a CT ID no longer in the cluster and an agent that is not connected.
func (s *Server) pruneCTs(node int64, nodeName string, cts []int) {
	// An empty list is more likely a glitch than a cluster without any container: keep everything.
	if len(cts) == 0 {
		return
	}
	hosts, err := s.hostLinks()
	if err != nil {
		slog.Error("prune containers", "err", err)
		return
	}
	for _, h := range hosts {
		// Hosts made by lxcToken that never connected have no info yet.
		if h.parent.Int64 != node || h.vmid <= 0 || (h.info.Virtualization != "lxc" && h.info.Hostname != "") || slices.Contains(cts, h.vmid) {
			continue
		}
		s.agentsMu.Lock()
		_, connected := s.agents[h.id]
		s.agentsMu.Unlock()
		if connected {
			continue
		}
		var name string
		if s.db.QueryRow(`SELECT name FROM hosts WHERE id=?`, h.id).Scan(&name) != nil {
			continue
		}
		if _, err := s.db.Exec(`DELETE FROM hosts WHERE id=?`, h.id); err != nil {
			slog.Error("prune container", "err", err)
			continue
		}
		s.logEvent("Proxmox "+nodeName, "host", h.id, "delete", fmt.Sprintf("Hôte « %s » supprimé : CT %d supprimé de Proxmox", name, h.vmid))
		slog.Info("container removed from Proxmox, host deleted", "host_id", h.id, "name", name, "ctid", h.vmid)
	}
}

// lxcToken gives a new container of a Proxmox node its own agent token, instead of a shared
// enrollment token: the node's root helper (lxc-sync.sh) asks through the node's agent, and
// installs the agent in the container with it. The container must be in the node's latest
// report; its host is reused (token replaced) unless its agent is connected.
func (s *Server) lxcToken(node int64, nodeName string, ct int, ctName string) (string, error) {
	var raw string
	var rep pveReport
	if err := s.db.QueryRow(`SELECT pve FROM hosts WHERE id=?`, node).Scan(&raw); err != nil {
		return "", err
	}
	json.Unmarshal([]byte(raw), &rep)
	if !slices.Contains(rep.CTs, ct) {
		return "", fmt.Errorf("CT %d absent du dernier rapport Proxmox", ct)
	}
	tok := randomToken(32)
	var id int64
	err := s.db.QueryRow(`SELECT id FROM hosts WHERE parent_id=? AND vmid=?`, node, ct).Scan(&id)
	switch {
	case err == nil:
		s.agentsMu.Lock()
		_, connected := s.agents[id]
		s.agentsMu.Unlock()
		if connected {
			return "", fmt.Errorf("l'agent du CT %d est déjà connecté", ct)
		}
		if _, err := s.db.Exec(`UPDATE hosts SET token_hash=? WHERE id=?`, hashToken(tok), id); err != nil {
			return "", err
		}
		s.logEvent("Proxmox "+nodeName, "host", id, "update", fmt.Sprintf("Nouveau jeton pour l'installation de l'agent dans le CT %d", ct))
	case errors.Is(err, sql.ErrNoRows):
		if ctName == "" {
			ctName = fmt.Sprintf("ct-%d", ct)
		}
		name, err := s.uniqueHostName(cleanHostname(ctName))
		if err != nil {
			return "", err
		}
		res, err := s.db.Exec(`INSERT INTO hosts(name,token_hash,created_at,parent_id,vmid) VALUES(?,?,?,?,?)`, name, hashToken(tok), time.Now().Unix(), node, ct)
		if err != nil {
			return "", err
		}
		id, _ = res.LastInsertId()
		s.logEvent("Proxmox "+nodeName, "host", id, "create", fmt.Sprintf("Hôte « %s » créé pour le CT %d, avec son propre jeton", name, ct))
		events.publish("hosts")
	default:
		return "", err
	}
	return tok, nil
}

// parentFromRequest checks a parent chosen in the dashboard: -1 automatic (Proxmox), 0 none,
// else a host id. It returns the parent_id and parent_manual to store, or an error message.
func (s *Server) parentFromRequest(id, parent int64) (any, bool, string) {
	switch {
	case parent == -1:
		return nil, false, ""
	case parent == 0:
		return nil, true, ""
	case parent == id:
		return nil, false, "Un hôte ne peut pas être son propre parent"
	}
	hosts, err := s.hostLinks()
	if err != nil {
		return nil, false, err.Error()
	}
	parentOf := map[int64]int64{}
	found := false
	for _, h := range hosts {
		found = found || h.id == parent
		if h.parent.Valid {
			parentOf[h.id] = h.parent.Int64
		}
	}
	if !found {
		return nil, false, "Hôte parent introuvable"
	}
	if id > 0 && createsCycle(parentOf, id, parent) {
		return nil, false, "Cet hôte est déjà le parent de l'hôte choisi"
	}
	return parent, true, ""
}
