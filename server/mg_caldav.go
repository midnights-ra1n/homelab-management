package main

// Two-way sync of the tasks with Nextcloud task lists (CalDAV VTODO), one integration per list. Apple Reminders syncs with
// the same list once the Nextcloud account is added on the device (CalDAV account), so one link
// covers Nextcloud, iOS and macOS. The VTODO received is kept: a push only rewrites the fields the
// tasks know, so alarms, times and Apple's own properties survive an edit made here.

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	taskSyncMu   sync.Mutex
	taskSyncKick = make(chan struct{}, 1)
)

type remoteTodo struct{ etag, data string }

const caldavQuery = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter>
</c:calendar-query>`

// caldavBase is the task list's URL; hrefs are kept as decoded paths and resolved against it.
func caldavBase(i *integration) (*url.URL, error) {
	u, err := url.Parse(strings.TrimRight(i.URL, "/") + "/")
	if err != nil {
		return nil, integrationErr("URL de la liste invalide")
	}
	return u, nil
}

func caldavReq(ctx context.Context, i *integration, method, href string, hdr map[string]string, body string) (int, http.Header, []byte, error) {
	base, err := caldavBase(i)
	if err != nil {
		return 0, nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, base.ResolveReference(&url.URL{Path: href}).String(), strings.NewReader(body))
	if err != nil {
		return 0, nil, nil, err
	}
	req.SetBasicAuth(i.Config.Username, i.Config.Password)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	client := secureHTTP
	if !i.Config.verify(true) {
		client = insecureHTTP
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, nil, integrationErr("Nextcloud injoignable : " + err.Error())
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return 0, nil, nil, integrationErr("Réponse de Nextcloud interrompue")
	}
	switch resp.StatusCode {
	case 401, 403:
		return 0, nil, nil, integrationErr("Identifiant ou mot de passe d'application refusé par Nextcloud")
	}
	return resp.StatusCode, resp.Header, b, nil
}

// caldavList returns every VTODO of the list, by decoded path.
func caldavList(ctx context.Context, i *integration) (map[string]remoteTodo, error) {
	code, _, b, err := caldavReq(ctx, i, "REPORT", "", map[string]string{"Depth": "1", "Content-Type": "application/xml; charset=utf-8"}, caldavQuery)
	if err != nil {
		return nil, err
	}
	if code == 404 {
		return nil, integrationErr("Liste introuvable : vérifie l'URL (lien CalDAV de la liste de tâches)")
	}
	if code != 207 {
		return nil, integrationErr(fmt.Sprintf("Réponse inattendue de Nextcloud (HTTP %d) : est-ce bien l'URL CalDAV d'une liste ?", code))
	}
	var ms struct {
		Responses []struct {
			Href     string `xml:"href"`
			Propstat []struct {
				Status string `xml:"status"`
				Prop   struct {
					ETag string `xml:"getetag"`
					Data string `xml:"calendar-data"`
				} `xml:"prop"`
			} `xml:"propstat"`
		} `xml:"response"`
	}
	if err := xml.Unmarshal(b, &ms); err != nil {
		return nil, integrationErr("Réponse CalDAV illisible")
	}
	out := map[string]remoteTodo{}
	for _, r := range ms.Responses {
		u, err := url.Parse(r.Href)
		if err != nil {
			continue
		}
		for _, p := range r.Propstat {
			if strings.Contains(p.Status, " 200") && p.Prop.Data != "" {
				out[u.Path] = remoteTodo{p.Prop.ETag, p.Prop.Data}
			}
		}
	}
	return out, nil
}

// caldavCTag returns the list's change tag (CalendarServer getctag and the WebDAV sync token).
func caldavCTag(ctx context.Context, i *integration) (string, error) {
	code, _, b, err := caldavReq(ctx, i, "PROPFIND", "", map[string]string{"Depth": "0", "Content-Type": "application/xml; charset=utf-8"},
		`<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><cs:getctag/><d:sync-token/></d:prop></d:propfind>`)
	if err != nil {
		return "", err
	}
	if code != 207 {
		return "", integrationErr(fmt.Sprintf("HTTP %d", code))
	}
	var ms struct {
		Prop []struct {
			CTag  string `xml:"getctag"`
			Token string `xml:"sync-token"`
		} `xml:"response>propstat>prop"`
	}
	if err := xml.Unmarshal(b, &ms); err != nil {
		return "", err
	}
	var tag string
	for _, p := range ms.Prop {
		tag += p.CTag + p.Token
	}
	return tag, nil
}

/* ------------------------------------------------------------ iCalendar */

var (
	icsUnescape = strings.NewReplacer(`\n`, "\n", `\N`, "\n", `\,`, ",", `\;`, ";", `\\`, `\`)
	icsEscape   = strings.NewReplacer(`\`, `\\`, "\r", "", "\n", `\n`, ",", `\,`, ";", `\;`)
)

func icsLines(data string) []string {
	data = strings.ReplaceAll(data, "\r\n", "\n")
	data = strings.ReplaceAll(strings.ReplaceAll(data, "\n ", ""), "\n\t", "")
	return strings.Split(strings.TrimRight(data, "\n"), "\n")
}

// icsProp splits "NAME;PARAM=…:value" (a quoted parameter may hold a colon).
func icsProp(line string) (name, value string) {
	quoted := false
	for i, c := range line {
		if c == '"' {
			quoted = !quoted
		} else if c == ':' && !quoted {
			name, _, _ = strings.Cut(line[:i], ";")
			return strings.ToUpper(name), line[i+1:]
		}
	}
	return strings.ToUpper(line), ""
}

// eachVTODOLine calls fn with the VTODO's own lines (not those of a VALARM inside it).
func eachVTODOLine(lines []string, fn func(i int, name, value string)) {
	depth := 0
	for i, l := range lines {
		name, value := icsProp(l)
		switch {
		case name == "BEGIN" && (depth > 0 || strings.EqualFold(value, "VTODO")):
			depth++
		case name == "END" && depth > 0:
			depth--
		case depth == 1:
			fn(i, name, value)
		}
	}
}

// taskFields is what a task and a VTODO share.
type taskFields struct {
	title, description, status, priority string
	due, dueTime                         sql.NullString // local date and HH:MM (NULL: all day)
	tags                                 []string
}

// icsParam returns a parameter of a content line ("DUE;TZID=Europe/Paris:…" → Europe/Paris).
func icsParam(line, key string) string {
	_, value := icsProp(line)
	head := line[:len(line)-len(value)]
	for _, p := range strings.Split(strings.TrimSuffix(head, ":"), ";")[1:] {
		if k, v, ok := strings.Cut(p, "="); ok && strings.EqualFold(k, key) {
			return strings.Trim(v, `"`)
		}
	}
	return ""
}

