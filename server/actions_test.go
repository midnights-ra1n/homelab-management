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

func TestVersionLess(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"v0.1.2", "v0.1.10", true}, {"v0.1.10", "v0.1.2", false}, {"v0.1.2", "v0.1.2", false},
		{"v0.2.0", "v0.1.9", false}, {"dev", "v0.1.2", false}, {"v0.1.2", "", false},
	}
	for _, c := range cases {
		if got := versionLess(c.a, c.b); got != c.want {
			t.Errorf("versionLess(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

func TestHostActionRoundTrip(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	_, created := do(t, ts, "POST", "/api/hosts", cookie, map[string]string{"name": "pve"})
	token := created["install"].(map[string]any)["token"].(string)
	path := "/api/hosts/1/action"
	if resp, _ := do(t, ts, "POST", path, cookie, map[string]string{"action": "check_updates"}); resp.StatusCode != 409 {
		t.Fatalf("offline agent must give 409, got %d", resp.StatusCode)
	}

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

	if resp, out := do(t, ts, "POST", path, cookie, map[string]string{"action": "rm -rf /"}); resp.StatusCode != 400 {
		t.Fatalf("unknown action: %d %v", resp.StatusCode, out)
	}
	if resp, out := do(t, ts, "POST", path, cookie, map[string]string{"action": "apply_updates"}); resp.StatusCode != 200 || out["action"].(map[string]any)["state"] != "pending" {
		t.Fatalf("send action: %d %v", resp.StatusCode, out)
	}
	var got map[string]string
	if err := wsjson.Read(ctx, c, &got); err != nil || got["type"] != "action" || got["action"] != "apply_updates" {
		t.Fatalf("agent received %v %v", got, err)
	}
	if resp, _ := do(t, ts, "POST", path, cookie, map[string]string{"action": "check_updates"}); resp.StatusCode != 409 {
		t.Fatal("a second action while one is pending must give 409")
	}
	wsjson.Write(ctx, c, map[string]string{"type": "action_result", "action": "apply_updates", "state": "done", "message": "3 upgraded"})
	for i := 0; i < 50; i++ {
		_, h := do(t, ts, "GET", "/api/hosts/1", cookie, nil)
		if a, _ := h["action"].(map[string]any); a != nil && a["state"] == "done" && a["message"] == "3 upgraded" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("action result not stored")
}

func TestDockerSnapshotAndContainerUpdate(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	_, created := do(t, ts, "POST", "/api/hosts", cookie, map[string]string{"name": "docker-01"})
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
	wsjson.Write(ctx, c, map[string]any{"type": "docker", "docker": map[string]any{"containers": []map[string]any{
		{"name": "nextcloud-app-1", "image": "nextcloud:29", "state": "running", "update": "available", "compose_project": "nextcloud", "compose_service": "app"},
		{"name": "old", "image": "redis:7", "state": "exited", "update": "up_to_date"},
	}}})
	var d map[string]any
	for i := 0; i < 50 && d == nil; i++ {
		_, h := do(t, ts, "GET", "/api/hosts/1", cookie, nil)
		d, _ = h["docker"].(map[string]any)
		time.Sleep(20 * time.Millisecond)
	}
	if d == nil || d["running"] != 1.0 || d["updates_available"] != 1.0 {
		t.Fatalf("docker summary: %v", d)
	}
	if resp, _ := do(t, ts, "POST", "/api/hosts/1/action", cookie, map[string]string{"action": "update_container", "target": "x; rm -rf /"}); resp.StatusCode != 400 {
		t.Fatal("container names with shell characters must be refused")
	}
	if resp, _ := do(t, ts, "POST", "/api/hosts/1/action", cookie, map[string]string{"action": "update_container", "target": "nextcloud-app-1"}); resp.StatusCode != 200 {
		t.Fatal("update_container")
	}
	var got map[string]string
	if wsjson.Read(ctx, c, &got); got["target"] != "nextcloud-app-1" {
		t.Fatalf("agent got %v", got)
	}
	wsjson.Write(ctx, c, map[string]string{"type": "action_result", "action": "update_container", "state": "done", "message": "ok"})
	for i := 0; i < 50; i++ {
		_, h := do(t, ts, "GET", "/api/hosts/1", cookie, nil)
		if a, _ := h["action"].(map[string]any); a != nil && a["state"] == "done" {
			if a["target"] != "nextcloud-app-1" {
				t.Fatalf("target lost: %v", a)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("result not stored")
}

// A Proxmox node gets one token per new container, never a shared one.
func TestLXCTokenPerContainer(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	_, created := do(t, ts, "POST", "/api/hosts", cookie, map[string]string{"name": "pve"})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	dial := func(tok string) (*websocket.Conn, error) {
		nonce := make([]byte, 32)
		rand.Read(nonce)
		c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/api/agent/ws", &websocket.DialOptions{HTTPHeader: http.Header{
			"Authorization": {"Bearer " + tok}, "X-Agent-Nonce": {base64.StdEncoding.EncodeToString(nonce)}}})
		if err == nil {
			var hello map[string]any
			wsjson.Read(ctx, c, &hello)
		}
		return c, err
	}
	c, err := dial(created["install"].(map[string]any)["token"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	wsjson.Write(ctx, c, map[string]any{"type": "pve", "pve": map[string]any{"guests": []any{}, "cts": []int{105}}})
	wsjson.Write(ctx, c, map[string]any{"type": "lxc_token", "ct": 999, "name": "rogue"}) // not in the report: no answer
	ask := func() string {
		wsjson.Write(ctx, c, map[string]any{"type": "lxc_token", "ct": 105, "name": "web.lan"})
		var got map[string]any
		if err := wsjson.Read(ctx, c, &got); err != nil || got["type"] != "lxc_token" || got["ct"] != float64(105) {
			t.Fatalf("lxc_token answer: %v %v", got, err)
		}
		return got["token"].(string)
	}
	first, second := ask(), ask()
	var n, parent, vmid int
	s.db.QueryRow(`SELECT COUNT(*), MAX(parent_id), MAX(vmid) FROM hosts WHERE name='web'`).Scan(&n, &parent, &vmid)
	if first == second || n != 1 || parent != 1 || vmid != 105 {
		t.Fatalf("one host under the node, token replaced: n=%d parent=%d vmid=%d", n, parent, vmid)
	}
	if _, err := dial(first); err == nil {
		t.Fatal("the replaced token must be refused")
	}
	ct, err := dial(second)
	if err != nil {
		t.Fatal(err)
	}
	defer ct.CloseNow()
	wsjson.Write(ctx, c, map[string]any{"type": "lxc_token", "ct": 105, "name": "web"}) // connected: refused
	var none map[string]any
	short, stop := context.WithTimeout(ctx, 300*time.Millisecond)
	defer stop()
	if wsjson.Read(short, c, &none) == nil {
		t.Fatalf("a connected container must keep its token, got %v", none)
	}
}
