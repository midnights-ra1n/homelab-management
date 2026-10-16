package main

// Proxmox VE (REST API with an API token), port of lib/integrations/proxmox.ts. Each
// integration is an independent node (or cluster), aggregated here without a Proxmox
// cluster or Datacenter Manager. It stays independent from the inventory and monitoring.
// Responses are passed through as Proxmox returns them; the web UI holds the types.

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	pveNameRe      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`)
	guestActions   = []string{"start", "shutdown", "stop", "reboot", "suspend", "resume"}
	serviceActions = []string{"start", "stop", "restart", "reload"}
	timeframes     = []string{"hour", "day", "week", "month", "year"}
)

func pveAuth(i *integration) (string, error) {
	c := i.Config
	if c.TokenID == "" || c.TokenSecret == "" {
		return "", integrationErr("Jeton API Proxmox manquant (ID + secret)")
	}
	return "PVEAPIToken=" + c.TokenID + "=" + c.TokenSecret, nil
}

// pve calls /api2/json<path> and decodes the "data" member into out.
func pve(ctx context.Context, i *integration, method, path string, form url.Values, out any) error {
	auth, err := pveAuth(i)
	if err != nil {
		return err
	}
	headers := map[string]string{"Authorization": auth}
	var body *strings.Reader
	if form != nil {
		headers["Content-Type"] = "application/x-www-form-urlencoded"
		body = strings.NewReader(form.Encode())
	}
	timeout := 8 * time.Second
	if method != "GET" {
		timeout = 15 * time.Second
	}
	var res struct {
		Data json.RawMessage `json:"data"`
	}
	var rd = body
	if rd == nil {
		rd = strings.NewReader("")
	}
	if err := httpJSON(ctx, method, i.URL+"/api2/json"+path, headers, rd, i.Config.verify(false), timeout, &res); err != nil {
		return err
	}
	if out != nil && len(res.Data) > 0 {
		return json.Unmarshal(res.Data, out)
	}
	return nil
}

func (s *Server) testProxmox(ctx context.Context, i *integration) (string, error) {
	var v struct{ Version string }
	if err := pve(ctx, i, "GET", "/version", nil, &v); err != nil {
		return "", err
	}
	var nodes []struct{ Node string }
	if err := pve(ctx, i, "GET", "/nodes", nil, &nodes); err != nil {
		return "", err
	}
	names := make([]string, len(nodes))
	for k, n := range nodes {
		names[k] = n.Node
	}
	return fmt.Sprintf("Proxmox VE %s — %d nœud(s) : %s", v.Version, len(nodes), strings.Join(names, ", ")), nil
}

type pveResource map[string]any

// proxmoxOverview: nodes (with their status), guests (no templates) and storages.
func (s *Server) proxmoxOverview(ctx context.Context, i *integration) (map[string]any, error) {
	var v struct {
		Version string `json:"version"`
	}
	var res []pveResource
	errc := make(chan error, 2)
	go func() { errc <- pve(ctx, i, "GET", "/version", nil, &v) }()
	go func() { errc <- pve(ctx, i, "GET", "/cluster/resources", nil, &res) }()
	for range 2 {
		if err := <-errc; err != nil {
			return nil, err
		}
	}
	var nodes, guests, storages []pveResource
	for _, r := range res {
		switch r["type"] {
		case "node":
			nodes = append(nodes, r)
		case "qemu", "lxc":
			if t, _ := r["template"].(float64); t == 0 {
				guests = append(guests, r)
			}
		case "storage":
			storages = append(storages, r)
		}
	}
	sort.SliceStable(guests, func(a, b int) bool {
		x, _ := guests[a]["vmid"].(float64)
		y, _ := guests[b]["vmid"].(float64)
		return x < y
	})
	done := make(chan struct{}, len(nodes))
	for _, n := range nodes {
		go func() {
			defer func() { done <- struct{}{} }()
			name, _ := n["node"].(string)
			if n["status"] != "online" || !pveNameRe.MatchString(name) {
				return
			}
			var d map[string]any
			if pve(ctx, i, "GET", "/nodes/"+name+"/status", nil, &d) == nil {
				n["details"] = d
			}
		}()
	}
	for range nodes {
		<-done
	}
	return map[string]any{
		"integration": map[string]any{"id": i.ID, "name": i.Name, "url": i.URL},
		"version":     v.Version, "nodes": nonNil(nodes), "guests": nonNil(guests), "storages": nonNil(storages),
	}, nil
}

func (s *Server) mgProxmox(w http.ResponseWriter, r *http.Request) {
	list, err := s.loadIntegrations(`WHERE type = 'proxmox' AND enabled = 1`)
	if err != nil {
		serverErr(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	writeJSON(w, 200, collect(ctx, list, s.proxmoxOverview))
}

// pveTarget resolves the integration and validates every name that ends up in the API path.
func (s *Server) pveTarget(w http.ResponseWriter, r *http.Request) (*integration, string, bool) {
	id, ok := pathID(w, r)
	if !ok {
		return nil, "", false
	}
	i, err := s.getIntegration(id, "proxmox")
	if err != nil {
		writeErr(w, 404, "Intégration Proxmox introuvable")
		return nil, "", false
	}
	path := ""
	if node := r.PathValue("node"); node != "" {
		if !pveNameRe.MatchString(node) {
			writeErr(w, 400, "Nom invalide")
			return nil, "", false
		}
		path = "/nodes/" + node
		if t := r.PathValue("type"); t != "" {
			vmid, err := strconv.Atoi(r.PathValue("vmid"))
			if (t != "qemu" && t != "lxc") || err != nil || vmid < 100 || vmid > 999_999_999 {
				writeErr(w, 400, "Invité Proxmox invalide")
				return nil, "", false
			}
			path += "/" + t + "/" + strconv.Itoa(vmid)
		}
	}
	return i, path, true
}

func pveReply(w http.ResponseWriter, v any, err error) {
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": v})
}

func (s *Server) mgProxmoxOne(w http.ResponseWriter, r *http.Request) {
	i, _, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	d, err := s.proxmoxOverview(r.Context(), i)
	pveReply(w, d, err)
}

// mgPveNode serves the node views: status, rrd, network, disks, storage, content, services, updates, tasks, syslog.
func (s *Server) mgPveNode(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	var path string
	switch r.PathValue("what") {
	case "status":
		path = "/status"
	case "rrd":
		tf := q.Get("tf")
		if !slices.Contains(timeframes, tf) {
			tf = "hour"
		}
		path = "/rrddata?timeframe=" + tf + "&cf=AVERAGE"
	case "network":
		path = "/network"
	case "disks":
		path = "/disks/list?include-partitions=0"
	case "storage":
		path = "/storage"
	case "content":
		st := q.Get("storage")
		if !pveNameRe.MatchString(st) {
			writeErr(w, 400, "Nom invalide")
			return
		}
		v := url.Values{}
		if c := q.Get("content"); c != "" && pveNameRe.MatchString(c) {
			v.Set("content", c)
		}
		if n, err := strconv.Atoi(q.Get("vmid")); err == nil && n >= 100 {
			v.Set("vmid", strconv.Itoa(n))
		}
		path = "/storage/" + st + "/content?" + v.Encode()
	case "services":
		path = "/services"
	case "updates":
		path = "/apt/update"
	case "tasks":
		path = "/tasks?limit=50"
		if n, err := strconv.Atoi(q.Get("vmid")); err == nil && n >= 100 {
			path += "&vmid=" + strconv.Itoa(n)
		}
	case "syslog":
		path = "/syslog?limit=500"
	default:
		writeErr(w, 404, "Vue inconnue")
		return
	}
	var out any
	pveReply(w, out, pve(r.Context(), i, "GET", base+path, nil, &out))
}

// mgPveGuest serves the guest views: status, rrd, config, snapshots, interfaces, backups.
func (s *Server) mgPveGuest(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	var out any
	var err error
	switch r.PathValue("what") {
	case "status":
		err = pve(ctx, i, "GET", base+"/status/current", nil, &out)
	case "rrd":
		tf := r.URL.Query().Get("tf")
		if !slices.Contains(timeframes, tf) {
			tf = "hour"
		}
		err = pve(ctx, i, "GET", base+"/rrddata?timeframe="+tf+"&cf=AVERAGE", nil, &out)
	case "config":
		err = pve(ctx, i, "GET", base+"/config", nil, &out)
	case "snapshots":
		err = pve(ctx, i, "GET", base+"/snapshot", nil, &out)
	case "interfaces":
		out, err = guestInterfaces(ctx, i, base, r.PathValue("type"))
	case "backups":
		out, err = guestBackups(ctx, i, r.PathValue("node"), r.PathValue("vmid"))
	default:
		writeErr(w, 404, "Vue inconnue")
		return
	}
	pveReply(w, out, err)
}

// guestInterfaces: the guest agent for a VM (when running), the container's interfaces for a CT.
func guestInterfaces(ctx context.Context, i *integration, base, typ string) (any, error) {
	type iface struct {
		Name      string   `json:"name"`
		HWAddr    string   `json:"hwaddr,omitempty"`
		Addresses []string `json:"addresses"`
	}
	out := []iface{}
	if typ == "lxc" {
		var list []struct{ Name, Hwaddr, Inet, Inet6 string }
		if err := pve(ctx, i, "GET", base+"/interfaces", nil, &list); err != nil {
			return nil, err
		}
		for _, n := range list {
			if n.Name == "lo" {
				continue
			}
			f := iface{Name: n.Name, HWAddr: n.Hwaddr, Addresses: []string{}}
			for _, a := range []string{n.Inet, n.Inet6} {
				if a != "" {
					f.Addresses = append(f.Addresses, a)
				}
			}
			out = append(out, f)
		}
		return out, nil
	}
	var res struct {
		Result []struct {
			Name   string `json:"name"`
			HWAddr string `json:"hardware-address"`
			IPs    []struct {
				IP     string `json:"ip-address"`
				Prefix int    `json:"prefix"`
			} `json:"ip-addresses"`
		} `json:"result"`
	}
	if err := pve(ctx, i, "GET", base+"/agent/network-get-interfaces", nil, &res); err != nil {
		return nil, err
	}
	for _, n := range res.Result {
		if n.Name == "lo" {
			continue
		}
		f := iface{Name: n.Name, HWAddr: n.HWAddr, Addresses: []string{}}
		for _, a := range n.IPs {
			f.Addresses = append(f.Addresses, fmt.Sprintf("%s/%d", a.IP, a.Prefix))
		}
		out = append(out, f)
	}
	return out, nil
}

// guestBackups lists the vzdump backups of a guest on every active "backup" storage of the node.
func guestBackups(ctx context.Context, i *integration, node, vmid string) (any, error) {
	var storages []struct {
		Storage string `json:"storage"`
		Content string `json:"content"`
		Active  int    `json:"active"`
	}
	if err := pve(ctx, i, "GET", "/nodes/"+node+"/storage", nil, &storages); err != nil {
		return nil, err
	}
	names := []string{}
	backups := []map[string]any{}
	for _, st := range storages {
		if st.Active == 0 || !slices.Contains(strings.Split(st.Content, ","), "backup") || !pveNameRe.MatchString(st.Storage) {
			continue
		}
		names = append(names, st.Storage)
		var list []map[string]any
		if pve(ctx, i, "GET", "/nodes/"+node+"/storage/"+st.Storage+"/content?content=backup&vmid="+vmid, nil, &list) == nil {
			for _, b := range list {
				b["storage"] = st.Storage
				backups = append(backups, b)
			}
		}
	}
	sort.SliceStable(backups, func(a, b int) bool {
		x, _ := backups[a]["ctime"].(float64)
		y, _ := backups[b]["ctime"].(float64)
		return x > y
	})
	return map[string]any{"storages": names, "backups": backups}, nil
}

/* ---------------------------------------------------------------- actions */

func actionReply(w http.ResponseWriter, r *http.Request, s *Server, i *integration, err error, ok, summary string) {
	if err != nil {
		logSkip(r)
		writeJSON(w, 200, map[string]any{"ok": false, "message": err.Error()})
		return
	}
	s.mgLog(r, "proxmox", i.ID, "action", i.Name+" : "+summary)
	writeJSON(w, 200, map[string]any{"ok": true, "message": ok})
}

func (s *Server) mgPveGuestAction(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	var in struct {
		Action string `json:"action"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !slices.Contains(guestActions, in.Action) {
		writeErr(w, 400, "Action invalide")
		return
	}
	if r.PathValue("type") == "lxc" && (in.Action == "suspend" || in.Action == "resume") {
		writeJSON(w, 200, map[string]any{"ok": false, "message": "Suspendre / reprendre n'est disponible que pour les VM"})
		return
	}
	var upid string
	err := pve(r.Context(), i, "POST", base+"/status/"+in.Action, url.Values{}, &upid)
	if upid == "" {
		upid = in.Action
	}
	actionReply(w, r, s, i, err, "Tâche lancée : "+upid, in.Action+" de "+r.PathValue("type")+"/"+r.PathValue("vmid"))
}

