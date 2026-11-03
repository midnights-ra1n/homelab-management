package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestIptablesChangeIsConfirmedAndJournaled(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	_, created := do(t, ts, "POST", "/api/hosts", cookie, map[string]string{"name": "vm"})
	token := created["install"].(map[string]any)["token"].(string)
	nonce := make([]byte, 32)
	rand.Read(nonce)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/api/agent/ws", &websocket.DialOptions{HTTPHeader: http.Header{
		"Authorization": {"Bearer " + token}, "X-Agent-Nonce": {base64.StdEncoding.EncodeToString(nonce)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	var hello map[string]any
	wsjson.Read(ctx, c, &hello)

	// The fake agent records what reaches the root helper, in order.
	seen := make(chan string, 8)
	go func() {
		for {
			var m struct {
				Type, ID, Payload string
				Args              []string
			}
			if wsjson.Read(ctx, c, &m) != nil {
				return
			}
			if m.Type == "node_read" {
				seen <- m.Args[0] + "|" + m.Payload
				wsjson.Write(ctx, c, map[string]any{"type": "node_read", "read": map[string]any{"id": m.ID, "ok": true, "text": `{"available":true,"families":[]}`}})
			}
		}
	}()

	if resp, out := do(t, ts, "GET", "/api/hosts/1/iptables", cookie, nil); resp.StatusCode != 200 || out["available"] != true {
		t.Fatalf("list: %d %v", resp.StatusCode, out)
	}
	<-seen
	rule := map[string]string{"op": "add", "family": "4", "chain": "INPUT", "position": "top", "proto": "tcp", "dport": "443", "target": "ACCEPT"}
	if resp, out := do(t, ts, "POST", "/api/hosts/1/iptables", cookie, rule); resp.StatusCode != 200 {
		t.Fatalf("add: %d %v", resp.StatusCode, out)
	}
	if got := <-seen; got != "fw-apply|op=add\nfamily=4\nchain=INPUT\nposition=top\nproto=tcp\ndport=443\ntarget=ACCEPT\n" {
		t.Fatalf("apply: %q", got)
	}
	if got := <-seen; got != "fw-confirm|" {
		t.Fatalf("a change must be confirmed, got %q", got)
	}
	var message string
	s.db.QueryRow(`SELECT summary FROM activity ORDER BY id DESC LIMIT 1`).Scan(&message)
	if !strings.Contains(message, "INPUT tcp 443 ACCEPT") {
		t.Fatalf("journal: %q", message)
	}
	if resp, _ := do(t, ts, "POST", "/api/hosts/1/iptables", cookie, map[string]string{"op": "save"}); resp.StatusCode != 200 {
		t.Fatalf("save: %d", resp.StatusCode)
	}
	if got := <-seen; got != "fw-save|" {
		t.Fatalf("save: %q", got)
	}
	for _, bad := range []map[string]string{{"op": "flush"}, {"op": "add", "comment": "a\nop=delete"}} {
		if resp, _ := do(t, ts, "POST", "/api/hosts/1/iptables", cookie, bad); resp.StatusCode != 400 {
			t.Fatalf("%v accepted: %d", bad, resp.StatusCode)
		}
	}
	if len(seen) != 0 {
		t.Fatal("a refused request reached the agent")
	}
}
