package main

// Inventory (assets) — port of homelab-management's lib/data/assets.ts and actions/inventory.ts.

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

var (
	assetKinds    = []string{"physical", "vm", "lxc", "docker", "network", "other"}
	assetStatuses = []string{"online", "offline", "maintenance", "planned", "decommissioned"}
	diskTypes     = []string{"nvme", "ssd", "hdd", "emmc", "virtual", "other"}
)

const assetSelect = `
  SELECT a.*,
    p.display_name AS parent_name, p.kind AS parent_kind,
    ip.address AS primary_ip, ip.mac AS primary_mac,
    s.id AS subnet_id, s.name AS subnet_name, s.cidr AS subnet_cidr,
    v.vlan_id AS vlan_number, v.name AS vlan_name,
    (SELECT COUNT(*) FROM assets c WHERE c.parent_id = a.id) AS children_count
  FROM assets a
  LEFT JOIN assets p ON p.id = a.parent_id
  LEFT JOIN ip_addresses ip ON ip.id = (
    SELECT id FROM ip_addresses WHERE asset_id = a.id ORDER BY is_primary DESC, id LIMIT 1)
  LEFT JOIN subnets s ON s.id = ip.subnet_id
  LEFT JOIN vlans v ON v.id = s.vlan_id`

const assetOrder = ` ORDER BY
    CASE a.kind WHEN 'network' THEN 0 WHEN 'physical' THEN 1 WHEN 'vm' THEN 2 WHEN 'lxc' THEN 3 WHEN 'docker' THEN 4 ELSE 5 END,
    a.display_name COLLATE NOCASE`

var macDashRe = regexp.MustCompile(`(?i)^([0-9a-f]{2}-)+`)

func (s *Server) listAssets(q map[string]string) ([]map[string]any, error) {
	var where []string
	var args []any
	if v := q["kind"]; v != "" {
		where, args = append(where, "a.kind = ?"), append(args, v)
	}
	if v := q["status"]; v != "" {
		where, args = append(where, "a.status = ?"), append(args, v)
	}
	if v := q["tag"]; v != "" {
		where, args = append(where, "EXISTS (SELECT 1 FROM json_each(a.tags) WHERE value = ?)"), append(args, v)
	}
	if v, err := strconv.Atoi(q["vlan"]); err == nil {
		where, args = append(where, "v.vlan_id = ?"), append(args, v)
	}
	if v, err := strconv.Atoi(q["host"]); err == nil {
		where, args = append(where, "a.parent_id = ?"), append(args, v)
	}
	if v := strings.TrimSpace(q["q"]); v != "" {
		// MAC: "-" is accepted as the separator, as in the forms.
		if macDashRe.MatchString(v) {
			v = strings.ReplaceAll(v, "-", ":")
		}
		fields := []string{"a.display_name", "a.hostname", "a.role", "a.os", "ip.address", "ip.mac", "a.tags", "a.model", "a.serial_number", "a.nics"}
		conds := make([]string, len(fields))
		for i, f := range fields {
			conds[i] = f + " LIKE ?"
			args = append(args, "%"+clip(v, 100)+"%")
		}
		where = append(where, "("+strings.Join(conds, " OR ")+")")
	}
	sqlq := assetSelect
	if len(where) > 0 {
		sqlq += " WHERE " + strings.Join(where, " AND ")
	}
	return s.rows(sqlq+assetOrder, args...)
}

func queryMap(r *http.Request) map[string]string {
	m := map[string]string{}
	for k, v := range r.URL.Query() {
		if len(v) > 0 {
			m[k] = v[0]
		}
	}
	return m
}

func (s *Server) mgListAssets(w http.ResponseWriter, r *http.Request) {
	rows, err := s.listAssets(queryMap(r))
	writeRows(w, rows, err)
}

