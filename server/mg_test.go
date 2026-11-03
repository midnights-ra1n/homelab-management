package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Vectors produced by homelab-management (Node crypto): its secrets and passwords must still work.
func TestManagementLegacyCompat(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "secret.key"), []byte("test-secret"), 0o600)
	key, err := loadSecretKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{key: key, mg: &mgState{}}
	plain, err := s.decrypt("v1.BwcHBwcHBwcHBwcH.wlfkKEL4f0gr+E29gS9ziQ==.zmyokFssIb4wj2V1gbXKOglQr1CCJLoTwA==")
	if err != nil || plain != `{"token_secret":"s3cr3t"}` {
		t.Fatalf("decrypt Node secret: %q %v", plain, err)
	}
	if back, err := s.decrypt(s.encrypt("round trip")); err != nil || back != "round trip" {
		t.Fatal("round trip", back, err)
	}
	hash := "scrypt$AwMDAwMDAwMDAwMDAwMDAw==$m814JD2AZwFbY8z21VcePXaXfFr+pYZxrW0vm0ekz//zM7rDXSyMgUNmAswQZW6eBBxkikjgHjzgAk/IVYsK6A=="
	if !checkPassword(hash, "correct horse") || checkPassword(hash, "wrong") {
		t.Fatal("scrypt password check")
	}
}

func newMgTestServer(t *testing.T) (*Server, *httptest.Server, string) {
	t.Helper()
	s := &Server{cfg: Config{DataDir: t.TempDir(), Role: RoleManagement}, limiter: newRateLimiter(100, time.Minute)}
	if err := s.initManagement(); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routes())
	t.Cleanup(func() { ts.Close(); s.db.Close() })
	s.db.Exec(`INSERT INTO users(username, password_hash) VALUES('admin', ?)`, hashPassword("a-long-password"))
	tok := "session-token-for-tests-0123456789"
	s.db.Exec(`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?, 1, ?)`, hashToken(tok), time.Now().Add(time.Hour).Unix())
	return s, ts, tok
}

func postForm(t *testing.T, ts *httptest.Server, tok, path string, v url.Values) string {
	t.Helper()
	req, _ := http.NewRequest("POST", ts.URL+path, strings.NewReader(v.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", ts.URL)
	req.AddCookie(&http.Cookie{Name: mgSessionCookie, Value: tok})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

// A fresh database runs homelab-management's nine migrations then the fusion one.
func TestManagementFreshSchemaAndForms(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	var v int
	s.db.QueryRow(`PRAGMA user_version`).Scan(&v)
	if v != len(mgMigrations) {
		t.Fatalf("user_version %d, want %d", v, len(mgMigrations))
	}
	if out := postForm(t, ts, tok, "/api/mg/subnets", url.Values{"name": {"LAN"}, "cidr": {"192.168.1.9/24"}}); !strings.Contains(out, `"ok":true`) {
		t.Fatal(out)
	}
	if out := postForm(t, ts, tok, "/api/mg/subnets", url.Values{"name": {"Overlap"}, "cidr": {"192.168.0.0/16"}}); !strings.Contains(out, "Chevauche") {
		t.Fatal("overlap not refused:", out)
	}
	out := postForm(t, ts, tok, "/api/mg/assets", url.Values{"kind": {"physical"}, "display_name": {"NAS"}, "status": {"online"},
		"primary_ip": {"192.168.1.20"}, "tags": {"Stockage, stockage"}})
	if !strings.Contains(out, `"redirect":"/inventaire/1"`) {
		t.Fatal(out)
	}
	var tags string
	var subnet int64
	s.db.QueryRow(`SELECT a.tags, i.subnet_id FROM assets a JOIN ip_addresses i ON i.asset_id = a.id`).Scan(&tags, &subnet)
	if tags != `["stockage"]` || subnet != 1 {
		t.Fatalf("tags %s subnet %d", tags, subnet)
	}
	var actor, summary string
	s.db.QueryRow(`SELECT actor, summary FROM activity ORDER BY id DESC LIMIT 1`).Scan(&actor, &summary)
	if actor != "admin" || !strings.Contains(summary, "NAS") {
		t.Fatalf("journal: %q %q", actor, summary)
	}
	if out := postForm(t, ts, tok, "/api/mg/integrations", url.Values{"type": {"beszel"}, "name": {"x"}, "url": {"http://x"}}); !strings.Contains(out, "errors") {
		t.Fatal("removed integration type accepted:", out)
	}
}

// A monitored host creates an inventory item with the agent's hardware, then is updated in place.
func TestInventorySyncFromMonitoring(t *testing.T) {
	s, _, _ := newMgTestServer(t)
	host := `{"id":7,"name":"nas","status":"operational","info":{"hostname":"nas.lan","os":"Debian GNU/Linux 13","os_version":"13",
	  "cpu_model":"Intel N100","cpu_cores":4,"cpu_physical":4,"cpu_threads":4,"mem_total":17179869184,"virtualization":"none",
	  "ips":[{"iface":"enp1s0","address":"192.168.1.50","prefix":24,"mac":"aa:bb:cc:dd:ee:ff"}],
	  "disks":[{"name":"nvme0n1","model":"WD SN770","size_bytes":1000204886016,"kind":"nvme"}]}}`
	hlm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer hlm_test" {
			w.WriteHeader(401)
			return
		}
		w.Write([]byte("[" + host + "]"))
	}))
	defer hlm.Close()
	cfg, _ := json.Marshal(integrationConfig{TokenSecret: "hlm_test"})
	s.db.Exec(`INSERT INTO integrations (type, name, url, config) VALUES ('hlm', 'Monitoring', ?, ?)`, hlm.URL, s.encrypt(string(cfg)))

	if n, err := s.syncInventory(context.Background()); err != nil || n != 1 {
		t.Fatalf("first sync: %d %v", n, err)
	}
	var kind, hostname, disks string
	var ram float64
	var ip string
	s.db.QueryRow(`SELECT a.kind, a.hostname, a.ram_gb, a.disks, i.address FROM assets a JOIN ip_addresses i ON i.asset_id = a.id WHERE a.hlm_host_id = 7`).
		Scan(&kind, &hostname, &ram, &disks, &ip)
	if kind != "physical" || hostname != "nas.lan" || ram != 16 || ip != "192.168.1.50" || !strings.Contains(disks, `"nvme"`) {
		t.Fatalf("created item: %s %s %v %s %s", kind, hostname, ram, disks, ip)
	}
	if n, _ := s.syncInventory(context.Background()); n != 0 {
		t.Fatalf("unchanged host should not change the item, got %d", n)
	}
	host = strings.Replace(host, `"mem_total":17179869184`, `"mem_total":34359738368`, 1)
	if n, _ := s.syncInventory(context.Background()); n != 1 {
		t.Fatal("RAM change not synced")
	}
	host = strings.Replace(host, `"name":"nas"`, `"name":"nas-salon"`, 1)
	s.syncInventory(context.Background())
	var name string
	s.db.QueryRow(`SELECT display_name FROM assets WHERE hlm_host_id = 7`).Scan(&name)
	if name != "nas-salon" {
		t.Fatalf("rename in the monitoring not followed: %q", name)
	}
}