// icsDue reads a DUE line in the server's time zone: a date (all day), or a UTC, TZID or
// floating date-time.
func icsDue(line string) (day, at sql.NullString) {
	_, v := icsProp(line)
	if len(v) < 15 || v[8] != 'T' {
		if d, err := time.Parse("20060102", v[:min(len(v), 8)]); err == nil {
			day = sql.NullString{String: d.Format(time.DateOnly), Valid: true}
		}
		return
	}
	loc := localTZ()
	if strings.HasSuffix(v, "Z") {
		loc = time.UTC
	} else if tz := icsParam(line, "TZID"); tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l // an unknown zone (Windows name) is read as local time
		}
	}
	t, err := time.ParseInLocation("20060102T150405", v[:15], loc)
	if err != nil {
		return
	}
	t = t.In(localTZ())
	return sql.NullString{String: t.Format(time.DateOnly), Valid: true}, sql.NullString{String: t.Format("15:04"), Valid: true}
}

// icsDueLine writes the due date: a date-time in UTC when the task has a time.
func icsDueLine(t taskFields) string {
	if !t.dueTime.Valid {
		return "DUE;VALUE=DATE:" + strings.ReplaceAll(t.due.String, "-", "")
	}
	at, _ := time.ParseInLocation("2006-01-02 15:04", t.due.String+" "+t.dueTime.String, localTZ())
	return "DUE:" + at.UTC().Format("20060102T150405Z")
}

