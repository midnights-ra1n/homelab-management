package main

// Network / IPAM: VLANs, subnets, addresses, VPN tunnels, firewall rules, domains
// (port of lib/data/{network,vpn,firewall,domains}.ts and actions/network.ts).
// The network engine (IP check, diagnosis, flow simulation) runs in the browser on /api/mg/net.

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

var (
	tones        = []string{"accent", "green", "yellow", "red", "blue", "purple", "cyan", "orange", "pink", "muted"}
	ipStatuses   = []string{"used", "reserved", "dhcp", "free"}
	vpnTypes     = []string{"wireguard", "tailscale", "headscale", "netbird", "zerotier", "openvpn", "ipsec", "other"}
	vpnStatuses  = []string{"up", "down", "planned"}
	fwTargets    = []string{"any", "vlan", "subnet", "asset", "cidr", "vpn", "internet"}
	fwProtocols  = []string{"any", "tcp", "udp", "icmp"}
	domainExpose = []string{"public", "lan"}
)

const vlanSelect = `
  SELECT v.*,
    (SELECT COUNT(*) FROM subnets s WHERE s.vlan_id = v.id) AS subnet_count,
    (SELECT COUNT(DISTINCT ip.asset_id) FROM ip_addresses ip JOIN subnets s ON s.id = ip.subnet_id
       WHERE s.vlan_id = v.id AND ip.asset_id IS NOT NULL) AS asset_count
  FROM vlans v ORDER BY v.vlan_id`

const subnetSelect = `
  SELECT s.*, v.vlan_id AS vlan_number, v.name AS vlan_name, v.color AS vlan_color,
    (SELECT COUNT(*) FROM ip_addresses i WHERE i.subnet_id = s.id AND i.status = 'used') AS used,
    (SELECT COUNT(*) FROM ip_addresses i WHERE i.subnet_id = s.id AND i.status = 'reserved') AS reserved,
    (SELECT COUNT(*) FROM ip_addresses i WHERE i.subnet_id = s.id AND i.status = 'dhcp') AS dhcp
  FROM subnets s LEFT JOIN vlans v ON v.id = s.vlan_id`

const ipSelect = `
  SELECT i.*, a.display_name AS asset_name, a.kind AS asset_kind
  FROM ip_addresses i LEFT JOIN assets a ON a.id = i.asset_id`

const tunnelSelect = `
  SELECT t.*,
    a.display_name AS endpoint_a_name,
    (SELECT address FROM ip_addresses WHERE asset_id = t.endpoint_a_id ORDER BY is_primary DESC, id LIMIT 1) AS endpoint_a_ip,
    b.display_name AS endpoint_b_name,
    (SELECT address FROM ip_addresses WHERE asset_id = t.endpoint_b_id ORDER BY is_primary DESC, id LIMIT 1) AS endpoint_b_ip
  FROM vpn_tunnels t
  LEFT JOIN assets a ON a.id = t.endpoint_a_id
  LEFT JOIN assets b ON b.id = t.endpoint_b_id`

func ipKey(m map[string]any, k string) uint32 {
	s, _ := m[k].(string)
	n, _ := ipToInt(strings.Split(s, "/")[0])
	return n
}

func sortByIP(rows []map[string]any, k string) {
	sort.SliceStable(rows, func(i, j int) bool { return ipKey(rows[i], k) < ipKey(rows[j], k) })
}

func (s *Server) listSubnets() ([]map[string]any, error) {
	rows, err := s.rows(subnetSelect)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		c, _ := r["cidr"].(string)
		r["capacity"] = usableHosts(c)
	}
	sortByIP(rows, "cidr")
	return rows, nil
}

func (s *Server) listTunnels() ([]map[string]any, error) {
	return s.rows(tunnelSelect + " ORDER BY t.name COLLATE NOCASE")
}

