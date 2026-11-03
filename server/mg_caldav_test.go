package main

import (
	"context"
	"database/sql"
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
			if !strings.HasPrefix(href, r.URL.Path) {
				continue // another list
			}
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
		d.n++
		delete(d.items, r.URL.Path)
		w.WriteHeader(204)
	case "PROPFIND":
		w.WriteHeader(207)
		fmt.Fprintf(w, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:response><d:href>%s</d:href>`+
			`<d:propstat><d:prop><cs:getctag>c%d</cs:getctag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`+
			`<d:propstat><d:prop><d:sync-token/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>`, r.URL.Path, d.n)
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
	parisTZ(t)
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
	var prio, due, at string
	if err := s.db.QueryRow(`SELECT id, priority, due_date, due_time FROM tasks WHERE title = 'Acheter du lait'`).Scan(&id, &prio, &due, &at); err != nil ||
		prio != "critical" || due != "2026-10-30" || at != "09:00" {
		t.Fatal("import:", err, prio, due, at)
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

// parisTZ sets the server's zone (the test server loads it from the settings) for the test.
func parisTZ(t *testing.T) {
	l, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		t.Skip(err)
	}
	tzLoc.Store(l)
	t.Cleanup(func() { tzLoc.Store(time.UTC) })
}

// A time set here is sent in UTC with an alarm; a new time drops the alarm set at the old moment
// and keeps the relative ones.
func TestVTODODueTime(t *testing.T) {
	parisTZ(t)
	f := taskFields{title: "Sauvegarde", status: "todo", priority: "medium",
		due: sql.NullString{String: "2026-11-02", Valid: true}, dueTime: sql.NullString{String: "15:30", Valid: true}}
	out := buildVTODO("", "u1", f, time.Now())
	for _, want := range []string{"DUE:20261102T143000Z", "TRIGGER;RELATED=END:PT0S"} {
		if !strings.Contains(out, want) {
			t.Fatalf("%q missing:\n%s", want, out)
		}
	}
	if g, _, _, _ := parseVTODO(out); g.due != f.due || g.dueTime != f.dueTime {
		t.Fatalf("round trip: %v %v", g.due, g.dueTime)
	}
	base := "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:a\r\nSUMMARY:x\r\nDUE;TZID=Europe/Paris:20261102T153000\r\n" +
		"BEGIN:VALARM\r\nTRIGGER;VALUE=DATE-TIME:20261102T143000Z\r\nEND:VALARM\r\n" +
		"BEGIN:VALARM\r\nTRIGGER:-PT1H\r\nEND:VALARM\r\nEND:VTODO\r\nEND:VCALENDAR\r\n"
	if same := buildVTODO(base, "a", f, time.Now()); !strings.Contains(same, "DUE;TZID=Europe/Paris:20261102T153000") ||
		!strings.Contains(same, "VALUE=DATE-TIME") {
		t.Fatalf("same moment rewritten:\n%s", same)
	}
	f.dueTime.String = "18:00"
	moved := buildVTODO(base, "a", f, time.Now())
	if strings.Contains(moved, "VALUE=DATE-TIME") || !strings.Contains(moved, "TRIGGER:-PT1H") ||
		strings.Contains(moved, "RELATED=END") || !strings.Contains(moved, "DUE:20261102T170000Z") {
		t.Fatalf("alarms after a new time:\n%s", moved)
	}
	f.dueTime = sql.NullString{}
	if day := buildVTODO(base, "a", f, time.Now()); !strings.Contains(day, "DUE;VALUE=DATE:20261102") {
		t.Fatalf("all day:\n%s", day)
	}
}

// Each task syncs with its own list; moving it deletes the old copy without importing it back.
func TestTaskCalDAVLists(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	dav := &fakeDAV{items: map[string]remoteTodo{}}
	ds := httptest.NewServer(dav)
	defer ds.Close()
	cfg := s.encrypt(`{"username":"admin","password":"app-pass"}`)
	var perso, pro int64
	for name, id := range map[string]*int64{"perso": &perso, "pro": &pro} {
		res, _ := s.db.Exec(`INSERT INTO integrations (type, name, url, config) VALUES ('nextcloud', ?, ?, ?)`, name, ds.URL+"/dav/"+name+"/", cfg)
		*id, _ = res.LastInsertId()
	}
	sync := func() {
		t.Helper()
		if _, err := s.syncTasks(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	inList := func(list string) (n int) {
		for href := range dav.items {
			if strings.HasPrefix(href, "/dav/"+list+"/") {
				n++
			}
		}
		return
	}
	postForm(t, ts, tok, "/api/mg/tasks", url.Values{"title": {"Facture"}, "status": {"todo"}, "priority": {"low"}, "caldav_list": {fmt.Sprint(pro)}})
	postForm(t, ts, tok, "/api/mg/tasks", url.Values{"title": {"Courses"}, "status": {"todo"}, "priority": {"low"}})
	sync()
	if inList("pro") != 1 || inList("perso") != 1 {
		t.Fatalf("lists: pro %d, perso %d", inList("pro"), inList("perso"))
	}
	var id int64
	s.db.QueryRow(`SELECT id FROM tasks WHERE title = 'Facture'`).Scan(&id)
	postForm(t, ts, tok, fmt.Sprintf("/api/mg/tasks/%d", id), url.Values{"title": {"Facture"}, "status": {"todo"}, "priority": {"low"}, "caldav_list": {fmt.Sprint(perso)}})
	sync()
	sync()
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM tasks`).Scan(&n)
	if inList("pro") != 0 || inList("perso") != 2 || n != 2 {
		t.Fatalf("after move: pro %d, perso %d, tasks %d", inList("pro"), inList("perso"), n)
	}
	if out := postForm(t, ts, tok, "/api/mg/tasks", url.Values{"title": {"x"}, "status": {"todo"}, "priority": {"low"}, "due_time": {"10:00"}}); !strings.Contains(out, "Choisis aussi une date") {
		t.Fatal("a time without a date:", out)
	}
	if out := postForm(t, ts, tok, "/api/mg/tasks", url.Values{"title": {"x"}, "status": {"todo"}, "priority": {"low"}, "caldav_list": {"999"}}); !strings.Contains(out, "introuvable") {
		t.Fatal("an unknown list:", out)
	}
}

// A write here reaches Nextcloud within seconds, and an edit there moves the list's change tag.
func TestTaskSyncImmediate(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	dav := &fakeDAV{items: map[string]remoteTodo{}}
	ds := httptest.NewServer(dav)
	defer ds.Close()
	s.db.Exec(`INSERT INTO integrations (type, name, url, config) VALUES ('nextcloud', 'Rappels', ?, ?)`,
		ds.URL+"/dav/rappels/", s.encrypt(`{"username":"admin","password":"app-pass"}`))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.runTaskSync(ctx)
	before := s.taskListTags(ctx)
	if before == "" {
		t.Fatal("no change tag")
	}
	postForm(t, ts, tok, "/api/mg/tasks", url.Values{"title": {"Tout de suite"}, "status": {"todo"}, "priority": {"low"}})
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(100 * time.Millisecond) {
		dav.mu.Lock()
		n := len(dav.items)
		dav.mu.Unlock()
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("task not sent within 5 s")
		}
	}
	if s.taskListTags(ctx) == before {
		t.Fatal("change tag did not move")
	}
}