func (s *Server) mgPveGuestConfig(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	typ := r.PathValue("type")
	name := strings.TrimSpace(f.raw("name"))
	if !regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]{0,61}[A-Za-z0-9])?$`).MatchString(name) {
		f.fail("name", "Nom DNS valide attendu (lettres, chiffres, . et -)")
	}
	cores := f.optNum("cores", true, 1, 512)
	sockets := f.optNum("sockets", true, 1, 16)
	memory := f.optNum("memory", true, 16, 4_194_304)
	swap := f.optNum("swap", true, 0, 4_194_304)
	tags := f.text("tags", 400)
	desc := f.text("description", 8000)
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	v := url.Values{}
	if typ == "qemu" {
		v.Set("name", name)
	} else {
		v.Set("hostname", name)
	}
	v.Set("onboot", map[bool]string{true: "1", false: "0"}[f.check("onboot")])
	var remove []string
	if cores != nil {
		v.Set("cores", fmt.Sprint(cores))
	}
	if memory != nil {
		v.Set("memory", fmt.Sprint(memory))
	}
	if typ == "qemu" && sockets != nil {
		v.Set("sockets", fmt.Sprint(sockets))
	}
	if typ == "lxc" && swap != nil {
		v.Set("swap", fmt.Sprint(swap))
	}
	if t := strings.Join(strings.FieldsFunc(tags, func(r rune) bool { return r == ';' || r == ',' || r == ' ' }), ";"); t != "" {
		v.Set("tags", t)
	} else {
		remove = append(remove, "tags")
	}
	if desc != "" {
		v.Set("description", desc)
	} else {
		remove = append(remove, "description")
	}
	if len(remove) > 0 {
		v.Set("delete", strings.Join(remove, ","))
	}
	if err := pve(r.Context(), i, "PUT", base+"/config", v, nil); err != nil {
		logSkip(r)
		formFail(w, "", err.Error())
		return
	}
	s.mgLog(r, "proxmox", i.ID, "update", i.Name+" : configuration de "+typ+"/"+r.PathValue("vmid")+" modifiée")
	formOK(w, "Configuration enregistrée. Certains changements (CPU, mémoire) s'appliquent au prochain démarrage.")
}

var snapNameRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{1,39}$`)

