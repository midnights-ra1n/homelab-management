package main

// Homelab Monitoring integration and inventory sync. The agents only talk to the monitoring
// server (the VPS); this server reads its /api/v1 with a token (scopes hosts:read, plus
// monitors:read for the probes and hosts:write for decommissioning) and keeps the inventory
// in step: each monitored host is linked to an inventory item, created when missing, and
// the hardware the agent reports (CPU, RAM, disks, NICs, IP, OS) fills that item.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
)

type hlmData struct {
	Hosts    []map[string]any `json:"hosts"`
	Monitors []map[string]any `json:"monitors"`
}

func hlmGet(ctx context.Context, i *integration, path string, out any) error {
	if i.Config.TokenSecret == "" {
		return integrationErr("Jeton d'API Homelab Monitoring manquant (hlm_…)")
	}
	return httpJSON(ctx, "GET", i.URL+"/api/v1"+path, map[string]string{"Authorization": "Bearer " + i.Config.TokenSecret},
		strings.NewReader(""), i.Config.verify(true), 10*time.Second, out)
}

func (s *Server) hlmData(ctx context.Context, i *integration) (hlmData, error) {
	var d hlmData
	if err := hlmGet(ctx, i, "/hosts", &d.Hosts); err != nil {
		return d, err
	}
	// monitors:read is optional: a token limited to hosts stays usable.
	if err := hlmGet(ctx, i, "/monitors", &d.Monitors); err != nil {
		var ie *integrationError
		if !errors.As(err, &ie) || ie.status != 403 {
			return d, err
		}
	}
	d.Hosts, d.Monitors = nonNil(d.Hosts), nonNil(d.Monitors)
	return d, nil
}

