package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func serveGzip(t *testing.T, h http.Handler, accept string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Accept-Encoding", accept)
	w := httptest.NewRecorder()
	compress(h).ServeHTTP(w, r)
	return w
}

func gunzip(t *testing.T, b []byte) string {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func TestCompressPicksWhatIsWorthIt(t *testing.T) {
	big := strings.Repeat(`{"a":1}`, 500)
	json := func(body string, code int) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Length", "99999")
			w.WriteHeader(code)
			io.WriteString(w, body)
		})
	}
	w := serveGzip(t, json(big, 200), "br, gzip;q=0.8")
	if w.Header().Get("Content-Encoding") != "gzip" || w.Header().Get("Content-Length") != "" || gunzip(t, w.Body.Bytes()) != big {
		t.Fatalf("large JSON not gzipped: %v", w.Header())
	}
	for name, c := range map[string]struct {
		h      http.Handler
		accept string
	}{
		"small":   {json("{}", 200), "gzip"},
		"error":   {json(big, 500), "gzip"},
		"refused": {json(big, 200), "gzip;q=0"},
		"no gzip": {json(big, 200), "br"},
		"png": {http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "image/png")
			io.WriteString(w, big)
		}), "gzip"},
	} {
		w := serveGzip(t, c.h, c.accept)
		if w.Header().Get("Content-Encoding") != "" {
			t.Errorf("%s: compressed", name)
		}
		if !strings.Contains(w.Body.String(), "{") {
			t.Errorf("%s: body lost: %q", name, w.Body.String())
		}
	}
}

func TestCompressLeavesEventStreamsLive(t *testing.T) {
	w := serveGzip(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		io.WriteString(w, strings.Repeat("data: x\n\n", 500))
		if err := http.NewResponseController(w).Flush(); err != nil {
			t.Error(err)
		}
	}), "gzip")
	if w.Header().Get("Content-Encoding") != "" || !w.Flushed {
		t.Fatalf("event stream altered: %v flushed=%v", w.Header(), w.Flushed)
	}
}

func TestCacheJSONFollowsTheStateOfTheServer(t *testing.T) {
	calls := 0
	h := cacheJSON(time.Hour, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("X-Fail") != "" {
			writeErr(w, 500, "boom")
			return
		}
		writeJSON(w, 200, map[string]int{"n": calls})
	})
	get := func(target, accept string, fail bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, target, nil)
		r.Header.Set("Accept-Encoding", accept)
		if fail {
			r.Header.Set("X-Fail", "1")
		}
		w := httptest.NewRecorder()
		h(w, r)
		return w
	}
	cacheGen.Add(1) // another test may have left the same generation
	if w := get("/", "", true); w.Code != 500 {
		t.Fatalf("a failure must reach the client: %d", w.Code)
	}
	if w := get("/", "", false); w.Code != 200 || !strings.Contains(w.Body.String(), `"n":2`) {
		t.Fatalf("a failure must not be cached: %d %s", w.Code, w.Body)
	}
	if w := get("/", "gzip", false); gunzip(t, w.Body.Bytes()) != "{\"n\":2}\n" || calls != 2 {
		t.Fatalf("second read must hit the cache, gzipped: %d calls", calls)
	}
	events.publish("metrics")
	if get("/", "", false); calls != 2 {
		t.Fatal("metrics must not invalidate")
	}
	events.publish("hosts")
	if w := get("/", "", false); !strings.Contains(w.Body.String(), `"n":3`) {
		t.Fatalf("a state change must invalidate: %s", w.Body)
	}
	if get("/?packages=1", "", false); calls != 4 {
		t.Fatal("a query string bypasses the cache")
	}
}