func parseVTODO(data string) (t taskFields, uid, modified string, completed bool) {
	t.status, t.priority = "todo", "medium"
	lines := icsLines(data)
	eachVTODOLine(lines, func(i int, name, value string) {
		switch name {
		case "UID":
			uid = value
		case "SUMMARY":
			t.title = icsUnescape.Replace(value)
		case "DESCRIPTION":
			t.description = icsUnescape.Replace(value)
		case "STATUS":
			switch strings.ToUpper(value) {
			case "COMPLETED", "CANCELLED":
				t.status = "done"
			case "IN-PROCESS":
				t.status = "in_progress"
			}
		case "COMPLETED":
			completed = true
		case "PRIORITY":
			t.priority = priorityFromICS(value)
		case "DUE":
			t.due, t.dueTime = icsDue(lines[i])
		case "CATEGORIES":
			for _, c := range strings.Split(value, ",") {
				if c = strings.TrimSpace(icsUnescape.Replace(c)); c != "" && !slices.Contains(t.tags, c) {
					t.tags = append(t.tags, c)
				}
			}
		case "LAST-MODIFIED":
			modified = value
		}
	})
	if completed {
		t.status = "done"
	}
	completed = t.status == "done"
	return
}

// Apple Reminders shows 1-4 as high, 5 as medium, 6-9 as low and 0 as none.
func priorityFromICS(v string) string {
	switch n, _ := strconv.Atoi(strings.TrimSpace(v)); {
	case n == 1:
		return "critical"
	case n >= 2 && n <= 4:
		return "high"
	case n >= 6 && n <= 9:
		return "low"
	}
	return "medium"
}

var priorityToICS = map[string]string{"critical": "1", "high": "3", "medium": "0", "low": "9"}

var vtodoManaged = []string{"SUMMARY", "DESCRIPTION", "STATUS", "PRIORITY", "COMPLETED", "PERCENT-COMPLETE", "CATEGORIES", "LAST-MODIFIED", "DTSTAMP"}

// buildVTODO writes t into base (a VTODO received earlier, or a new one when empty).
func buildVTODO(base, uid string, t taskFields, now time.Time) string {
	if base == "" {
		base = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Homelab Tools//FR\nBEGIN:VTODO\nUID:" + uid +
			"\nCREATED:" + now.Format("20060102T150405Z") + "\nEND:VTODO\nEND:VCALENDAR"
	}
	lines := icsLines(base)
	drop := map[int]bool{}
	end := -1
	keepDue := false
	eachVTODOLine(lines, func(i int, name, _ string) {
		switch {
		case slices.Contains(vtodoManaged, name):
			drop[i] = true
		case name == "DUE":
			// Same moment: the line stays as written (Apple Reminders' TZID).
			day, at := icsDue(lines[i])
			keepDue = t.due.Valid && day == t.due && at == t.dueTime
			drop[i] = !keepDue
		}
	})
	if !keepDue { // the start would otherwise risk falling after the new due date
		eachVTODOLine(lines, func(i int, name, _ string) { drop[i] = drop[i] || name == "DTSTART" })
	}
	// Alarms: when the due date changes, those set at a fixed moment are stale; the relative ones
	// follow the new date.
	depth, alarm, alarms, fixed := 0, -1, 0, false
	for i, l := range lines {
		name, value := icsProp(l)
		switch {
		case name == "BEGIN" && (depth > 0 || strings.EqualFold(value, "VTODO")):
			if depth++; depth == 2 && strings.EqualFold(value, "VALARM") {
				alarm, fixed = i, false
			}
		case name == "END" && depth > 0:
			if depth == 2 && alarm >= 0 {
				if fixed && !keepDue {
					for j := alarm; j <= i; j++ {
						drop[j] = true
					}
				} else {
					alarms++
				}
				alarm = -1
			}
			if depth--; depth == 0 {
				end = i
			}
		case depth == 2 && alarm >= 0 && name == "TRIGGER":
			fixed = strings.EqualFold(icsParam(l, "VALUE"), "DATE-TIME")
		}
	}
	stamp := now.UTC().Format("20060102T150405Z")
	props := []string{"SUMMARY:" + icsEscape.Replace(t.title), "DTSTAMP:" + stamp, "LAST-MODIFIED:" + stamp,
		"PRIORITY:" + priorityToICS[t.priority]}
	if t.description != "" {
		props = append(props, "DESCRIPTION:"+icsEscape.Replace(t.description))
	}
	switch t.status {
	case "done":
		props = append(props, "STATUS:COMPLETED", "COMPLETED:"+stamp, "PERCENT-COMPLETE:100")
	case "in_progress":
		props = append(props, "STATUS:IN-PROCESS")
	default:
		props = append(props, "STATUS:NEEDS-ACTION")
	}
	if t.due.Valid && !keepDue {
		props = append(props, icsDueLine(t))
		if t.dueTime.Valid && alarms == 0 { // a time set here notifies on the devices, like Rappels does
			props = append(props, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:"+icsEscape.Replace(t.title),
				"TRIGGER;RELATED=END:PT0S", "END:VALARM")
		}
	}
	if len(t.tags) > 0 {
		esc := make([]string, len(t.tags))
		for i, tag := range t.tags {
			esc[i] = icsEscape.Replace(tag)
		}
		props = append(props, "CATEGORIES:"+strings.Join(esc, ","))
	}
	var b strings.Builder
	for i, l := range lines {
		if i == end {
			for _, p := range props {
				writeFolded(&b, p)
			}
		}
		if !drop[i] {
			writeFolded(&b, l)
		}
	}
	return b.String()
}