// mgAsset returns everything the asset page shows.
func (s *Server) mgAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	asset, err := s.row(assetSelect+" WHERE a.id = ?", id)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "Élément introuvable")
		return
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	var dec any
	if str, _ := asset["decommission"].(string); str != "" && json.Unmarshal([]byte(str), &dec) == nil {
		asset["decommission"] = dec
	} else {
		asset["decommission"] = nil
	}
	out := map[string]any{"asset": asset}
	queries := map[string]struct {
		q    string
		args []any
	}{
		"children": {assetSelect + " WHERE a.parent_id = ? ORDER BY a.kind, a.display_name COLLATE NOCASE", []any{id}},
		"ancestors": {`WITH RECURSIVE up(id, display_name, parent_id, depth) AS (
		   SELECT p.id, p.display_name, p.parent_id, 1 FROM assets a JOIN assets p ON p.id = a.parent_id WHERE a.id = ?
		   UNION ALL
		   SELECT p.id, p.display_name, p.parent_id, up.depth + 1 FROM up JOIN assets p ON p.id = up.parent_id WHERE up.depth < 16
		 ) SELECT id, display_name FROM up ORDER BY depth DESC`, []any{id}},
		"ips":       {ipSelect + " WHERE i.asset_id = ? ORDER BY i.is_primary DESC, i.id", []any{id}},
		"activity":  {`SELECT * FROM activity WHERE entity_type = 'asset' AND entity_id = ? ORDER BY id DESC LIMIT 30`, []any{id}},
		"domains":   {`SELECT id, fqdn, exposure, proxy_asset_id, target_asset_id FROM domains WHERE proxy_asset_id = ? OR target_asset_id = ? ORDER BY fqdn`, []any{id, id}},
		"tunnels":   {`SELECT id, name FROM vpn_tunnels WHERE endpoint_a_id = ? OR endpoint_b_id = ? ORDER BY name`, []any{id, id}},
		"rules":     {`SELECT id, name, position FROM firewall_rules WHERE (src_type = 'asset' AND src_value = ?) OR (dst_type = 'asset' AND dst_value = ?) ORDER BY position`, []any{strconv.FormatInt(id, 10), strconv.FormatInt(id, 10)}},
		"shortcuts": {`SELECT id, name, url FROM shortcuts WHERE asset_id = ? ORDER BY name`, []any{id}},
		// Stock machines linked to this item, then the components installed in them.
		"hardware": {hardwareSelect + ` WHERE h.asset_id = ? OR h.parent_id IN (SELECT id FROM hardware_items WHERE asset_id = ?)
		  ORDER BY h.parent_id IS NOT NULL, h.name COLLATE NOCASE`, []any{id, id}},
	}
	for k, q := range queries {
		rows, err := s.rows(q.q, q.args...)
		if err != nil {
			serverErr(w, err)
			return
		}
		out[k] = rows
	}
	writeJSON(w, 200, out)
}

func (s *Server) mgAssetOptions(w http.ResponseWriter, r *http.Request) {
	q := `SELECT a.id, a.display_name, a.kind, a.hostname,
	   (SELECT subnet_id FROM ip_addresses WHERE asset_id = a.id ORDER BY is_primary DESC, id LIMIT 1) AS subnet_id
	 FROM assets a`
	var args []any
	if kinds := strings.Split(r.URL.Query().Get("kinds"), ","); kinds[0] != "" {
		q += " WHERE a.kind IN (" + strings.TrimSuffix(strings.Repeat("?,", len(kinds)), ",") + ")"
		for _, k := range kinds {
			args = append(args, k)
		}
	}
	rows, err := s.rows(q+" ORDER BY a.display_name COLLATE NOCASE", args...)
	writeRows(w, rows, err)
}

// mgInventoryMeta: filter options and totals of the inventory and dashboard pages.
func (s *Server) mgInventoryMeta(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{}
	for k, q := range map[string]string{
		"hosts": `SELECT p.id, p.display_name, COUNT(*) AS count FROM assets c JOIN assets p ON p.id = c.parent_id
		   GROUP BY p.id ORDER BY p.display_name COLLATE NOCASE`,
		"tags":   `SELECT value AS tag, COUNT(*) AS count FROM assets, json_each(assets.tags) GROUP BY value ORDER BY count DESC, value`,
		"counts": `SELECT kind, status, COUNT(*) AS n FROM assets GROUP BY kind, status`,
		"hardware": `SELECT COUNT(*) AS servers, COALESCE(SUM(cpu_cores),0) AS cores, COALESCE(SUM(cpu_threads),0) AS threads,
		   COALESCE(SUM(ram_gb),0) AS ram_gb, COALESCE(SUM(power_watts),0) AS watts
		 FROM assets WHERE kind = 'physical' AND status != 'decommissioned'`,
		"storage": `SELECT COALESCE(SUM(json_extract(d.value, '$.capacity_gb')), 0) AS total
		 FROM assets a, json_each(a.disks) d WHERE a.kind = 'physical' AND a.status != 'decommissioned'`,
	} {
		rows, err := s.rows(q)
		if err != nil {
			serverErr(w, err)
			return
		}
		out[k] = rows
	}
	writeJSON(w, 200, out)
}

