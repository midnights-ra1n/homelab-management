package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeDAV is a minimal CalDAV task list: REPORT lists, PUT honours If-Match / If-None-Match.
type fakeDAV struct {
	mu    sync.Mutex
	items map[string]remoteTodo
	n     int
}

func (d *fakeDAV) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if u, p, _ := r.BasicAuth(); u != "admin" || p != "app-pass" {
		w.WriteHeader(401)
		return
	}
	switch r.Method {
	case "REPORT":
		var b strings.Builder
		b.WriteString(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">`)
		for href, it := range d.items {
			fmt.Fprintf(&b, `<d:response><d:href>%s</d:href><d:propstat><d:prop><d:getetag>%s</d:getetag><cal:calendar-data>%s</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
				(&url.URL{Path: href}).String(), it.etag, strings.ReplaceAll(it.data, "&", "&amp;"))
		}
		b.WriteString(`</d:multistatus>`)
		w.WriteHeader(207)
		io.WriteString(w, b.String())
	case "PUT":
		cur, exists := d.items[r.URL.Path]
		if (r.Header.Get("If-None-Match") == "*" && exists) || (r.Header.Get("If-Match") != "" && r.Header.Get("If-Match") != cur.etag) {
			w.WriteHeader(412)
			return
		}
		body, _ := io.ReadAll(r.Body)
		d.put(r.URL.Path, string(body))
		w.Header().Set("ETag", d.items[r.URL.Path].etag)
		w.WriteHeader(201)
	case "DELETE":
		delete(d.items, r.URL.Path)
		w.WriteHeader(204)
	}
}

func (d *fakeDAV) put(href, data string) {
	d.n++
	d.items[href] = remoteTodo{fmt.Sprintf(`"e%d"`, d.n), data}
}

// Tasks go to Nextcloud, reminders come back, edits and deletions travel both ways, and the
// properties the tasks do not know (an alarm) survive an edit made here.
func TestTaskCalDAVSync(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	dav := &fakeDAV{items: map[string]remoteTodo{}}
	ds := httptest.NewServer(dav)
	defer ds.Close()
	list := "/remote.php/dav/calendars/admin/mes rappels/"
	s.db.Exec(`INSERT INTO integrations (type, name, url, config) VALUES ('nextcloud', 'Nextcloud', ?, ?)`,
		ds.URL+"/remote.php/dav/calendars/admin/mes%20rappels", s.encrypt(`{"username":"admin","password":"app-pass"}`))
	sync := func() string {
		t.Helper()
		msg, err := s.syncTasks(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		return msg
	}

	postForm(t, ts, tok, "/api/mg/tasks", url.Values{"title": {"Changer le disque, vite"}, "status": {"todo"}, "priority": {"high"}, "due_date": {"2026-11-02"}})
	dav.mu.Lock()
	dav.put(list+"apple-1.ics", "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:apple-1\r\nSUMMARY:Acheter du lait\r\n"+
		"DUE;TZID=Europe/Paris:20261030T090000\r\nPRIORITY:1\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Rappel\r\n"+
		"TRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VTODO\r\nEND:VCALENDAR\r\n")
	dav.put(list+"old.ics", "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:old\r\nSUMMARY:Fini\r\nSTATUS:COMPLETED\r\nEND:VTODO\r\nEND:VCALENDAR\r\n")
	dav.mu.Unlock()
	if msg := sync(); !strings.Contains(msg, "1 envoyée(s)") || !strings.Contains(msg, "1 importée(s)") {
		t.Fatal(msg)
	}
	var pushed string
	for href, it := range dav.items {
		if href != list+"apple-1.ics" && href != list+"old.ics" {
			pushed = it.data
		}
	}
	for _, want := range []string{`SUMMARY:Changer le disque\, vite`, "PRIORITY:3", "DUE;VALUE=DATE:20261102", "STATUS:NEEDS-ACTION"} {
		if !strings.Contains(pushed, want) {
			t.Fatalf("pushed VTODO lacks %q:\n%s", want, pushed)
		}
	}
	var id int64
	var prio, due string
	if err := s.db.QueryRow(`SELECT id, priority, due_date FROM tasks WHERE title = 'Acheter du lait'`).Scan(&id, &prio, &due); err != nil || prio != "critical" || due != "2026-10-30" {
		t.Fatal("import:", err, prio, due)
	}
	if s.db.QueryRow(`SELECT id FROM tasks WHERE title = 'Fini'`).Scan(new(int64)) == nil {
		t.Fatal("a completed reminder was imported")
	}

	// Done here: the alarm and the time of day stay on the reminder.
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/mg/tasks/%d/move", ts.URL, id), strings.NewReader(`{"status":"done"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", ts.URL)
	req.AddCookie(&http.Cookie{Name: mgSessionCookie, Value: tok})
	if resp, err := http.DefaultClient.Do(req); err != nil || resp.StatusCode != 204 {
		t.Fatal("move", err)
	}
	sync()
	got := dav.items[list+"apple-1.ics"].data
	for _, want := range []string{"STATUS:COMPLETED", "TRIGGER:-PT15M", "DUE;TZID=Europe/Paris:20261030T090000"} {
		if !strings.Contains(got, want) {
			t.Fatalf("after done, %q missing:\n%s", want, got)
		}
	}

	// Edited on the iPhone, then deleted there.
	dav.mu.Lock()
	dav.put(list+"apple-1.ics", strings.Replace(got, "SUMMARY:Acheter du lait", "SUMMARY:Acheter du lait d'avoine", 1))
	dav.mu.Unlock()
	sync()
	var title string
	s.db.QueryRow(`SELECT title FROM tasks WHERE id = ?`, id).Scan(&title)
	if title != "Acheter du lait d'avoine" {
		t.Fatalf("remote edit not pulled: %q", title)
	}
	dav.mu.Lock()
	delete(dav.items, list+"apple-1.ics")
	dav.mu.Unlock()
	sync()
	if s.db.QueryRow(`SELECT id FROM tasks WHERE id = ?`, id).Scan(new(int64)) == nil {
		t.Fatal("task deleted in Nextcloud still here")
	}

	// Deleted here: deleted there.
	req, _ = http.NewRequest("DELETE", ts.URL+"/api/mg/tasks/1", nil)
	req.Header.Set("Origin", ts.URL)
	req.AddCookie(&http.Cookie{Name: mgSessionCookie, Value: tok})
	if resp, err := http.DefaultClient.Do(req); err != nil || resp.StatusCode >= 300 {
		t.Fatal("delete", err)
	}
	sync()
	if len(dav.items) != 1 {
		t.Fatalf("remote items after local delete: %d", len(dav.items))
	}
}

func TestVTODOFolding(t *testing.T) {
	long := strings.Repeat("é", 60)
	out := buildVTODO("", "u1", taskFields{title: long, status: "todo", priority: "medium"}, time.Now())
	for _, l := range strings.Split(out, "\r\n") {
		if len(l) > 75 {
			t.Fatalf("line of %d octets", len(l))
		}
	}
	if f, uid, _, _ := parseVTODO(out); f.title != long || uid != "u1" {
		t.Fatalf("round trip: %q %q", f.title, uid)
	}
}