// The same machine never gets two items: a second integration on the same hub, a duplicate host,
// or a host enrolled again (new id) reuse the existing item.
func TestInventorySyncNoDuplicates(t *testing.T) {
	s, _, _ := newMgTestServer(t)
	hosts := `[{"id":1,"name":"web","status":"operational","info":{"hostname":"web.lan","virtualization":"kvm"}},
	           {"id":2,"name":"WEB","status":"operational","info":{"hostname":"web","virtualization":"kvm"}}]`
	hlm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(hosts)) }))
	defer hlm.Close()
	cfg, _ := json.Marshal(integrationConfig{TokenSecret: "hlm_test"})
	for _, n := range []string{"Monitoring", "Monitoring (bis)"} {
		s.db.Exec(`INSERT INTO integrations (type, name, url, config) VALUES ('hlm', ?, ?, ?)`, n, hlm.URL, s.encrypt(string(cfg)))
	}
	count := func() (n int) { s.db.QueryRow(`SELECT COUNT(*) FROM assets`).Scan(&n); return }
	s.syncInventory(context.Background())
	if n := count(); n != 1 {
		t.Fatalf("two integrations and a duplicate host: %d items", n)
	}
	hosts = `[{"id":9,"name":"web","status":"operational","info":{"hostname":"web.lan","virtualization":"kvm"}}]` // enrolled again
	s.syncInventory(context.Background())
	var host int64
	s.db.QueryRow(`SELECT hlm_host_id FROM assets`).Scan(&host)
	if n := count(); n != 1 || host != 9 {
		t.Fatalf("host enrolled again: %d items, linked to %d", n, host)
	}
}