/* ------------------------------------------------------------------ writes */

type assetInput struct {
	cols                  map[string]any
	primaryIP, primaryMAC string
	primarySubnet         any
}

type diskIn struct {
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	CapacityGB *float64 `json:"capacity_gb"`
	Usage      string   `json:"usage"`
}

type nicIn struct {
	Name  string `json:"name"`
	MAC   string `json:"mac"`
	Speed string `json:"speed"`
}

var hostnameRe = regexp.MustCompile(`^[a-z0-9.-]*$`)

func assetForm(f *form) assetInput {
	hostname := strings.ToLower(strings.TrimSpace(f.raw("hostname")))
	if len(hostname) > 253 || !hostnameRe.MatchString(hostname) {
		f.fail("hostname", "Nom d'hôte invalide (a-z, 0-9, « - » et « . »)")
	}
	var disks []diskIn
	f.jsonArray("disks", &disks)
	for i := range disks {
		d := &disks[i]
		d.Name, d.Usage = clip(strings.TrimSpace(d.Name), 80), clip(strings.TrimSpace(d.Usage), 120)
		if d.Type == "" {
			d.Type = "ssd"
		}
		if !slices.Contains(diskTypes, d.Type) || (d.CapacityGB != nil && (*d.CapacityGB < 0 || *d.CapacityGB > 10_000_000)) {
			f.fail("disks", "Disque invalide")
		}
	}
	var nics []nicIn
	f.jsonArray("nics", &nics)
	for i := range nics {
		n := &nics[i]
		n.Name, n.MAC, n.Speed = clip(strings.TrimSpace(n.Name), 40), clip(strings.TrimSpace(n.MAC), 17), clip(strings.TrimSpace(n.Speed), 20)
	}
	if len(disks) > 64 || len(nics) > 64 {
		f.fail("disks", "64 éléments maximum")
	}
	dj, _ := json.Marshal(nonNil(disks))
	nj, _ := json.Marshal(nonNil(nics))
	in := assetInput{cols: map[string]any{
		"kind":                   f.enum("kind", assetKinds...),
		"display_name":           f.required("display_name", "Le nom d'affichage", 120),
		"hostname":               hostname,
		"status":                 f.enum("status", assetStatuses...),
		"role":                   f.text("role", 120),
		"description":            f.text("description", 2000),
		"tags":                   f.tags("tags"),
		"parent_id":              f.optID("parent_id"),
		"os":                     f.text("os", 80),
		"os_version":             f.text("os_version", 80),
		"location":               f.text("location", 120),
		"manufacturer":           f.text("manufacturer", 80),
		"model":                  f.text("model", 120),
		"serial_number":          f.text("serial_number", 120),
		"cpu_model":              f.text("cpu_model", 160),
		"cpu_sockets":            f.optNum("cpu_sockets", true, 1, 16),
		"cpu_cores":              f.optNum("cpu_cores", true, 1, 4096),
		"cpu_threads":            f.optNum("cpu_threads", true, 1, 8192),
		"ram_gb":                 f.optNum("ram_gb", false, 0, 65536),
		"ram_type":               f.text("ram_type", 40),
		"gpu":                    f.text("gpu", 160),
		"disks":                  string(dj),
		"nics":                   string(nj),
		"power_watts":            f.optNum("power_watts", true, 0, 100000),
		"management_url":         f.url("management_url"),
		"docker_image":           f.text("docker_image", 255),
		"docker_ports":           f.text("docker_ports", 500),
		"docker_compose":         f.text("docker_compose", 255),
		"proxmox_integration_id": f.optID("proxmox_integration_id"),
		"proxmox_node":           f.text("proxmox_node", 80),
		"proxmox_vmid":           f.optNum("proxmox_vmid", true, 100, 999999999),
		"notes":                  f.text("notes", 10000),
	}}
	in.primaryIP = f.optIP("primary_ip")
	in.primarySubnet = f.optID("primary_subnet_id")
	in.primaryMAC = f.mac("primary_mac")
	return in
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

type fieldError struct{ field, msg string }

func (e fieldError) Error() string { return e.msg }

// syncPrimaryIP creates, updates or removes the asset's primary address.
func (s *Server) syncPrimaryIP(tx *sql.Tx, assetID int64, in assetInput, hostname string) error {
	var curID int64
	err := tx.QueryRow(`SELECT id FROM ip_addresses WHERE asset_id = ? AND is_primary = 1`, assetID).Scan(&curID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if in.primaryIP == "" {
		if curID > 0 {
			_, err = tx.Exec(`DELETE FROM ip_addresses WHERE id = ?`, curID)
		}
		return err
	}
	if in.primarySubnet == nil {
		in.primarySubnet = s.findSubnetFor(tx, in.primaryIP)
	}
	var takenID int64
	var takenAsset sql.NullInt64
	err = tx.QueryRow(`SELECT id, asset_id FROM ip_addresses WHERE address = ?`, in.primaryIP).Scan(&takenID, &takenAsset)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if takenID > 0 && takenID != curID {
		if takenAsset.Valid && takenAsset.Int64 != assetID {
			return fieldError{"primary_ip", "Cette adresse est déjà attribuée à un autre élément"}
		}
		// Reserved / free address in the IPAM: the asset takes it over.
		if curID > 0 {
			if _, err := tx.Exec(`DELETE FROM ip_addresses WHERE id = ?`, curID); err != nil {
				return err
			}
		}
		_, err = tx.Exec(`UPDATE ip_addresses SET asset_id = ?, is_primary = 1, status = 'used', subnet_id = COALESCE(?, subnet_id),
		   mac = ?, hostname = ?, updated_at = datetime('now') WHERE id = ?`, assetID, in.primarySubnet, in.primaryMAC, hostname, takenID)
		return err
	}
	if curID > 0 {
		_, err = tx.Exec(`UPDATE ip_addresses SET address = ?, subnet_id = ?, mac = ?, hostname = ?, updated_at = datetime('now') WHERE id = ?`,
			in.primaryIP, in.primarySubnet, in.primaryMAC, hostname, curID)
	} else {
		_, err = tx.Exec(`INSERT INTO ip_addresses (address, subnet_id, asset_id, mac, hostname, status, is_primary) VALUES (?, ?, ?, ?, ?, 'used', 1)`,
			in.primaryIP, in.primarySubnet, assetID, in.primaryMAC, hostname)
	}
	return err
}

// descendants returns the ids hosted (directly or not) by the given assets.
func descendants(q execer, ids []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := q.Query(`WITH RECURSIVE down(id) AS (
	   SELECT id FROM assets WHERE parent_id IN (`+strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+`)
	   UNION SELECT a.id FROM assets a JOIN down ON a.parent_id = down.id
	 ) SELECT id FROM down`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			out[id] = true
		}
	}
	return out, rows.Err()
}

var assetFieldLabels = map[string]string{
	"kind": "type", "display_name": "nom", "hostname": "nom d'hôte", "status": "état", "role": "rôle", "tags": "tags",
	"parent_id": "hôte", "os": "système", "os_version": "version", "location": "emplacement", "cpu_cores": "CPU",
	"ram_gb": "mémoire", "disks": "disques", "nics": "interfaces", "management_url": "URL d'administration", "notes": "notes",
}

func fmtVal(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case []byte:
		return string(x)
	default:
		return fmt.Sprint(x)
	}
}