func (s *Server) mgPveSnapshot(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	name := f.raw("snapname")
	if !snapNameRe.MatchString(name) {
		f.fail("snapname", "2 à 40 caractères, commence par une lettre (lettres, chiffres, _ -)")
	}
	desc := f.text("description", 2000)
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	v := url.Values{"snapname": {name}, "description": {desc}}
	if r.PathValue("type") == "qemu" && f.check("vmstate") {
		v.Set("vmstate", "1")
	}
	if err := pve(r.Context(), i, "POST", base+"/snapshot", v, nil); err != nil {
		logSkip(r)
		formFail(w, "", err.Error())
		return
	}
	s.mgLog(r, "proxmox", i.ID, "action", fmt.Sprintf("%s : snapshot %s de %s/%s", i.Name, name, r.PathValue("type"), r.PathValue("vmid")))
	formOK(w, "Snapshot "+name+" en cours de création.")
}

func (s *Server) mgPveSnapshotCommand(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	name, cmd := r.PathValue("snap"), r.PathValue("command")
	if !pveNameRe.MatchString(name) || name == "current" || (cmd != "rollback" && cmd != "delete") {
		writeJSON(w, 200, map[string]any{"ok": false, "message": "Commande invalide"})
		return
	}
	var err error
	msg := "Retour au snapshot " + name + " lancé"
	if cmd == "rollback" {
		err = pve(r.Context(), i, "POST", base+"/snapshot/"+name+"/rollback", url.Values{}, nil)
	} else {
		err = pve(r.Context(), i, "DELETE", base+"/snapshot/"+name, nil, nil)
		msg = "Suppression du snapshot " + name + " lancée"
	}
	actionReply(w, r, s, i, err, msg, msg)
}

