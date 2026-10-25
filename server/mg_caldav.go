package main

// Two-way sync of the tasks with a Nextcloud task list (CalDAV VTODO). Apple Reminders syncs with
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

var taskSyncMu sync.Mutex

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
	due                                  sql.NullString
	tags                                 []string
}

func parseVTODO(data string) (t taskFields, uid, modified string, completed bool) {
	t.status, t.priority = "todo", "medium"
	eachVTODOLine(icsLines(data), func(_ int, name, value string) {
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
			if len(value) >= 8 {
				if d, err := time.Parse("20060102", value[:8]); err == nil {
					t.due = sql.NullString{String: d.Format("2006-01-02"), Valid: true}
				}
			}
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
	eachVTODOLine(lines, func(i int, name, value string) {
		switch {
		case slices.Contains(vtodoManaged, name):
			drop[i] = true
		case name == "DUE":
			// Same day: the line stays, with the time Apple Reminders may have set.
			keepDue = t.due.Valid && len(value) >= 8 && value[:8] == strings.ReplaceAll(t.due.String, "-", "")
			drop[i] = !keepDue
		}
	})
	if !keepDue { // the start would otherwise risk falling after the new due date
		eachVTODOLine(lines, func(i int, name, _ string) { drop[i] = drop[i] || name == "DTSTART" })
	}
	depth := 0
	for i, l := range lines {
		name, value := icsProp(l)
		if name == "BEGIN" && (depth > 0 || strings.EqualFold(value, "VTODO")) {
			depth++
		} else if name == "END" && depth > 0 {
			if depth--; depth == 0 {
				end = i
			}
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
		props = append(props, "DUE;VALUE=DATE:"+strings.ReplaceAll(t.due.String, "-", ""))
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
	dirty            int64
	updated          string
}

func (s *Server) runTaskSync(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		sctx, cancel := context.WithTimeout(ctx, 50*time.Second)
		if _, err := s.syncTasks(sctx); err != nil {
			slog.Warn("task sync", "err", err)
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
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

// syncTasks runs one two-way sync; it returns "" when no Nextcloud list is set up.
func (s *Server) syncTasks(ctx context.Context) (string, error) {
	list, err := s.loadIntegrations(`WHERE type = 'nextcloud' AND enabled = 1`)
	if err != nil || len(list) == 0 {
		return "", err
	}
	i := &list[0] // shortcut: one task list is synced, the first enabled; several lists would need a list per task.
	base, err := caldavBase(i)
	if err != nil {
		return "", err
	}
	taskSyncMu.Lock()
	defer taskSyncMu.Unlock()
	var pushed, pulled, imported, deleted int

	// Tasks deleted here, then the server's state.
	gone, err := queryStrings(s.db, `SELECT href FROM caldav_deleted`)
	if err != nil {
		return "", err
	}
	for _, href := range gone {
		if strings.HasPrefix(href, base.Path) {
			code, _, _, err := caldavReq(ctx, i, "DELETE", href, nil, "")
			if err != nil {
				return "", err
			}
			if code >= 300 && code != 404 && code != 410 {
				continue // retried at the next sync
			}
		}
		s.db.Exec(`DELETE FROM caldav_deleted WHERE href = ?`, href)
	}
	remote, err := caldavList(ctx, i)
	if err != nil {
		return "", err
	}

	tasks, err := s.syncedTasks()
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
			t.href, t.etag, t.data = "", "", "" // linked to another list: sent again to this one
		}
		r, onServer := remote[t.href]
		delete(remote, t.href)
		switch {
		case t.href == "":
			if err := s.pushTask(ctx, i, base, t, "", ""); err != nil {
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
	for href, r := range remote {
		f, _, _, completed := parseVTODO(r.data)
		if completed || strings.TrimSpace(f.title) == "" {
			continue // the history of finished reminders stays in Nextcloud
		}
		tags, _ := json.Marshal(nonNil(f.tags))
		res, err := s.db.Exec(`INSERT INTO tasks (title, description, status, priority, due_date, tags, position, caldav_href, caldav_etag, caldav_data, caldav_dirty)
		  VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MIN(position), 0) - 1 FROM tasks WHERE status = ?), ?, ?, ?, 0)`,
			clip(f.title, 200), clip(f.description, 5000), f.status, f.priority, f.due, string(tags), f.status, href, r.etag, r.data)
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

func (s *Server) syncedTasks() ([]syncedTask, error) {
	rows, err := s.db.Query(`SELECT id, title, description, status, priority, due_date, tags, caldav_href, caldav_etag, caldav_data, caldav_dirty, updated_at FROM tasks`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []syncedTask
	for rows.Next() {
		var t syncedTask
		var tags string
		if err := rows.Scan(&t.rowID, &t.f.title, &t.f.description, &t.f.status, &t.f.priority, &t.f.due, &tags,
			&t.href, &t.etag, &t.data, &t.dirty, &t.updated); err != nil {
			return nil, err
		}
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
	_, err = s.db.Exec(`UPDATE tasks SET caldav_href = ?, caldav_etag = ?, caldav_data = ?,
	  caldav_dirty = CASE WHEN caldav_dirty = ? THEN 0 ELSE caldav_dirty END WHERE id = ?`, href, h.Get("ETag"), data, t.dirty, t.rowID)
	return err
}

// pullTask applies the server's copy, unless the task was edited here meanwhile.
func (s *Server) pullTask(t syncedTask, r remoteTodo) bool {
	f, _, _, _ := parseVTODO(r.data)
	if strings.TrimSpace(f.title) == "" {
		f.title = t.f.title
	}
	tags, _ := json.Marshal(nonNil(f.tags))
	res, _ := s.db.Exec(`UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, tags = ?,
	    completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END,
	    caldav_etag = ?, caldav_data = ?, caldav_dirty = 0, updated_at = datetime('now')
	  WHERE id = ? AND caldav_dirty = ?`,
		clip(f.title, 200), clip(f.description, 5000), f.status, f.priority, f.due, string(tags), f.status, r.etag, r.data, t.rowID, t.dirty)
	if !affected(res) {
		return false
	}
	if f.title != t.f.title || f.description != t.f.description || f.status != t.f.status || f.priority != t.f.priority ||
		f.due != t.f.due || !slices.Equal(f.tags, t.f.tags) {
		s.logEvent("synchronisation", "task", t.rowID, "update", "Tâche « "+f.title+" » modifiée dans Nextcloud")
	}
	return true
}