func TestProxmoxClusterSeenTwice(t *testing.T) {
	node := func(n string, mem float64) pveResource { return pveResource{"node": n, "maxcpu": 8.0, "maxmem": mem} }
	view := func() map[string]any {
		return map[string]any{
			"nodes":    []pveResource{node("pve-31", 32e9), node("pve-32", 32e9)},
			"guests":   []pveResource{{"node": "pve-31", "vmid": 100.0}, {"node": "pve-32", "vmid": 101.0}},
			"storages": []pveResource{{"node": "pve-31", "storage": "local"}},
		}
	}
	other := map[string]any{"nodes": []pveResource{node("pve-31", 16e9)}, "guests": []pveResource{{"node": "pve-31", "vmid": 100.0}}}
	out := dedupeProxmox([]source[map[string]any]{{ID: 1, Data: view()}, {ID: 2, Data: view()}, {ID: 3, Data: other}})
	if len(out[0].Data["nodes"].([]pveResource)) != 2 || len(out[1].Data["nodes"].([]pveResource)) != 0 || len(out[1].Data["guests"].([]pveResource)) != 0 {
		t.Fatalf("same cluster twice: %+v", out[1].Data)
	}
	if len(out[2].Data["nodes"].([]pveResource)) != 1 {
		t.Fatal("another server with the same node name was dropped")
	}
}

// Every management MCP tool runs on an empty database without SQL errors.
func TestManagementMCPTools(t *testing.T) {
	s, _, _ := newMgTestServer(t)
	s.db.Exec(`INSERT INTO assets (kind, display_name, status) VALUES ('physical', 'nas', 'online')`)
	for _, tool := range s.mcpTools() {
		args := map[string]any{"id": "1", "recherche": "nas"}
		if _, err := tool.run(context.Background(), args); err != nil {
			t.Errorf("%s: %v", tool.Name, err)
		}
	}
}

// The management signs in to the monitoring with an account, the monitoring's public API disabled:
// the token it gets is kept encrypted, replaced when revoked, and the password never travels again.
func TestMonitoringIntegrationWithAccount(t *testing.T) {
	mon, monTS := newTestServer(t)
	cookie := setupAdmin(t, mon, monTS)
	mon.db.Exec(`INSERT INTO hosts(name,token_hash,created_at) VALUES('nas',?,?)`, hashToken("agent"), time.Now().Unix())

	s, ts, tok := newMgTestServer(t)
	form := url.Values{"type": {"hlm"}, "name": {"Monitoring"}, "url": {monTS.URL}, "enabled": {"on"}, "verify_tls": {"on"},
		"username": {"admin"}, "password": {"wrong password!"}}
	if out := postForm(t, ts, tok, "/api/mg/integrations/test", form); !strings.Contains(out, "incorrect") {
		t.Fatal("bad password:", out)
	}
	form.Set("password", "correct horse battery")
	if out := postForm(t, ts, tok, "/api/mg/integrations/test", form); !strings.Contains(out, `"ok":true`) || !strings.Contains(out, "1 hôte") {
		t.Fatal("test:", out)
	}
	var n int
	mon.db.QueryRow(`SELECT COUNT(*) FROM api_tokens`).Scan(&n)
	if n != 0 {
		t.Fatalf("the connection test must revoke its token, %d left", n)
	}
	if out := postForm(t, ts, tok, "/api/mg/integrations", form); !strings.Contains(out, `"ok":true`) {
		t.Fatal("save:", out)
	}
	i, _ := s.getIntegration(1, "hlm")
	if _, err := s.hlmData(context.Background(), i); err != nil {
		t.Fatal("sync:", err)
	}
	i, _ = s.getIntegration(1, "hlm")
	first := i.Config.LoginToken
	if first == "" {
		t.Fatal("token not kept")
	}
	if _, err := s.hlmData(context.Background(), i); err != nil {
		t.Fatal(err)
	}
	mon.db.QueryRow(`SELECT COUNT(*) FROM api_tokens WHERE user_id IS NOT NULL`).Scan(&n)
	if n != 1 {
		t.Fatalf("one sign-in expected, got %d tokens", n)
	}
	// Revoked in Réglages → API: the next call signs in again.
	mon.db.Exec(`DELETE FROM api_tokens`)
	if _, err := s.hlmData(context.Background(), i); err != nil {
		t.Fatal("after revocation:", err)
	}
	if i, _ = s.getIntegration(1, "hlm"); i.Config.LoginToken == first || i.Config.LoginToken == "" {
		t.Fatal("new token not saved")
	}
	// A token created by hand still needs the public API.
	manual := createToken(t, monTS, cookie, []string{"status:read"}, nil)
	if code, _ := apiReq(t, monTS, "GET", "/api/v1/status", manual, ""); code != 404 {
		t.Fatalf("manual token with the API disabled: %d", code)
	}
	// Changing the password revokes the sign-ins.
	if resp, out := do(t, monTS, "POST", "/api/auth/password", cookie, map[string]string{"current": "correct horse battery", "new": "another long password"}); resp.StatusCode != 200 {
		t.Fatal(out)
	}
	if _, err := s.hlmData(context.Background(), i); err == nil || !strings.Contains(err.Error(), "incorrect") {
		t.Fatal("old password must fail:", err)
	}
}