// mgNetwork returns the whole IPAM: the network page and the browser-side engine use it.
func (s *Server) mgNetwork(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"default_policy": s.getSetting("fw_default_policy", "allow")}
	var err error
	if out["subnets"], err = s.listSubnets(); err != nil {
		serverErr(w, err)
		return
	}
	if out["tunnels"], err = s.listTunnels(); err != nil {
		serverErr(w, err)
		return
	}
	for k, q := range map[string]string{
		"vlans": vlanSelect,
		"ips": `SELECT i.*, a.display_name AS asset_name, a.kind AS asset_kind FROM ip_addresses i
		   LEFT JOIN assets a ON a.id = i.asset_id ORDER BY i.is_primary DESC, i.id`,
		"assets":  "SELECT id, display_name, hostname, kind, status, role, docker_ports FROM assets",
		"rules":   "SELECT * FROM firewall_rules ORDER BY position, id",
		"domains": domainSelect,
		"subnet_options": `SELECT s.id, s.name, s.cidr, v.vlan_id AS vlan_number FROM subnets s
		   LEFT JOIN vlans v ON v.id = s.vlan_id ORDER BY s.name`,
	} {
		rows, err := s.rows(q)
		if err != nil {
			serverErr(w, err)
			return
		}
		out[k] = rows
	}
	domains := out["domains"].([]map[string]any)
	sort.SliceStable(domains, func(i, j int) bool { return reversedFQDN(domains[i]) < reversedFQDN(domains[j]) })
	writeJSON(w, 200, out)
}

func reversedFQDN(m map[string]any) string {
	f, _ := m["fqdn"].(string)
	p := strings.Split(f, ".")
	for i, j := 0, len(p)-1; i < j; i, j = i+1, j-1 {
		p[i], p[j] = p[j], p[i]
	}
	return strings.Join(p, ".")
}

/* ------------------------------------------------------------------ VLANs */

func (s *Server) mgSaveVlan(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	vid := f.optNum("vlan_id", true, 1, 4094)
	if vid == nil {
		f.fail("vlan_id", "Le VLAN ID est requis")
	}
	color := "accent"
	if f.raw("color") != "" {
		color = f.enum("color", tones...)
	}
	cols := map[string]any{"vlan_id": vid, "name": f.required("name", "Le nom", 80), "description": f.text("description", 500), "color": color}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	var err error
	if id > 0 {
		err = s.updateRow(s.db, "vlans", id, cols)
	} else {
		id, err = s.insertRow(s.db, "vlans", cols)
	}
	if err != nil {
		formDBError(w, err, "vlan_id", "Ce VLAN ID existe déjà")
		return
	}
	if r.PathValue("id") != "" {
		s.mgLog(r, "vlan", id, "update", fmt.Sprintf("Modification du VLAN %v", vid))
		formOK(w, "VLAN mis à jour.")
	} else {
		s.mgLog(r, "vlan", id, "create", fmt.Sprintf("Création du VLAN %v « %s »", vid, cols["name"]))
		formOK(w, "VLAN créé.")
	}
}

// mgDelete removes a row and logs "<prefix> <label>" with the label read before deletion.
func (s *Server) mgDelete(table, entity, labelCol, prefix string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		var label string
		if err := s.db.QueryRow(fmt.Sprintf(`SELECT CAST(%s AS TEXT) FROM %s WHERE id = ?`, labelCol, table), id).Scan(&label); err != nil {
			writeErr(w, 404, "Introuvable")
			return
		}
		if _, err := s.db.Exec(fmt.Sprintf(`DELETE FROM %s WHERE id = ?`, table), id); err != nil {
			serverErr(w, err)
			return
		}
		if label == "" {
			label = fmt.Sprintf("#%d", id)
		}
		s.mgLog(r, entity, id, "delete", strings.ReplaceAll(prefix, "%s", label))
		w.WriteHeader(http.StatusNoContent)
	}
}

// optPathID reads {id} when the route has one (update) and 0 otherwise (create).
func optPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	if r.PathValue("id") == "" {
		return 0, true
	}
	return pathID(w, r)
}

/* ---------------------------------------------------------------- subnets */