// writeFolded writes a content line folded at 75 octets, never inside a UTF-8 character.
func writeFolded(b *strings.Builder, l string) {
	for len(l) > 75 {
		n := 75
		for n > 0 && l[n]&0xC0 == 0x80 {
			n--
		}
		b.WriteString(l[:n] + "\r\n ")
		l = l[n:]
	}
	b.WriteString(l + "\r\n")
}

/* ------------------------------------------------------------------- sync */

type syncedTask struct {
	f                taskFields
	rowID            int64
	href, etag, data string
	linked           string // caldav_href as read: a push only links the task if it is unchanged
	dirty            int64
	updated          string
}

// kickTaskSync wraps a task write: the change leaves for Nextcloud right away, not at the next poll.
func kickTaskSync(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h(w, r)
		select {
		case taskSyncKick <- struct{}{}:
		default: // a sync is already queued
		}
	}
}

// runTaskSync keeps the lists in step within seconds. Every 10 s it only asks each list for its
// change tag (one small PROPFIND, which Nextcloud bumps on every edit from Rappels); the full sync
// runs when a tag moved, after a write here, while local changes wait, and every 5 min regardless.
func (s *Server) runTaskSync(ctx context.Context) {
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	var tags string
	var last time.Time
	failed := false
	select { // first sync at start-up
	case taskSyncKick <- struct{}{}:
	default:
	}
	for {
		now := tags
		kicked := false
		select {
		case <-ctx.Done():
			return
		case <-taskSyncKick:
			kicked = true
			select { // a drag and drop or a burst of edits: one sync
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			select {
			case <-taskSyncKick:
			default:
			}
		case <-tick.C:
			now = s.taskListTags(ctx)
		}
		// Without tags (a server that gives none) and for changes left over, once a minute as before.
		minute := time.Since(last) >= time.Minute
		due := time.Since(last) >= 5*time.Minute || (!failed && (now != tags || (minute && (now == "" || s.tasksPending()))))
		if kicked {
			now = s.taskListTags(ctx) // taken before the sync: an edit made during it is seen next time
		}
		tags = now
		if !kicked && !due {
			continue
		}
		sctx, cancel := context.WithTimeout(ctx, 50*time.Second)
		_, err := s.syncTasks(sctx)
		cancel()
		if failed = err != nil; failed {
			slog.Warn("task sync", "err", err) // retried after a write here or within 5 min
		}
		last = time.Now()
	}
}

// taskListTags is the change tags of the enabled lists ("" when a server gives none or is down).
func (s *Server) taskListTags(ctx context.Context) string {
	lists, err := s.loadIntegrations(`WHERE type = 'nextcloud' AND enabled = 1`)
	if err != nil {
		return ""
	}
	var b strings.Builder
	for k := range lists {
		cctx, cancel := context.WithTimeout(ctx, 8*time.Second)
		tag, err := caldavCTag(cctx, &lists[k])
		cancel()
		if err != nil || tag == "" {
			return ""
		}
		fmt.Fprintf(&b, "%d=%s;", lists[k].ID, tag)
	}
	return b.String()
}

// tasksPending tells whether local changes still wait to be sent.
func (s *Server) tasksPending() bool {
	var n int
	s.db.QueryRow(`SELECT EXISTS (SELECT 1 FROM caldav_deleted) OR EXISTS (SELECT 1 FROM tasks
	  WHERE (caldav_dirty > 0 OR caldav_href = '') AND (caldav_list IS NULL OR caldav_list IN (SELECT id FROM integrations WHERE type = 'nextcloud' AND enabled = 1)))`).Scan(&n)
	return n == 1
}

func (s *Server) mgSyncTasks(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	logSkip(r) // each change is logged by the sync itself
	msg, err := s.syncTasks(ctx)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "message": err.Error()})
		return
	}
	if msg == "" {
		msg = "Aucune liste Nextcloud active : ajoute-la dans Paramètres → Intégrations."
	}
	writeJSON(w, 200, map[string]any{"ok": true, "message": msg})
}