func TestSettingsStayInMemoryUntilWritten(t *testing.T) {
	s, _ := newTestServer(t)
	if err := s.setSetting("timezone", "UTC"); err != nil {
		t.Fatal(err)
	}
	if v := s.getSetting("timezone", "x"); v != "UTC" {
		t.Fatal(v)
	}
	s.db.Exec(`UPDATE settings SET value='Europe/Paris' WHERE key='timezone'`)
	if v := s.getSetting("timezone", "x"); v != "UTC" {
		t.Fatalf("expected the memory copy, got %s", v)
	}
	if err := s.setSetting("timezone", "Asia/Tokyo"); err != nil {
		t.Fatal(err)
	}
	if v := s.getSetting("timezone", "x"); v != "Asia/Tokyo" {
		t.Fatal(v)
	}
	if v := s.getSetting("absent", "def"); v != "def" {
		t.Fatal(v)
	}
}

func TestNodeSnapshotOnlyWrittenWhenItChanged(t *testing.T) {
	s, _ := newTestServer(t)
	s.db.Exec(`INSERT INTO hosts(id,name,token_hash,created_at) VALUES(1,'vm',x'01',0)`)
	snap := func(st string) *nodeSnapshot { return &nodeSnapshot{Apps: []nodeApp{{Name: "site", Status: st}}} }
	if changed, err := s.storeNodeApps(1, "vm", snap("online")); err != nil || !changed {
		t.Fatal(changed, err)
	}
	s.db.Exec(`UPDATE hosts SET node_apps=json_set(node_apps,'$.collected_at',json_extract(node_apps,'$.collected_at')-60)`)
	before := nodeCollectedAt(s)
	if changed, _ := s.storeNodeApps(1, "vm", snap("online")); changed || nodeCollectedAt(s) != before {
		t.Fatal("same snapshot stored again")
	}
	s.db.Exec(`UPDATE hosts SET node_apps=json_set(node_apps,'$.collected_at',?)`, time.Now().Unix()-nodeRefresh-1)
	if changed, _ := s.storeNodeApps(1, "vm", snap("online")); changed || nodeCollectedAt(s) < time.Now().Unix()-5 {
		t.Fatal("an old snapshot must be refreshed, without announcing a change")
	}
	if changed, _ := s.storeNodeApps(1, "vm", snap("errored")); !changed {
		t.Fatal("a change must be announced")
	}
}

func nodeCollectedAt(s *Server) (v int64) {
	s.db.QueryRow(`SELECT json_extract(node_apps,'$.collected_at') FROM hosts WHERE id=1`).Scan(&v)
	return v
}

func TestRetentionUsesThePrimaryKey(t *testing.T) {
	s, _ := newTestServer(t)
	for _, q := range s.retentionQueries() {
		rows, err := s.db.Query(`EXPLAIN QUERY PLAN `+q.sql, q.arg)
		if err != nil {
			t.Fatal(q.sql, err)
		}
		var plan strings.Builder
		for rows.Next() {
			var id, parent, aux int
			var detail string
			rows.Scan(&id, &parent, &aux, &detail)
			plan.WriteString(detail + "\n")
		}
		rows.Close()
		if strings.Contains(q.sql, " IN (SELECT") && !strings.Contains(plan.String(), "SEARCH") {
			t.Errorf("%s scans the table:\n%s", q.sql, plan.String())
		}
	}
}

func TestPluralAgreesWithItsNumber(t *testing.T) {
	for in, want := range map[string]string{
		"1 hôte(s) · 3 paquet(s)": "1 hôte · 3 paquets",
		"0 agent(s) connecté(s)":  "0 agent connecté",
		"2 sous-réseau(x)":        "2 sous-réseaux",
		"URL http(s) invalide":    "URL http(s) invalide",
	} {
		if got := plural(in); got != want {
			t.Errorf("plural(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestManagementShellHasItsOwnIcons(t *testing.T) {
	got := managementShell.Replace(`<link rel="icon" href="/favicon.ico" /><link rel="icon" href="/icon.svg" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" />`)
	want := `<link rel="icon" href="/mg/favicon.ico" /><link rel="icon" href="/mg/icon.svg" /><link rel="apple-touch-icon" href="/mg/apple-touch-icon.png" />`
	if got != want {
		t.Fatalf("the management shell must not use the monitoring's icons:\n%s", got)
	}
}
