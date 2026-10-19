package main

import (
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMCPOnlyOverHTTPSWithToken(t *testing.T) {
	dir := t.TempDir()
	db, err := openDB(dir)
	if err != nil {
		t.Fatal(err)
	}
	priv, _ := loadOrCreateKey(dir)
	s := &Server{cfg: Config{DataDir: dir, Role: RoleMonitoring}, db: db, priv: priv, key: make([]byte, 32), pub: priv.Public().(ed25519.PublicKey),
		limiter: newRateLimiter(100, time.Minute), agents: map[int64]*agentConn{}}
	s.notifier = newNotifier(s)
	plain := httptest.NewServer(s.routes())
	tls := httptest.NewTLSServer(s.routes())
	t.Cleanup(func() { plain.Close(); tls.Close(); db.Close() })

	call := func(base *httptest.Server, token, body string) (int, string) {
		req, _ := http.NewRequest("POST", base.URL+"/api/mcp", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := base.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	init := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}`

	if code, _ := call(plain, "x", init); code != 403 {
		t.Fatalf("plain http must be refused, got %d", code)
	}
	if code, _ := call(tls, "x", init); code != 404 {
		t.Fatalf("disabled must answer 404, got %d", code)
	}
	s.setSetting("mcp_enabled", "true")
	tok := "mcp_secret-token"
	s.setSetting("mcp_token_hash", fmt.Sprintf("%x", hashToken(tok)))
	if code, _ := call(tls, "wrong", init); code != 401 {
		t.Fatalf("bad token must answer 401, got %d", code)
	}
	code, out := call(tls, tok, init)
	if code != 200 || !strings.Contains(out, `"protocolVersion":"2025-03-26"`) {
		t.Fatalf("initialize: %d %s", code, out)
	}
	if code, _ := call(tls, tok, `{"jsonrpc":"2.0","method":"notifications/initialized"}`); code != 202 {
		t.Fatalf("notification: %d", code)
	}
	_, out = call(tls, tok, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	if !strings.Contains(out, "etat_global") {
		t.Fatal(out)
	}
	_, out = call(tls, tok, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"etat_global","arguments":{}}}`)
	var res struct {
		Result struct {
			Content []struct{ Text string } `json:"content"`
		} `json:"result"`
	}
	if json.Unmarshal([]byte(out), &res) != nil || len(res.Result.Content) != 1 || !strings.Contains(res.Result.Content[0].Text, "Opérationnel") {
		t.Fatalf("tools/call: %s", out)
	}
}