// Proxmox with an account: one ticket for several calls, CSRF token on writes, new ticket when refused.
func TestProxmoxTicket(t *testing.T) {
	logins := 0
	ticket := "PVE:root@pam:1"
	pveSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api2/json/access/ticket" {
			r.ParseForm()
			if r.Form.Get("username") != "root@pam" || r.Form.Get("password") != "secret" {
				w.WriteHeader(401)
				return
			}
			logins++
			w.Write([]byte(`{"data":{"ticket":"` + ticket + `","CSRFPreventionToken":"csrf1"}}`))
			return
		}
		if c, _ := r.Cookie("PVEAuthCookie"); c == nil || c.Value != ticket || (r.Method != "GET" && r.Header.Get("CSRFPreventionToken") != "csrf1") {
			w.WriteHeader(401)
			return
		}
		w.Write([]byte(`{"data":"ok"}`))
	}))
	defer pveSrv.Close()
	i := &integration{ID: -1, Type: "proxmox", URL: pveSrv.URL, Config: integrationConfig{Username: "root@pam", Password: "secret"}}
	var out string
	for _, m := range []string{"GET", "POST", "GET"} {
		if err := pve(context.Background(), i, m, "/version", url.Values{}, &out); err != nil || out != "ok" {
			t.Fatalf("%s: %v %q", m, err, out)
		}
	}
	if logins != 1 {
		t.Fatalf("ticket not reused: %d sign-ins", logins)
	}
	ticket = "PVE:root@pam:2" // Proxmox restarted: the cached ticket is refused
	if err := pve(context.Background(), i, "GET", "/version", nil, &out); err != nil || logins != 2 {
		t.Fatalf("no new sign-in after a refused ticket: %v, %d", err, logins)
	}
	i.Config.Password = "nope"
	if err := pve(context.Background(), i, "GET", "/version", nil, &out); err == nil || !strings.Contains(err.Error(), "incorrect") {
		t.Fatal("bad password:", err)
	}
}

// The Node.js panel of an inventory item goes through the management relay to the monitoring.
func TestNodeAppsRelay(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	var got []string
	hlm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.Method+" "+r.URL.RequestURI())
		switch r.URL.Path {
		case "/api/v1/hosts/7/node-apps":
			w.WriteHeader(409)
			w.Write([]byte(`{"need_key":"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGv1bmVyeS1rZXktZm9yLXRlc3RzLW9ubHktMDEyMzQ1Njc4OQ hlm","error":"Ajoutez la deploy key au dépôt, puis réessayez."}`))
		default:
			w.Write([]byte(`{"text":"ok"}`))
		}
	}))
	defer hlm.Close()
	cfg, _ := json.Marshal(integrationConfig{TokenSecret: "hlm_test"})
	s.db.Exec(`INSERT INTO integrations (type, name, url, config) VALUES ('hlm', 'Monitoring', ?, ?)`, hlm.URL, s.encrypt(string(cfg)))
	if _, err := s.db.Exec(`INSERT INTO assets (display_name, kind, hlm_integration_id, hlm_host_id) VALUES ('web', 'vm', 1, 7)`); err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string) (int, map[string]any) {
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", ts.URL)
		req.AddCookie(&http.Cookie{Name: mgSessionCookie, Value: tok})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	if code, out := call("GET", "/api/mg/assets/1/node/node-apps/api/logs?lines=100", ""); code != 200 || out["text"] != "ok" {
		t.Fatalf("logs: %d %v", code, out)
	}
	if code, out := call("POST", "/api/mg/assets/1/node/node-apps", `{"name":"api"}`); code != 409 || !strings.HasPrefix(out["need_key"].(string), "ssh-ed25519 ") {
		t.Fatalf("need_key must reach the panel whole: %d %v", code, out)
	}
	for _, bad := range []string{`{"action":"apply_updates"}`, `nope`} {
		if code, _ := call("POST", "/api/mg/assets/1/node/action", bad); code != 400 {
			t.Fatalf("%s: only node_* actions are relayed, got %d", bad, code)
		}
	}
	if code, _ := call("GET", "/api/mg/assets/1/node/token", ""); code != 404 {
		t.Fatalf("other host routes must not be relayed, got %d", code)
	}
	if code, _ := call("POST", "/api/mg/assets/1/node/action", `{"action":"node_restart","target":"api"}`); code != 200 {
		t.Fatalf("restart: %d", code)
	}
	want := []string{"GET /api/v1/hosts/7/node-apps/api/logs?lines=100", "POST /api/v1/hosts/7/node-apps", "POST /api/v1/hosts/7/action"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("monitoring calls: %v", got)
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM activity WHERE summary LIKE '%Node.js de « web » : restart api%'`).Scan(&n)
	if n != 1 {
		t.Fatal("relayed write not in the journal")
	}
}