// syncTasks runs one two-way sync of every enabled list; it returns "" when none is set up.
// Each task belongs to one list (caldav_list); a list's own errors do not stop the others.
func (s *Server) syncTasks(ctx context.Context) (string, error) {
	lists, err := s.loadIntegrations(`WHERE type = 'nextcloud' AND enabled = 1`)
	if err != nil || len(lists) == 0 {
		return "", err
	}
	taskSyncMu.Lock()
	defer taskSyncMu.Unlock()
	bases := make([]*url.URL, len(lists))
	for k := range lists {
		if bases[k], err = caldavBase(&lists[k]); err != nil {
			return "", err
		}
	}
	// Tasks without a list, or whose list was deleted: the list their link points to, else the first.
	orphan := `(caldav_list IS NULL OR caldav_list NOT IN (SELECT id FROM integrations WHERE type = 'nextcloud'))`
	for k, b := range bases {
		if _, err := s.db.Exec(`UPDATE tasks SET caldav_list = ? WHERE `+orphan+` AND caldav_href != '' AND instr(caldav_href, ?) = 1`, lists[k].ID, b.Path); err != nil {
			return "", err
		}
	}
	if _, err := s.db.Exec(`UPDATE tasks SET caldav_list = ? WHERE `+orphan, lists[0].ID); err != nil {
		return "", err
	}

	var msgs []string
	failed := false
	for k := range lists {
		msg, err := s.syncTaskList(ctx, &lists[k], bases[k])
		if err != nil {
			var ie *integrationError
			if !errors.As(err, &ie) {
				return "", err
			}
			msg, failed = fmt.Sprintf("« %s » : %s.", lists[k].Name, strings.TrimSuffix(ie.msg, ".")), true
		}
		msgs = append(msgs, msg)
	}
	// Deletions left for a list that is no longer synced have nowhere to go.
	gone, err := queryStrings(s.db, `SELECT href FROM caldav_deleted`)
	if err != nil {
		return "", err
	}
	for _, href := range gone {
		if !slices.ContainsFunc(bases, func(b *url.URL) bool { return strings.HasPrefix(href, b.Path) }) {
			s.db.Exec(`DELETE FROM caldav_deleted WHERE href = ?`, href)
		}
	}
	if failed {
		return "", integrationErr(strings.Join(msgs, " "))
	}
	return strings.Join(msgs, " "), nil
}