func (s *Server) mgPveBackup(w http.ResponseWriter, r *http.Request) {
	i, _, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	storage := f.raw("storage")
	if !pveNameRe.MatchString(storage) {
		f.fail("storage", "Lettres, chiffres, . _ - uniquement")
	}
	mode := f.enum("mode", "snapshot", "suspend", "stop")
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	v := url.Values{"vmid": {r.PathValue("vmid")}, "storage": {storage}, "mode": {mode}, "compress": {"zstd"}}
	if err := pve(r.Context(), i, "POST", "/nodes/"+r.PathValue("node")+"/vzdump", v, nil); err != nil {
		logSkip(r)
		formFail(w, "", err.Error())
		return
	}
	s.mgLog(r, "proxmox", i.ID, "action", fmt.Sprintf("%s : sauvegarde de %s vers %s", i.Name, r.PathValue("vmid"), storage))
	formOK(w, "Sauvegarde lancée vers "+storage+". Suis-la dans l'onglet Tâches.")
}

func (s *Server) mgPveService(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	svc, act := r.PathValue("service"), r.PathValue("action")
	if !pveNameRe.MatchString(svc) || !slices.Contains(serviceActions, act) {
		writeJSON(w, 200, map[string]any{"ok": false, "message": "Action inconnue"})
		return
	}
	err := pve(r.Context(), i, "POST", base+"/services/"+svc+"/"+act, url.Values{}, nil)
	actionReply(w, r, s, i, err, svc+" : "+act+" lancé", svc+" : "+act)
}