func (s *Server) mgSaveSubnet(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	cidrIn := strings.TrimSpace(f.raw("cidr"))
	cidrNorm, okC := normalizeCidr(cidrIn)
	if cidrIn == "" {
		f.fail("cidr", "Le CIDR est requis")
	} else if !okC {
		f.fail("cidr", "CIDR invalide (ex. 192.168.10.0/24, préfixe /8 à /32)")
	}
	cols := map[string]any{
		"name": f.required("name", "Le nom", 80), "cidr": cidrNorm, "vlan_id": f.optID("vlan_id"),
		"gateway": f.optIP("gateway"), "dns": f.text("dns", 200), "dhcp_start": f.optIP("dhcp_start"),
		"dhcp_end": f.optIP("dhcp_end"), "description": f.text("description", 500),
	}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	for _, k := range []string{"gateway", "dhcp_start", "dhcp_end"} {
		if v := cols[k].(string); v != "" && !cidrContains(cidrNorm, v) {
			f.fail(k, "Hors du sous-réseau "+cidrNorm)
		}
	}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	ds, _ := ipToInt(cols["dhcp_start"].(string))
	de, _ := ipToInt(cols["dhcp_end"].(string))
	if cols["dhcp_start"] != "" && cols["dhcp_end"] != "" && ds > de {
		writeJSON(w, 200, formState{Errors: map[string]string{"dhcp_end": "La fin de plage doit être après le début"}, Message: "Plage DHCP inversée."})
		return
	}
	subnets, err := s.rows(`SELECT id, cidr, name FROM subnets`)
	if err != nil {
		serverErr(w, err)
		return
	}
	for _, o := range subnets {
		if o["id"].(int64) != id && cidrOverlap(o["cidr"].(string), cidrNorm) {
			writeJSON(w, 200, formState{Errors: map[string]string{"cidr": fmt.Sprintf("Chevauche %s (« %s »)", o["cidr"], o["name"])}, Message: "Ce sous-réseau en recouvre un autre."})
			return
		}
	}
	tunnels, err := s.rows(`SELECT name, tunnel_cidr FROM vpn_tunnels WHERE tunnel_cidr != ''`)
	if err != nil {
		serverErr(w, err)
		return
	}
	for _, t := range tunnels {
		if cidrOverlap(t["tunnel_cidr"].(string), cidrNorm) {
			writeJSON(w, 200, formState{Errors: map[string]string{"cidr": fmt.Sprintf("Chevauche le réseau du tunnel « %s » (%s)", t["name"], t["tunnel_cidr"])}, Message: "Conflit avec un tunnel VPN."})
			return
		}
	}
	if id > 0 {
		err = s.updateRow(s.db, "subnets", id, cols)
	} else {
		id, err = s.insertRow(s.db, "subnets", cols)
	}
	if err != nil {
		formDBError(w, err, "cidr", "Ce sous-réseau existe déjà")
		return
	}
	s.attachOrphanIPs()
	if r.PathValue("id") != "" {
		s.mgLog(r, "subnet", id, "update", "Modification du sous-réseau "+cidrNorm)
		formOK(w, "Sous-réseau mis à jour.")
	} else {
		s.mgLog(r, "subnet", id, "create", fmt.Sprintf("Création du sous-réseau %s « %s »", cidrNorm, cols["name"]))
		formOK(w, "Sous-réseau créé.")
	}
}

// attachOrphanIPs links addresses without a subnet to the subnet that contains them.
func (s *Server) attachOrphanIPs() {
	orphans, err := s.rows(`SELECT id, address FROM ip_addresses WHERE subnet_id IS NULL`)
	if err != nil {
		return
	}
	for _, o := range orphans {
		if sid := s.findSubnetFor(s.db, o["address"].(string)); sid != nil {
			s.db.Exec(`UPDATE ip_addresses SET subnet_id = ? WHERE id = ?`, sid, o["id"])
		}
	}
}

/* -------------------------------------------------------------- addresses */

func (s *Server) mgListIPs(w http.ResponseWriter, r *http.Request) {
	var rows []map[string]any
	var err error
	switch sub := r.URL.Query().Get("subnet"); sub {
	case "none":
		rows, err = s.rows(ipSelect + " WHERE i.subnet_id IS NULL")
	case "":
		rows, err = s.rows(ipSelect)
	default:
		rows, err = s.rows(ipSelect+" WHERE i.subnet_id = ?", sub)
	}
	if err == nil {
		sortByIP(rows, "address")
	}
	writeRows(w, rows, err)
}

