package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

// Monitoring: what /api/export writes, /api/import on a fresh server must accept as is.
func TestMonitoringExportImportRoundTrip(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	for _, m := range []map[string]any{
		{"name": "Site", "type": "http", "target": "https://example.fr", "category": "Web"},
		{"name": "Switch", "type": "snmp", "target": "192.168.1.2", "config": map[string]any{"oid": "1.3.6.1.2.1.1.3.0", "snmp_version": "3", "snmp_user": "ro", "auth_proto": "SHA", "auth_pass": "secret123"}},
		{"name": "NAS", "type": "truenas", "target": "https://nas.lan", "config": map[string]any{"api_key": "1-abc"}},
	} {
		if resp, out := do(t, ts, "POST", "/api/monitors", cookie, m); resp.StatusCode != 201 {
			t.Fatalf("create %v: %v", m["name"], out)
		}
	}
	resp, doc := do(t, ts, "GET", "/api/export?metrics=1", cookie, nil)
	if resp.StatusCode != 200 || doc["format"] != exportFormat {
		t.Fatalf("export: %d %v", resp.StatusCode, doc)
	}
	if b, _ := json.Marshal(doc); strings.Contains(string(b), "secret123") || strings.Contains(string(b), "1-abc") {
		t.Fatal("secrets leaked in the export")
	}

	s2, ts2 := newTestServer(t)
	cookie2 := setupAdmin(t, s2, ts2)
	if resp, out := do(t, ts2, "POST", "/api/import", cookie2, doc); resp.StatusCode != 200 || out["monitors_added"] != float64(3) {
		t.Fatalf("import: %d %v", resp.StatusCode, out)
	}
	mons, _ := s2.loadMonitors("WHERE name='Site'")
	if len(mons) != 1 || mons[0].Category != "Web" {
		t.Fatalf("category lost on import: %+v", mons)
	}
}

// Management: the settings page links (with and without secrets) and the restore form.
func TestManagementExportImportRoundTrip(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	cfg, _ := json.Marshal(integrationConfig{TokenSecret: "hlm_secret"})
	s.db.Exec(`INSERT INTO integrations (type, name, url, config) VALUES ('hlm', 'Monitoring', 'https://mon.lan', ?)`, s.encrypt(string(cfg)))
	s.db.Exec(`INSERT INTO assets (kind, display_name, status) VALUES ('physical', 'NAS', 'online')`)

	get := func(path string) []byte {
		req, _ := http.NewRequest("GET", ts.URL+path, nil)
		req.AddCookie(&http.Cookie{Name: mgSessionCookie, Value: tok})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Type"), "json") {
			t.Fatalf("GET %s: %d %s", path, resp.StatusCode, b[:min(len(b), 200)])
		}
		return b
	}
	plain, withSecrets := get("/api/mg/export"), get("/api/mg/export?secrets=1")
	if strings.Contains(string(plain), "hlm_secret") || !strings.Contains(string(withSecrets), "hlm_secret") {
		t.Fatal("secrets must only be in the export with secrets")
	}

	for _, backup := range [][]byte{plain, withSecrets} {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile("file", "backup.json")
		fw.Write(backup)
		mw.WriteField("confirm", "on")
		mw.Close()
		req, _ := http.NewRequest("POST", ts.URL+"/api/mg/import", &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Origin", ts.URL)
		req.AddCookie(&http.Cookie{Name: mgSessionCookie, Value: tok})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var st map[string]any
		json.NewDecoder(resp.Body).Decode(&st)
		resp.Body.Close()
		if st["ok"] != true {
			t.Fatalf("restore: %v", st)
		}
	}
	var name string
	s.db.QueryRow(`SELECT display_name FROM assets`).Scan(&name)
	list, _ := s.loadIntegrations(`WHERE type = 'hlm'`)
	if name != "NAS" || len(list) != 1 || list[0].Config.TokenSecret != "hlm_secret" {
		t.Fatalf("after restore: %q %+v", name, list)
	}
}
