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
	s := &Server{mg: &mgState{key: key}}
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