// syncTaskList syncs one Nextcloud list with the tasks that belong to it.
func (s *Server) syncTaskList(ctx context.Context, i *integration, base *url.URL) (string, error) {
	var pushed, pulled, imported, deleted int

	// Tasks deleted here (or moved to another list), then the server's state.
	gone, err := queryStrings(s.db, `SELECT href FROM caldav_deleted`)
	if err != nil {
		return "", err
	}
	for _, href := range gone {
		if !strings.HasPrefix(href, base.Path) {
			continue // another list's
		}
		code, _, _, err := caldavReq(ctx, i, "DELETE", href, nil, "")
		if err != nil {
			return "", err
		}
		if code >= 300 && code != 404 && code != 410 {
			continue // retried at the next sync
		}
		s.db.Exec(`DELETE FROM caldav_deleted WHERE href = ?`, href)
	}
	remote, err := caldavList(ctx, i)
	if err != nil {
		return "", err
	}

	tasks, err := s.syncedTasks(i.ID)
	if err != nil {
		return "", err
	}
	linked := 0
	for _, t := range tasks {
		if t.href != "" && strings.HasPrefix(t.href, base.Path) {
			linked++
		}
	}
	if len(remote) == 0 && linked > 1 {
		// An empty answer while tasks are linked looks like a server fault: nothing is deleted.
		return "", integrationErr("La liste Nextcloud est vide : synchronisation suspendue par précaution")
	}
	for _, t := range tasks {
		if t.href != "" && !strings.HasPrefix(t.href, base.Path) {
			// Linked to another list (its URL changed): sent to this one, removed from there.
			s.db.Exec(`INSERT OR IGNORE INTO caldav_deleted (href) VALUES (?)`, t.href)
			t.href, t.etag = "", ""
		}
		r, onServer := remote[t.href]
		delete(remote, t.href)
		switch {
		case t.href == "":
			// A task moved from another list keeps its VTODO (alarms, Apple's properties).
			if err := s.pushTask(ctx, i, base, t, t.data, ""); err != nil {
				return "", err
			}
			pushed++
		case !onServer && t.dirty > 0:
			t.href, t.etag = "", "" // deleted there but edited here: created again
			if err := s.pushTask(ctx, i, base, t, t.data, ""); err != nil {
				return "", err
			}
			pushed++
		case !onServer:
			s.db.Exec(`UPDATE tasks SET caldav_href = '' WHERE id = ? AND caldav_dirty = 0`, t.rowID)
			if res, _ := s.db.Exec(`DELETE FROM tasks WHERE id = ? AND caldav_dirty = 0`, t.rowID); affected(res) {
				s.logEvent("synchronisation", "task", t.rowID, "delete", "Tâche « "+t.f.title+" » supprimée dans Nextcloud")
				deleted++
			}
		case r.etag != t.etag && (t.dirty == 0 || remoteNewer(r.data, t.updated)):
			if s.pullTask(t, r) {
				pulled++
			}
		case r.etag != t.etag || t.dirty > 0:
			if err := s.pushTask(ctx, i, base, t, r.data, r.etag); err != nil {
				return "", err
			}
			pushed++
		}
	}
	pending, err := queryStrings(s.db, `SELECT href FROM caldav_deleted`)
	if err != nil {
		return "", err
	}
	for href, r := range remote {
		f, _, _, completed := parseVTODO(r.data)
		if completed || strings.TrimSpace(f.title) == "" || slices.Contains(pending, href) {
			continue // the history of finished reminders stays in Nextcloud; a deletion is retried
		}
		tags, _ := json.Marshal(nonNil(f.tags))
		res, err := s.db.Exec(`INSERT INTO tasks (title, description, status, priority, due_date, due_time, tags, position, caldav_list, caldav_href, caldav_etag, caldav_data, caldav_dirty)
		  VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MIN(position), 0) - 1 FROM tasks WHERE status = ?), ?, ?, ?, ?, 0)`,
			clip(f.title, 200), clip(f.description, 5000), f.status, f.priority, f.due, f.dueTime, string(tags), f.status, i.ID, href, r.etag, r.data)
		if err != nil {
			return "", err
		}
		id, _ := res.LastInsertId()
		s.logEvent("synchronisation", "task", id, "create", "Tâche « "+f.title+" » importée de Nextcloud")
		imported++
	}
	return fmt.Sprintf("Synchronisation avec « %s » : %d envoyée(s), %d mise(s) à jour, %d importée(s), %d supprimée(s).",
		i.Name, pushed, pulled, imported, deleted), nil
}

func queryStrings(q execer, query string) ([]string, error) {
	rows, err := q.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var v string
		rows.Scan(&v)
		out = append(out, v)
	}
	return out, rows.Err()
}