func (s *Server) mgPveAptRefresh(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	err := pve(r.Context(), i, "POST", base+"/apt/update", url.Values{}, nil)
	actionReply(w, r, s, i, err, "Actualisation des dépôts lancée (apt update)", "apt update sur "+r.PathValue("node"))
}

func (s *Server) mgPvePower(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	var in struct {
		Command string `json:"command"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Command != "reboot" && in.Command != "shutdown" {
		writeErr(w, 400, "Commande inconnue")
		return
	}
	err := pve(r.Context(), i, "POST", base+"/status", url.Values{"command": {in.Command}}, nil)
	msg := "Redémarrage du nœud demandé"
	if in.Command == "shutdown" {
		msg = "Arrêt du nœud demandé"
	}
	actionReply(w, r, s, i, err, msg, msg+" ("+r.PathValue("node")+")")
}

/* ------------------------------------------------- remote migration (no cluster) */

func (s *Server) mgPveTargets(w http.ResponseWriter, r *http.Request) {
	i, _, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	o, err := s.proxmoxOverview(ctx, i)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "message": err.Error()})
		return
	}
	node := ""
	for _, n := range o["nodes"].([]pveResource) {
		if n["status"] == "online" {
			node, _ = n["node"].(string)
			break
		}
	}
	if node == "" || !pveNameRe.MatchString(node) {
		writeJSON(w, 200, map[string]any{"ok": false, "message": "Aucun nœud en ligne sur la cible"})
		return
	}
	var storages []struct {
		Storage string   `json:"storage"`
		Content string   `json:"content"`
		Avail   *float64 `json:"avail"`
	}
	var networks []struct {
		Iface string `json:"iface"`
	}
	if err := pve(ctx, i, "GET", "/nodes/"+node+"/storage?enabled=1", nil, &storages); err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "message": err.Error()})
		return
	}
	if err := pve(ctx, i, "GET", "/nodes/"+node+"/network?type=any_bridge", nil, &networks); err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "message": err.Error()})
		return
	}
	st := []map[string]any{}
	for _, x := range storages {
		if strings.Contains(x.Content, "images") || strings.Contains(x.Content, "rootdir") {
			st = append(st, map[string]any{"storage": x.Storage, "content": x.Content, "avail": x.Avail})
		}
	}
	bridges := []string{}
	for _, n := range networks {
		bridges = append(bridges, n.Iface)
	}
	sort.Strings(bridges)
	writeJSON(w, 200, map[string]any{"ok": true, "node": node, "storages": st, "bridges": bridges})
}

// certFingerprint is the SHA-256 fingerprint of a node's TLS certificate (required by remote_migrate).
func certFingerprint(ctx context.Context, rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", integrationErr("URL invalide")
	}
	port := u.Port()
	if port == "" {
		port = "8006"
	}
	d := tls.Dialer{NetDialer: &net.Dialer{Timeout: 5 * time.Second}, Config: &tls.Config{InsecureSkipVerify: true, ServerName: u.Hostname()}}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(u.Hostname(), port))
	if err != nil {
		return "", integrationErr(err.Error())
	}
	defer conn.Close()
	certs := conn.(*tls.Conn).ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return "", integrationErr("Empreinte du certificat introuvable")
	}
	sum := sha256.Sum256(certs[0].Raw)
	parts := make([]string, len(sum))
	for k, b := range sum {
		parts[k] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(parts, ":"), nil
}

func (s *Server) mgPveMigrate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SourceID      int64  `json:"sourceId"`
		SourceNode    string `json:"sourceNode"`
		Type          string `json:"type"`
		VMID          int    `json:"vmid"`
		TargetID      int64  `json:"targetId"`
		TargetStorage string `json:"targetStorage"`
		TargetBridge  string `json:"targetBridge"`
		TargetVMID    *int   `json:"targetVmid"`
		Online        bool   `json:"online"`
		DeleteSource  bool   `json:"deleteSource"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	fail := func(msg string) {
		logSkip(r)
		writeJSON(w, 200, map[string]any{"ok": false, "message": msg})
	}
	okID := func(n int) bool { return n >= 100 && n <= 999_999_999 }
	switch {
	case in.SourceID == in.TargetID:
		fail("La cible doit être un autre nœud")
		return
	case in.TargetStorage == "" || in.TargetBridge == "":
		fail("Stockage et bridge cibles requis")
		return
	case (in.Type != "qemu" && in.Type != "lxc") || !okID(in.VMID) || (in.TargetVMID != nil && !okID(*in.TargetVMID)) ||
		!pveNameRe.MatchString(in.SourceNode) || !pveNameRe.MatchString(in.TargetStorage) || !pveNameRe.MatchString(in.TargetBridge):
		fail("Invité Proxmox invalide")
		return
	}
	src, err1 := s.getIntegration(in.SourceID, "proxmox")
	dst, err2 := s.getIntegration(in.TargetID, "proxmox")
	if err1 != nil || err2 != nil {
		fail("Intégration Proxmox introuvable")
		return
	}
	if dst.Config.TokenID == "" || dst.Config.TokenSecret == "" {
		fail("Le nœud cible n'a pas de jeton API configuré")
		return
	}
	fp, err := certFingerprint(r.Context(), dst.URL)
	if err != nil {
		fail(err.Error())
		return
	}
	u, _ := url.Parse(dst.URL)
	port := u.Port()
	if port == "" {
		port = "8006"
	}
	endpoint := strings.Join([]string{
		"apitoken=PVEAPIToken=" + dst.Config.TokenID + "=" + dst.Config.TokenSecret,
		"host=" + u.Hostname(), "port=" + port, "fingerprint=" + fp,
	}, ",")
	v := url.Values{"target-endpoint": {endpoint}, "target-storage": {in.TargetStorage}, "target-bridge": {in.TargetBridge},
		"delete": {map[bool]string{true: "1", false: "0"}[in.DeleteSource]}}
	if in.TargetVMID != nil {
		v.Set("target-vmid", strconv.Itoa(*in.TargetVMID))
	}
	if in.Online && in.Type == "qemu" {
		v.Set("online", "1")
	}
	if in.Online && in.Type == "lxc" {
		v.Set("restart", "1")
	}
	var upid string
	err = pve(r.Context(), src, "POST", fmt.Sprintf("/nodes/%s/%s/%d/remote_migrate", in.SourceNode, in.Type, in.VMID), v, &upid)
	actionReply(w, r, s, src, err, "Migration lancée ("+upid+"). Suis la progression dans les tâches du nœud source.",
		fmt.Sprintf("migration de %s/%d vers %s", in.Type, in.VMID, dst.Name))
}
