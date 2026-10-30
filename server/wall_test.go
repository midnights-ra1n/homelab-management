package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestWallKey(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	wall := func(key string) int {
		req, _ := http.NewRequest("GET", ts.URL+"/api/public/wall", nil)
		req.Header.Set("X-Wall-Key", key)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if c := wall("anything"); c != 404 {
		t.Fatalf("wall without a link: %d", c)
	}
	_, out := do(t, ts, "POST", "/api/status/wall-key", cookie, nil)
	url, _ := out["url"].(string)
	_, key, ok := strings.Cut(url, "/wall#")
	if !ok || key == "" {
		t.Fatalf("no key in %q", url)
	}
	if c := wall(key); c != 200 {
		t.Fatalf("wall with its key: %d", c)
	}
	if c := wall(key + "x"); c != 404 {
		t.Fatalf("wall with a wrong key: %d", c)
	}
	do(t, ts, "DELETE", "/api/status/wall-key", cookie, nil)
	if c := wall(key); c != 404 {
		t.Fatalf("revoked wall: %d", c)
	}
}