// changeSummary gives "Modification de « X » : état, tags" from the columns that change.
func changeSummary(before map[string]any, after map[string]any, name string) string {
	var labels []string
	for _, k := range sortedKeys(after) {
		if fmtVal(before[k]) == fmtVal(after[k]) {
			continue
		}
		l, ok := assetFieldLabels[k]
		if !ok {
			l = "autres champs"
		}
		if !slices.Contains(labels, l) {
			labels = append(labels, l)
		}
	}
	if len(labels) == 0 {
		return "Modification de « " + name + " »"
	}
	return "Modification de « " + name + " » : " + strings.Join(labels, ", ")
}

func (s *Server) mgSaveAsset(w http.ResponseWriter, r *http.Request) {
	var id int64
	if r.PathValue("id") != "" {
		var ok bool
		if id, ok = pathID(w, r); !ok {
			return
		}
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	in := assetForm(f)
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	name := in.cols["display_name"].(string)
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	var summary string
	if id > 0 {
		if p, ok := in.cols["parent_id"].(int64); ok {
			if p == id {
				formFail(w, "parent_id", "Un élément ne peut pas être son propre hôte")
				return
			}
			desc, err := descendants(tx, []int64{id})
			if err != nil {
				serverErr(w, err)
				return
			}
			if desc[p] {
				formFail(w, "parent_id", "Cet hôte est hébergé par l'élément lui-même")
				return
			}
		}
		before := map[string]any{}
		if rows, err := tx.Query(`SELECT * FROM assets WHERE id = ?`, id); err == nil {
			cols, _ := rows.Columns()
			if rows.Next() {
				vals := make([]any, len(cols))
				ptrs := make([]any, len(cols))
				for i := range vals {
					ptrs[i] = &vals[i]
				}
				rows.Scan(ptrs...)
				for i, c := range cols {
					before[c] = vals[i]
				}
			}
			rows.Close()
		}
		if len(before) == 0 {
			writeErr(w, 404, "Élément introuvable")
			return
		}
		var ipBefore, macBefore string
		tx.QueryRow(`SELECT address, mac FROM ip_addresses WHERE asset_id = ? AND is_primary = 1`, id).Scan(&ipBefore, &macBefore)
		if err := s.updateRow(tx, "assets", id, in.cols); err != nil {
			serverErr(w, err)
			return
		}
		summary = changeSummary(before, in.cols, name)
		if ipBefore != in.primaryIP || macBefore != in.primaryMAC {
			if strings.Contains(summary, " : ") {
				summary += ", IP"
			} else {
				summary += " : IP"
			}
		}
	} else {
		if id, err = s.insertRow(tx, "assets", in.cols); err != nil {
			serverErr(w, err)
			return
		}
		summary = "Ajout de « " + name + " » à l'inventaire"
	}
	if err := s.syncPrimaryIP(tx, id, in, in.cols["hostname"].(string)); err != nil {
		var fe fieldError
		if errors.As(err, &fe) {
			formFail(w, fe.field, fe.msg)
		} else {
			formDBError(w, err, "primary_ip", "Cette adresse IP est déjà utilisée")
		}
		return
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	action := "update"
	if r.PathValue("id") == "" {
		action = "create"
	}
	s.mgLog(r, "asset", id, action, summary)
	if f.raw("_stay") != "" {
		formOK(w, "« "+name+" » a été ajouté à l'inventaire.")
		return
	}
	formRedirect(w, fmt.Sprintf("/inventaire/%d", id), id)
}

func (s *Server) mgDeleteAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var name string
	if err := s.db.QueryRow(`SELECT display_name FROM assets WHERE id = ?`, id).Scan(&name); err != nil {
		writeErr(w, 404, "Élément introuvable")
		return
	}
	if _, err := s.db.Exec(`DELETE FROM assets WHERE id = ?`, id); err != nil {
		serverErr(w, err)
		return
	}
	s.mgLog(r, "asset", id, "delete", "Suppression de « "+name+" »")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) mgDuplicateAsset(w http.ResponseWriter, r *http.Request) {
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
	if err := tx.QueryRow(`SELECT display_name FROM assets WHERE id = ?`, id).Scan(&name); err != nil {
		writeErr(w, 404, "Élément introuvable")
		return
	}
	res, err := tx.Exec(`INSERT INTO assets (kind, display_name, hostname, status, role, description, tags, parent_id, os, os_version,
	   location, manufacturer, model, serial_number, cpu_model, cpu_sockets, cpu_cores, cpu_threads, ram_gb, ram_type, gpu, disks,
	   nics, power_watts, management_url, docker_image, docker_ports, docker_compose, proxmox_integration_id, proxmox_node,
	   proxmox_vmid, notes)
	 SELECT kind, display_name || ' (copie)', CASE WHEN hostname = '' THEN '' ELSE hostname || '-copie' END, status, role,
	   description, tags, parent_id, os, os_version, location, manufacturer, model, serial_number, cpu_model, cpu_sockets,
	   cpu_cores, cpu_threads, ram_gb, ram_type, gpu, disks, nics, power_watts, management_url, docker_image, docker_ports,
	   docker_compose, proxmox_integration_id, proxmox_node, proxmox_vmid, notes
	 FROM assets WHERE id = ?`, id)
	if err != nil {
		serverErr(w, err)
		return
	}
	newID, _ := res.LastInsertId()
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.mgLog(r, "asset", newID, "create", "Duplication de « "+name+" »")
	formRedirect(w, fmt.Sprintf("/inventaire/%d/modifier", newID), newID)
}

func (s *Server) mgSetAssetStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !slices.Contains(assetStatuses, in.Status) {
		writeErr(w, 400, "État invalide")
		return
	}
	var name string
	if err := s.db.QueryRow(`SELECT display_name FROM assets WHERE id = ?`, id).Scan(&name); err != nil {
		writeErr(w, 404, "Élément introuvable")
		return
	}
	if _, err := s.db.Exec(`UPDATE assets SET status = ?, status_source = '', updated_at = datetime('now') WHERE id = ?`, in.Status, id); err != nil {
		serverErr(w, err)
		return
	}
	s.mgLog(r, "asset", id, "update", "Modification de « "+name+" » : état")
	w.WriteHeader(http.StatusNoContent)
}