func affected(res sql.Result) bool {
	if res == nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

func (s *Server) syncedTasks(list int64) ([]syncedTask, error) {
	rows, err := s.db.Query(`SELECT id, title, description, status, priority, due_date, due_time, tags, caldav_href, caldav_etag, caldav_data, caldav_dirty, updated_at
	  FROM tasks WHERE caldav_list = ?`, list)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []syncedTask
	for rows.Next() {
		var t syncedTask
		var tags string
		if err := rows.Scan(&t.rowID, &t.f.title, &t.f.description, &t.f.status, &t.f.priority, &t.f.due, &t.f.dueTime, &tags,
			&t.href, &t.etag, &t.data, &t.dirty, &t.updated); err != nil {
			return nil, err
		}
		t.linked = t.href
		json.Unmarshal([]byte(tags), &t.f.tags)
		out = append(out, t)
	}
	return out, rows.Err()
}

// remoteNewer tells whether the server's copy was modified after the local task (both UTC).
func remoteNewer(data, updated string) bool {
	_, _, mod, _ := parseVTODO(data)
	rt, err := time.Parse("20060102T150405Z", mod)
	if err != nil {
		return false
	}
	lt, err := time.Parse(time.DateTime, updated)
	return err != nil || rt.After(lt)
}

// pushTask sends t (built on base) to the server; a conflict (412) waits for the next sync.
func (s *Server) pushTask(ctx context.Context, i *integration, list *url.URL, t syncedTask, base, etag string) error {
	_, uid, _, _ := parseVTODO(base)
	href := t.href
	hdr := map[string]string{"Content-Type": "text/calendar; charset=utf-8"}
	if href == "" {
		if uid == "" {
			b := make([]byte, 16)
			rand.Read(b)
			uid = hex.EncodeToString(b)
		}
		href = list.Path + uid + ".ics"
		hdr["If-None-Match"] = "*"
	} else if etag != "" {
		hdr["If-Match"] = etag
	} else if t.etag != "" {
		hdr["If-Match"] = t.etag
	}
	data := buildVTODO(base, uid, t.f, time.Now())
	code, h, _, err := caldavReq(ctx, i, "PUT", href, hdr, data)
	if err != nil {
		return err
	}
	if code == 412 {
		return nil
	}
	if code >= 300 {
		return integrationErr(fmt.Sprintf("Nextcloud a refusé la tâche « %s » (HTTP %d)", t.f.title, code))
	}
	// Without an ETag the next sync takes the server's copy back, which is this same content.
	res, err := s.db.Exec(`UPDATE tasks SET caldav_href = ?, caldav_etag = ?, caldav_data = ?,
	  caldav_dirty = CASE WHEN caldav_dirty = ? THEN 0 ELSE caldav_dirty END
	  WHERE id = ? AND caldav_list = ? AND caldav_href = ?`, href, h.Get("ETag"), data, t.dirty, t.rowID, i.ID, t.linked)
	if err == nil && !affected(res) && href != t.linked {
		// Moved to another list or deleted meanwhile: the copy just created is not imported back.
		_, err = s.db.Exec(`INSERT OR IGNORE INTO caldav_deleted (href) VALUES (?)`, href)
	}
	return err
}

// pullTask applies the server's copy, unless the task was edited here meanwhile.
func (s *Server) pullTask(t syncedTask, r remoteTodo) bool {
	f, _, _, _ := parseVTODO(r.data)
	if strings.TrimSpace(f.title) == "" {
		f.title = t.f.title
	}
	tags, _ := json.Marshal(nonNil(f.tags))
	res, _ := s.db.Exec(`UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, due_time = ?, tags = ?,
	    completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END,
	    caldav_etag = ?, caldav_data = ?, caldav_dirty = 0, updated_at = datetime('now')
	  WHERE id = ? AND caldav_dirty = ?`,
		clip(f.title, 200), clip(f.description, 5000), f.status, f.priority, f.due, f.dueTime, string(tags), f.status, r.etag, r.data, t.rowID, t.dirty)
	if !affected(res) {
		return false
	}
	if f.title != t.f.title || f.description != t.f.description || f.status != t.f.status || f.priority != t.f.priority ||
		f.due != t.f.due || f.dueTime != t.f.dueTime || !slices.Equal(f.tags, t.f.tags) {
		s.logEvent("synchronisation", "task", t.rowID, "update", "Tâche « "+f.title+" » modifiée dans Nextcloud")
	}
	return true
}