func (s *Server) mgSaveIP(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	addr := strings.TrimSpace(f.raw("address"))
	if !isIPv4(addr) {
		f.fail("address", "Adresse IPv4 invalide")
	}
	cols := map[string]any{
		"address": addr, "subnet_id": f.optID("subnet_id"), "asset_id": f.optID("asset_id"), "mac": f.mac("mac"),
		"hostname": f.text("hostname", 253), "status": f.enum("status", ipStatuses...), "description": f.text("description", 500),
	}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	var dup int64
	s.db.QueryRow(`SELECT id FROM ip_addresses WHERE address = ? AND id != ?`, addr, id).Scan(&dup)
	if dup > 0 {
		formFail(w, "address", "Cette adresse existe déjà dans l'IPAM")
		return
	}
	if cols["subnet_id"] == nil {
		cols["subnet_id"] = s.findSubnetFor(s.db, addr)
	} else if sid, _ := cols["subnet_id"].(int64); sid > 0 {
		var c string
		if s.db.QueryRow(`SELECT cidr FROM subnets WHERE id = ?`, sid).Scan(&c) == nil && !cidrContains(c, addr) {
			formFail(w, "address", "Hors du sous-réseau "+c)
			return
		}
	}
	var err error
	if id > 0 {
		_, err = s.db.Exec(`UPDATE ip_addresses SET address = ?, subnet_id = ?, asset_id = ?, mac = ?, hostname = ?, status = ?,
		   description = ?, is_primary = CASE WHEN ? IS NULL THEN 0 ELSE is_primary END, updated_at = datetime('now') WHERE id = ?`,
			addr, cols["subnet_id"], cols["asset_id"], cols["mac"], cols["hostname"], cols["status"], cols["description"], cols["asset_id"], id)
	} else {
		primary := 0
		if cols["asset_id"] != nil {
			var n int
			s.db.QueryRow(`SELECT COUNT(*) FROM ip_addresses WHERE asset_id = ? AND is_primary = 1`, cols["asset_id"]).Scan(&n)
			if n == 0 {
				primary = 1
			}
		}
		cols["is_primary"] = primary
		id, err = s.insertRow(s.db, "ip_addresses", cols)
	}
	if err != nil {
		formDBError(w, err, "address", "Cette adresse existe déjà")
		return
	}
	if r.PathValue("id") != "" {
		s.mgLog(r, "ip", id, "update", "Modification de "+addr)
		formOK(w, "Adresse mise à jour.")
	} else {
		s.mgLog(r, "ip", id, "create", "Attribution de "+addr)
		formOK(w, "Adresse ajoutée.")
	}
}