// mgBulkAssets applies one action to several assets: status, tag, parent or delete.
func (s *Server) mgBulkAssets(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs    []int64 `json:"ids"`
		Action struct {
			Op       string `json:"op"`
			Status   string `json:"status"`
			Tag      string `json:"tag"`
			ParentID *int64 `json:"parentId"`
		} `json:"action"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	a := in.Action
	a.Tag = strings.ToLower(strings.TrimSpace(a.Tag))
	valid := len(in.IDs) > 0 && len(in.IDs) <= 500
	switch a.Op {
	case "status":
		valid = valid && slices.Contains(assetStatuses, a.Status)
	case "tag":
		valid = valid && a.Tag != "" && len(a.Tag) <= 40
	case "parent", "delete":
	default:
		valid = false
	}
	if !valid {
		writeJSON(w, 200, map[string]any{"ok": false, "message": "Action invalide."})
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	if a.Op == "parent" && a.ParentID != nil {
		desc, err := descendants(tx, in.IDs)
		if err != nil {
			serverErr(w, err)
			return
		}
		if slices.Contains(in.IDs, *a.ParentID) || desc[*a.ParentID] {
			writeJSON(w, 200, map[string]any{"ok": false, "message": "Un élément ne peut pas être déplacé sous lui-même ou sous un de ses invités"})
			return
		}
	}
	type entry struct {
		id      int64
		summary string
		action  string
	}
	var logs []entry
	for _, id := range in.IDs {
		var name, tags, status string
		var parent sql.NullInt64
		if err := tx.QueryRow(`SELECT display_name, tags, status, parent_id FROM assets WHERE id = ?`, id).Scan(&name, &tags, &status, &parent); err != nil {
			continue
		}
		var q string
		var args []any
		e := entry{id: id, action: "update"}
		switch a.Op {
		case "delete":
			q, args = `DELETE FROM assets WHERE id = ?`, []any{id}
			e.action, e.summary = "delete", "Suppression de « "+name+" »"
		case "status":
			if status == a.Status {
				continue
			}
			q, args = `UPDATE assets SET status = ?, status_source = '', updated_at = datetime('now') WHERE id = ?`, []any{a.Status, id}
			e.summary = "Modification de « " + name + " » : état"
		case "tag":
			var list []string
			json.Unmarshal([]byte(tags), &list)
			if slices.Contains(list, a.Tag) {
				continue
			}
			b, _ := json.Marshal(append(list, a.Tag))
			q, args = `UPDATE assets SET tags = ?, updated_at = datetime('now') WHERE id = ?`, []any{string(b), id}
			e.summary = "Modification de « " + name + " » : tags"
		case "parent":
			if (a.ParentID == nil && !parent.Valid) || (a.ParentID != nil && parent.Valid && parent.Int64 == *a.ParentID) {
				continue
			}
			q, args = `UPDATE assets SET parent_id = ?, updated_at = datetime('now') WHERE id = ?`, []any{a.ParentID, id}
			e.summary = "Modification de « " + name + " » : hôte"
		}
		if _, err := tx.Exec(q, args...); err != nil {
			serverErr(w, err)
			return
		}
		logs = append(logs, e)
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	for _, e := range logs {
		s.mgLog(r, "asset", e.id, e.action, e.summary)
	}
	msg := fmt.Sprintf("%d élément(s) modifié(s).", len(logs))
	if a.Op == "delete" {
		msg = fmt.Sprintf("%d élément(s) supprimé(s).", len(logs))
	}
	writeJSON(w, 200, map[string]any{"ok": true, "message": msg})
}