func (s *Server) mgMonitoring(w http.ResponseWriter, r *http.Request) {
	list, err := s.loadIntegrations(`WHERE type = 'hlm' AND enabled = 1`)
	if err != nil {
		serverErr(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	writeJSON(w, 200, collect(ctx, list, s.hlmData))
}

// mgAssetMonitoring returns the monitoring view of a linked asset (host with its latest metrics).
func (s *Server) mgAssetMonitoring(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var integ, host sql.NullInt64
	if err := s.db.QueryRow(`SELECT hlm_integration_id, hlm_host_id FROM assets WHERE id = ?`, id).Scan(&integ, &host); err != nil || !integ.Valid || !host.Valid {
		writeJSON(w, 200, map[string]any{"linked": false})
		return
	}
	i, err := s.getIntegration(integ.Int64, "hlm")
	if err != nil {
		writeJSON(w, 200, map[string]any{"linked": false})
		return
	}
	var h map[string]any
	err = hlmGet(r.Context(), i, fmt.Sprintf("/hosts/%d", host.Int64), &h)
	out := map[string]any{"linked": true, "integration": map[string]any{"id": i.ID, "name": i.Name, "url": i.URL}, "host_id": host.Int64}
	if err != nil {
		out["error"] = err.Error()
	} else {
		out["host"] = h
	}
	writeJSON(w, 200, out)
}

/* ---------------------------------------------------------------- sync */

// Agent inventory, as sent by the agent in its "info" message (see agent/src/inventory.rs).
type hostInventory struct {
	Hostname       string  `json:"hostname"`
	OS             string  `json:"os"`
	OSVersion      string  `json:"os_version"`
	Kernel         string  `json:"kernel"`
	CPUModel       string  `json:"cpu_model"`
	CPUCores       int     `json:"cpu_cores"`
	CPUThreads     int     `json:"cpu_threads"`
	CPUPhysical    int     `json:"cpu_physical"`
	CPUSockets     int     `json:"cpu_sockets"`
	MemTotal       float64 `json:"mem_total"`
	Virtualization string  `json:"virtualization"` // none, kvm, qemu, lxc, docker, …
	Manufacturer   string  `json:"manufacturer"`
	Model          string  `json:"model"`
	Serial         string  `json:"serial"`
	IPs            []struct {
		Iface   string `json:"iface"`
		Address string `json:"address"`
		Prefix  int    `json:"prefix"`
		MAC     string `json:"mac"`
	} `json:"ips"`
	NICs []struct {
		Name  string `json:"name"`
		MAC   string `json:"mac"`
		Speed int    `json:"speed_mbps"`
	} `json:"nics"`
	Disks []struct {
		Name       string  `json:"name"`
		Model      string  `json:"model"`
		Size       float64 `json:"size_bytes"`
		Rotational bool    `json:"rotational"`
		Kind       string  `json:"kind"` // nvme, ssd, hdd, emmc, virtual
	} `json:"disks"`
}

func (s *Server) runInventorySync(ctx context.Context) {
	t := time.NewTicker(2 * time.Minute)
	defer t.Stop()
	for {
		if s.getSetting("inventory_sync", "true") == "true" {
			if n, err := s.syncInventory(ctx); err != nil {
				slog.Warn("inventory sync", "err", err)
			} else if n > 0 {
				slog.Info("inventory sync", "changed", n)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (s *Server) mgSyncNow(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	logSkip(r) // each change is logged by the sync itself
	n, err := s.syncInventory(ctx)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "message": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "message": fmt.Sprintf("Synchronisation terminée : %d élément(s) créé(s) ou mis à jour.", n)})
}

func machineKeys(values ...string) []string {
	var out []string
	for _, v := range values {
		k := strings.ToLower(strings.TrimSpace(v))
		if k != "" {
			out = append(out, k, strings.Split(k, ".")[0])
		}
	}
	return out
}

// syncInventory links every monitored host to an inventory item and returns how many items changed.
func (s *Server) syncInventory(ctx context.Context) (int, error) {
	list, err := s.loadIntegrations(`WHERE type = 'hlm' AND enabled = 1`)
	if err != nil {
		return 0, err
	}
	changed := 0
	var errs []error
	for k := range list {
		i := &list[k]
		var hosts []map[string]any
		if err := hlmGet(ctx, i, "/hosts", &hosts); err != nil {
			errs = append(errs, fmt.Errorf("%s : %w", i.Name, err))
			continue
		}
		for _, h := range hosts {
			n, err := s.syncHost(i, h)
			if err != nil {
				errs = append(errs, err)
			}
			changed += n
		}
	}
	return changed, errors.Join(errs...)
}

func (s *Server) syncHost(i *integration, h map[string]any) (int, error) {
	hostID, _ := h["id"].(float64)
	name, _ := h["name"].(string)
	if hostID <= 0 || name == "" {
		return 0, nil
	}
	var inv hostInventory
	if b, err := json.Marshal(h["info"]); err == nil {
		json.Unmarshal(b, &inv)
	}
	status, _ := h["status"].(string)

	var assetID int64
	err := s.db.QueryRow(`SELECT id FROM assets WHERE hlm_integration_id = ? AND hlm_host_id = ?`, i.ID, int64(hostID)).Scan(&assetID)
	if errors.Is(err, sql.ErrNoRows) {
		// Not linked yet: match an unlinked item by host name, else create one.
		keys := machineKeys(name, inv.Hostname)
		rows, err := s.rows(`SELECT id, hostname, display_name FROM assets WHERE hlm_host_id IS NULL AND status != 'decommissioned'`)
		if err != nil {
			return 0, err
		}
		for _, a := range rows {
			hn, _ := a["hostname"].(string)
			dn, _ := a["display_name"].(string)
			for _, k := range machineKeys(hn, dn) {
				if slices.Contains(keys, k) {
					assetID = a["id"].(int64)
					break
				}
			}
			if assetID > 0 {
				break
			}
		}
		if assetID > 0 {
			s.db.Exec(`UPDATE assets SET hlm_integration_id = ?, hlm_host_id = ? WHERE id = ?`, i.ID, int64(hostID), assetID)
			s.logEvent("synchronisation", "asset", assetID, "update", "« "+name+" » relié à l'hôte du monitoring « "+i.Name+" »")
		} else {
			return s.createFromHost(i, int64(hostID), name, status, inv)
		}
	} else if err != nil {
		return 0, err
	}
	return s.updateFromHost(assetID, name, status, inv)
}

func assetKind(virt string) string {
	switch strings.ToLower(virt) {
	case "", "none":
		return "physical"
	case "lxc", "lxc-libvirt", "openvz", "systemd-nspawn":
		return "lxc"
	case "docker", "podman", "container-other":
		return "docker"
	default:
		return "vm"
	}
}

func assetStatusFor(hlm string) string {
	switch hlm {
	case "major_outage":
		return "offline"
	case "maintenance":
		return "maintenance"
	case "unknown", "":
		return ""
	}
	return "online"
}

// inventoryCols turns what the agent reports into asset columns (empty values are left out).
func inventoryCols(inv hostInventory) map[string]any {
	c := map[string]any{}
	set := func(k string, v any) {
		switch x := v.(type) {
		case string:
			if x = strings.TrimSpace(x); x != "" {
				c[k] = x
			}
		case int:
			if x > 0 {
				c[k] = int64(x)
			}
		case float64:
			if x > 0 {
				c[k] = x
			}
		}
	}
	set("os", clip(inv.OS, 80))
	set("os_version", clip(inv.OSVersion, 80))
	set("cpu_model", clip(inv.CPUModel, 160))
	if inv.CPUPhysical > 0 {
		set("cpu_cores", inv.CPUPhysical)
	} else {
		set("cpu_cores", inv.CPUCores)
	}
	set("cpu_threads", inv.CPUThreads)
	set("cpu_sockets", inv.CPUSockets)
	if inv.MemTotal > 0 {
		set("ram_gb", math.Round(inv.MemTotal/(1<<30)*10)/10)
	}
	set("manufacturer", clip(inv.Manufacturer, 80))
	set("model", clip(inv.Model, 120))
	set("serial_number", clip(inv.Serial, 120))
	if len(inv.Disks) > 0 {
		var disks []map[string]any
		for _, d := range inv.Disks {
			kind := d.Kind
			if !slices.Contains(diskTypes, kind) {
				kind = "other"
			}
			disks = append(disks, map[string]any{"name": clip(d.Name, 80), "type": kind,
				"capacity_gb": math.Round(d.Size/1e9*10) / 10, "usage": clip(d.Model, 120)})
		}
		b, _ := json.Marshal(disks[:min(len(disks), 64)])
		c["disks"] = string(b)
	}
	if len(inv.NICs) > 0 {
		var nics []map[string]any
		for _, n := range inv.NICs {
			speed := ""
			if n.Speed > 0 {
				speed = strconv.Itoa(n.Speed) + " Mb/s"
				if n.Speed >= 1000 && n.Speed%1000 == 0 {
					speed = strconv.Itoa(n.Speed/1000) + " Gb/s"
				}
			}
			nics = append(nics, map[string]any{"name": clip(n.Name, 40), "mac": clip(strings.ToLower(n.MAC), 17), "speed": speed})
		}
		b, _ := json.Marshal(nics[:min(len(nics), 64)])
		c["nics"] = string(b)
	}
	return c
}

func (s *Server) createFromHost(i *integration, hostID int64, name, status string, inv hostInventory) (int, error) {
	cols := inventoryCols(inv)
	cols["kind"] = assetKind(inv.Virtualization)
	cols["display_name"] = clip(name, 120)
	cols["hostname"] = clip(strings.ToLower(inv.Hostname), 253)
	if !hostnameRe.MatchString(cols["hostname"].(string)) {
		cols["hostname"] = ""
	}
	cols["status"] = assetStatusFor(status)
	if cols["status"] == "" {
		cols["status"] = "online"
	}
	cols["status_source"] = "hlm"
	cols["tags"] = `["monitoring"]`
	cols["hlm_integration_id"] = i.ID
	cols["hlm_host_id"] = hostID
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	id, err := s.insertRow(tx, "assets", cols)
	if err != nil {
		return 0, err
	}
	s.addAgentIP(tx, id, inv, cols["hostname"].(string))
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	s.logEvent("synchronisation", "asset", id, "create", "Ajout de « "+name+" » à l'inventaire depuis le monitoring « "+i.Name+" »")
	return 1, nil
}

// addAgentIP gives the item the agent's first address when it has none and the address is free.
func (s *Server) addAgentIP(tx *sql.Tx, assetID int64, inv hostInventory, hostname string) bool {
	if len(inv.IPs) == 0 {
		return false
	}
	var n int
	tx.QueryRow(`SELECT COUNT(*) FROM ip_addresses WHERE asset_id = ?`, assetID).Scan(&n)
	if n > 0 {
		return false
	}
	for _, ip := range inv.IPs {
		if !isIPv4(ip.Address) {
			continue
		}
		var taken int
		tx.QueryRow(`SELECT COUNT(*) FROM ip_addresses WHERE address = ?`, ip.Address).Scan(&taken)
		if taken > 0 {
			continue
		}
		mac := strings.ToLower(ip.MAC)
		if !macRe.MatchString(mac) {
			mac = ""
		}
		_, err := tx.Exec(`INSERT INTO ip_addresses (address, subnet_id, asset_id, mac, hostname, status, is_primary) VALUES (?, ?, ?, ?, ?, 'used', 1)`,
			ip.Address, s.findSubnetFor(tx, ip.Address), assetID, mac, hostname)
		return err == nil
	}
	return false
}

var syncedFields = []string{"os", "os_version", "cpu_model", "cpu_cores", "cpu_threads", "cpu_sockets", "ram_gb",
	"manufacturer", "model", "serial_number", "disks", "nics"}

func (s *Server) updateFromHost(assetID int64, name, status string, inv hostInventory) (int, error) {
	before, err := s.row(`SELECT * FROM assets WHERE id = ?`, assetID)
	if err != nil {
		return 0, err
	}
	if before["status"] == "decommissioned" {
		return 0, nil
	}
	cols := inventoryCols(inv)
	for k := range cols {
		if !slices.Contains(syncedFields, k) {
			delete(cols, k)
		}
	}
	// Compare with what is stored (JSON columns were decoded by s.row).
	for k, v := range cols {
		old := before[k]
		if jsonColumns[k] {
			b, _ := json.Marshal(old)
			old = string(b)
		}
		if fmtVal(old) == fmtVal(v) {
			delete(cols, k)
		}
	}
	// Manual states (maintenance, planned) are never overwritten.
	if st := assetStatusFor(status); st != "" && (before["status"] == "online" || before["status"] == "offline") && st != before["status"] {
		cols["status"] = st
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	tx.Exec(`UPDATE assets SET status_source = 'hlm', status_checked_at = datetime('now') WHERE id = ?`, assetID)
	ipAdded := s.addAgentIP(tx, assetID, inv, fmtVal(before["hostname"]))
	if len(cols) > 0 {
		if err := s.updateRow(tx, "assets", assetID, cols); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	if len(cols) == 0 && !ipAdded {
		return 0, nil
	}
	if _, statusOnly := cols["status"]; statusOnly && len(cols) == 1 && !ipAdded {
		return 1, nil // state changes are frequent: not journaled
	}
	summary := changeSummary(before, cols, fmtVal(before["display_name"]))
	if ipAdded {
		summary += map[bool]string{true: ", IP", false: " : IP"}[strings.Contains(summary, " : ")]
	}
	s.logEvent("synchronisation", "asset", assetID, "update", summary+" (depuis le monitoring)")
	return 1, nil
}