func (s *Server) mgSetPrimaryIP(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var asset sql.NullInt64
	if err := s.db.QueryRow(`SELECT asset_id FROM ip_addresses WHERE id = ?`, id).Scan(&asset); err != nil || !asset.Valid {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	tx.Exec(`UPDATE ip_addresses SET is_primary = 0 WHERE asset_id = ?`, asset.Int64)
	tx.Exec(`UPDATE ip_addresses SET is_primary = 1 WHERE id = ?`, id)
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	logSkip(r)
	w.WriteHeader(http.StatusNoContent)
}

// mgNextFreeIP: first free address of the subnet, outside the gateway and the DHCP range.
func (s *Server) mgNextFreeIP(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var c, gw, dsS, deS string
	if err := s.db.QueryRow(`SELECT cidr, gateway, dhcp_start, dhcp_end FROM subnets WHERE id = ?`, id).Scan(&c, &gw, &dsS, &deS); err != nil {
		writeJSON(w, 200, map[string]any{"ip": nil})
		return
	}
	p, ok := parseCidr(c)
	if !ok {
		writeJSON(w, 200, map[string]any{"ip": nil})
		return
	}
	taken := map[uint64]bool{}
	rows, err := s.rows(`SELECT address FROM ip_addresses WHERE subnet_id = ? AND status != 'free'`, id)
	if err != nil {
		serverErr(w, err)
		return
	}
	for _, row := range rows {
		if n, ok := ipToInt(row["address"].(string)); ok {
			taken[uint64(n)] = true
		}
	}
	g, gOK := ipToInt(gw)
	ds, dsOK := ipToInt(dsS)
	de, deOK := ipToInt(deS)
	for n := p.first; n <= p.last; n++ {
		if taken[n] || (gOK && n == uint64(g)) || (dsOK && deOK && n >= uint64(ds) && n <= uint64(de)) {
			continue
		}
		writeJSON(w, 200, map[string]any{"ip": intToIP(uint32(n))})
		return
	}
	writeJSON(w, 200, map[string]any{"ip": nil})
}

/* ---------------------------------------------------------------- VPN */

// cidrList parses "192.168.10.0/24, 10.0.0.0/8" into normalised, de-duplicated CIDRs (JSON).
func (f *form) cidrList(k string) string {
	out := []string{}
	for _, c := range regexp.MustCompile(`[\s,;]+`).Split(f.raw(k), -1) {
		if c = strings.TrimSpace(c); c == "" {
			continue
		}
		n, ok := normalizeCidr(c)
		if !ok {
			f.fail(k, "Une des routes n'est pas un CIDR valide")
			continue
		}
		if !contains(out, n) {
			out = append(out, n)
		}
	}
	if len(out) > 64 {
		f.fail(k, "64 routes maximum")
	}
	b, _ := json.Marshal(out)
	return string(b)
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (s *Server) mgSaveVpn(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	tc := strings.TrimSpace(f.raw("tunnel_cidr"))
	if tc != "" {
		n, ok := normalizeCidr(tc)
		if !ok {
			f.fail("tunnel_cidr", "CIDR invalide (ex. 10.8.0.0/24)")
		}
		tc = n
	}
	cols := map[string]any{
		"name": f.required("name", "Le nom", 80), "type": f.enum("type", vpnTypes...), "status": f.enum("status", vpnStatuses...),
		"endpoint_a_id": f.optID("endpoint_a_id"), "endpoint_b_id": f.optID("endpoint_b_id"),
		"endpoint_b_label": f.text("endpoint_b_label", 80), "tunnel_cidr": tc, "ip_a": f.optIP("ip_a"), "ip_b": f.optIP("ip_b"),
		"routes_a": f.cidrList("routes_a"), "routes_b": f.cidrList("routes_b"), "listen_port": f.optNum("listen_port", true, 1, 65535),
		"public_endpoint": f.text("public_endpoint", 200), "notes": f.text("notes", 2000),
	}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	if cols["endpoint_b_id"] == nil && cols["endpoint_b_label"] == "" {
		writeJSON(w, 200, formState{Errors: map[string]string{"endpoint_b_label": "Choisis un élément ou nomme l'extrémité distante"}, Message: "Extrémité B manquante."})
		return
	}
	if tc != "" {
		for _, k := range []string{"ip_a", "ip_b"} {
			if ip := cols[k].(string); ip != "" && !cidrContains(tc, ip) {
				writeJSON(w, 200, formState{Errors: map[string]string{k: "Hors du réseau du tunnel " + tc}, Message: "IP de tunnel invalide."})
				return
			}
		}
		subnets, err := s.rows(`SELECT cidr, name FROM subnets`)
		if err != nil {
			serverErr(w, err)
			return
		}
		for _, sn := range subnets {
			if cidrOverlap(sn["cidr"].(string), tc) {
				writeJSON(w, 200, formState{Errors: map[string]string{"tunnel_cidr": fmt.Sprintf("Chevauche %s (« %s »)", sn["cidr"], sn["name"])}, Message: "Le réseau du tunnel recouvre un sous-réseau local."})
				return
			}
		}
	}
	var err error
	if id > 0 {
		err = s.updateRow(s.db, "vpn_tunnels", id, cols)
	} else {
		id, err = s.insertRow(s.db, "vpn_tunnels", cols)
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if r.PathValue("id") != "" {
		s.mgLog(r, "vpn", id, "update", fmt.Sprintf("Tunnel VPN « %s » modifié", cols["name"]))
		formOK(w, "Tunnel mis à jour.")
	} else {
		s.mgLog(r, "vpn", id, "create", fmt.Sprintf("Tunnel VPN « %s » ajouté", cols["name"]))
		formOK(w, "Tunnel ajouté.")
	}
}

/* --------------------------------------------------------------- firewall */

func (s *Server) mgSaveRule(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	ports := strings.Join(strings.Fields(f.raw("ports")), "")
	if len(ports) > 200 || !validPortSpec(ports) {
		f.fail("ports", "Ports invalides (ex. 22,80,443,8000-8100)")
	}
	enabled := 0
	if f.check("enabled") {
		enabled = 1
	}
	cols := map[string]any{
		"name": f.text("name", 80), "enabled": enabled, "action": f.enum("action", "allow", "deny"),
		"src_type": f.enum("src_type", fwTargets...), "src_value": f.text("src_value", 80),
		"dst_type": f.enum("dst_type", fwTargets...), "dst_value": f.text("dst_value", 80),
		"protocol": f.enum("protocol", fwProtocols...), "ports": ports, "notes": f.text("notes", 500),
	}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	for _, side := range []string{"src", "dst"} {
		t, v := cols[side+"_type"].(string), cols[side+"_value"].(string)
		if contains([]string{"vlan", "subnet", "asset", "cidr", "vpn"}, t) && v == "" {
			writeJSON(w, 200, formState{Errors: map[string]string{side + "_value": "Précise la cible"}, Message: "Cible incomplète."})
			return
		}
		if _, ok := normalizeCidr(v); t == "cidr" && !ok {
			writeJSON(w, 200, formState{Errors: map[string]string{side + "_value": "CIDR invalide"}, Message: "CIDR invalide."})
			return
		}
	}
	if cols["protocol"] == "icmp" {
		cols["ports"] = ""
	}
	var err error
	if id > 0 {
		err = s.updateRow(s.db, "firewall_rules", id, cols)
		logSkip(r)
	} else {
		var pos int64
		s.db.QueryRow(`SELECT COALESCE(MAX(position), -1) + 1 FROM firewall_rules`).Scan(&pos)
		cols["position"] = pos
		if id, err = s.insertRow(s.db, "firewall_rules", cols); err == nil {
			label := cols["name"].(string)
			if label == "" {
				label = fmt.Sprintf("#%d", id)
			}
			s.mgLog(r, "firewall", id, "create", "Règle de pare-feu « "+label+" » ajoutée")
		}
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if r.PathValue("id") != "" {
		formOK(w, "Règle mise à jour.")
	} else {
		formOK(w, "Règle ajoutée.")
	}
}

func (s *Server) mgToggleRule(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	logSkip(r)
	if _, err := s.db.Exec(`UPDATE firewall_rules SET enabled = 1 - enabled WHERE id = ?`, id); err != nil {
		serverErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// moveOrdered moves one row of an ordered table up (-1) or down (+1).
func (s *Server) moveOrdered(table string, id int64, dir int) error {
	rows, err := s.rows(fmt.Sprintf(`SELECT id FROM %s ORDER BY position, id`, table))
	if err != nil {
		return err
	}
	i := -1
	for k, row := range rows {
		if row["id"].(int64) == id {
			i = k
		}
	}
	j := i + dir
	if i < 0 || j < 0 || j >= len(rows) {
		return nil
	}
	rows[i], rows[j] = rows[j], rows[i]
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for pos, row := range rows {
		if _, err := tx.Exec(fmt.Sprintf(`UPDATE %s SET position = ? WHERE id = ?`, table), pos, row["id"]); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Server) mgMove(table string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		var in struct {
			Direction int `json:"direction"`
		}
		if !readJSON(w, r, &in) {
			return
		}
		if in.Direction != -1 && in.Direction != 1 {
			writeErr(w, 400, "Direction invalide")
			return
		}
		logSkip(r)
		if err := s.moveOrdered(table, id, in.Direction); err != nil {
			serverErr(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) mgSetPolicy(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Policy string `json:"policy"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	p := "allow"
	if in.Policy == "deny" {
		p = "deny"
	}
	if err := s.setSetting("fw_default_policy", p); err != nil {
		serverErr(w, err)
		return
	}
	s.mgLog(r, "firewall", 0, "update", "Politique par défaut du pare-feu : "+p)
	w.WriteHeader(http.StatusNoContent)
}

/* ---------------------------------------------------------------- domains */

const domainSelect = `
  SELECT d.*, p.display_name AS proxy_name,
    (SELECT address FROM ip_addresses WHERE asset_id = d.proxy_asset_id ORDER BY is_primary DESC, id LIMIT 1) AS proxy_ip,
    t.display_name AS target_name,
    (SELECT address FROM ip_addresses WHERE asset_id = d.target_asset_id ORDER BY is_primary DESC, id LIMIT 1) AS target_ip
  FROM domains d
  LEFT JOIN assets p ON p.id = d.proxy_asset_id
  LEFT JOIN assets t ON t.id = d.target_asset_id`

var fqdnRe = regexp.MustCompile(`^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$`)

func (s *Server) mgSaveDomain(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	fqdn := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(f.raw("fqdn"))), ".")
	if len(fqdn) > 253 || !fqdnRe.MatchString(fqdn) {
		f.fail("fqdn", "Nom de domaine invalide (ex. jellyfin.example.fr)")
	}
	cols := map[string]any{
		"fqdn": fqdn, "exposure": f.enum("exposure", domainExpose...), "proxy_asset_id": f.optID("proxy_asset_id"),
		"target_asset_id": f.optID("target_asset_id"), "upstream": f.url("upstream"), "notes": f.text("notes", 1000),
	}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	var err error
	if id > 0 {
		err = s.updateRow(s.db, "domains", id, cols)
	} else {
		id, err = s.insertRow(s.db, "domains", cols)
	}
	if err != nil {
		formDBError(w, err, "fqdn", "Ce domaine existe déjà")
		return
	}
	if r.PathValue("id") != "" {
		s.mgLog(r, "domain", id, "update", "Domaine « "+fqdn+" » modifié")
		formOK(w, "Domaine mis à jour.")
	} else {
		s.mgLog(r, "domain", id, "create", "Domaine « "+fqdn+" » ajouté")
		formOK(w, "Domaine ajouté.")
	}
}

var errNotFound = errors.New("introuvable")
