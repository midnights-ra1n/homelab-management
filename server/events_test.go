package main

import (
	"bufio"
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

// The app's stream works with a sign-in token (API disabled) and groups the topics of one second.
func TestEventStream(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	if resp, _ := do(t, ts, "GET", "/api/events", "", nil); resp.StatusCode != 401 {
		t.Fatalf("web stream without a session: %d", resp.StatusCode)
	}
	_, out := apiReq(t, ts, "POST", "/api/v1/auth/login", "", `{"username":"admin","password":"correct horse battery","name":"iPhone"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", ts.URL+"/api/v1/events", nil)
	req.Header.Set("Authorization", "Bearer "+out["token"].(string))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("stream: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	lines := bufio.NewScanner(resp.Body)
	next := func(prefix string) string {
		for lines.Scan() {
			if l := lines.Text(); strings.HasPrefix(l, prefix) {
				return l
			}
		}
		t.Fatalf("stream ended before %q: %v", prefix, lines.Err())
		return ""
	}
	if l := next("event:"); l != "event: ready" {
		t.Fatal(l)
	}
	events.publish("metrics")
	events.publish("hosts")
	events.publish("metrics")
	next("event: changed")
	if l := next("data:"); l != `data: {"topics":["hosts","metrics"]}` {
		t.Fatal(l)
	}
	// A write through the UI reloads every live view.
	do(t, ts, "PUT", "/api/preferences", cookie, map[string]any{"theme": "dark"})
	next("event: changed")
	if l := next("data:"); l != `data: {"topics":["all"]}` {
		t.Fatal(l)
	}
}
