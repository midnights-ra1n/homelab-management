package main

// Form handling for the management API. The web UI posts FormData (as the Next.js server
// actions did) and gets back the same FormState: {ok, message, errors, nonce, redirect, id}.
// Each field helper mirrors a zod helper of homelab-management's lib/validation.ts.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type form struct {
	r    *http.Request
	errs map[string]string
}

func parseForm(w http.ResponseWriter, r *http.Request) (*form, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	ct := r.Header.Get("Content-Type")
	var err error
	if strings.HasPrefix(ct, "multipart/form-data") {
		err = r.ParseMultipartForm(4 << 20)
	} else {
		err = r.ParseForm()
	}
	if err != nil {
		writeErr(w, 400, "Formulaire illisible")
		return nil, false
	}
	return &form{r: r, errs: map[string]string{}}, true
}

func (f *form) raw(k string) string { return f.r.PostFormValue(k) }

func (f *form) fail(k, msg string) {
	if _, ok := f.errs[k]; !ok {
		f.errs[k] = msg
	}
}

func (f *form) valid() bool { return len(f.errs) == 0 }

func (f *form) text(k string, max int) string {
	v := strings.TrimSpace(f.raw(k))
	if utf8.RuneCountInString(v) > max {
		f.fail(k, fmt.Sprintf("%d caractères maximum", max))
	}
	return v
}

func (f *form) required(k, label string, max int) string {
	v := f.text(k, max)
	if v == "" {
		f.fail(k, label+" est requis")
	}
	return v
}

// optNum returns nil for an empty field; "," is accepted as the decimal separator.
func (f *form) optNum(k string, integer bool, min, max float64) any {
	v := strings.TrimSpace(f.raw(k))
	if v == "" {
		return nil
	}
	n, err := strconv.ParseFloat(strings.Replace(v, ",", ".", 1), 64)
	switch {
	case err != nil || math.IsNaN(n) || math.IsInf(n, 0):
		f.fail(k, "Nombre invalide")
	case integer && n != math.Trunc(n):
		f.fail(k, "Nombre entier attendu")
	case n < min:
		f.fail(k, "Minimum "+strconv.FormatFloat(min, 'f', -1, 64))
	case n > max:
		f.fail(k, "Maximum "+strconv.FormatFloat(max, 'f', -1, 64))
	default:
		if integer {
			return int64(n)
		}
		return n
	}
	return nil
}

func (f *form) optID(k string) any {
	v := strings.TrimSpace(f.raw(k))
	if v == "" {
		return nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		f.fail(k, "Identifiant invalide")
		return nil
	}
	return n
}

func (f *form) optDate(k string) any {
	v := strings.TrimSpace(f.raw(k))
	if v == "" {
		return nil
	}
	if _, err := time.Parse("2006-01-02", v); err != nil {
		f.fail(k, "Date invalide")
		return nil
	}
	return v
}

func (f *form) check(k string) bool {
	v := f.raw(k)
	return v == "on" || v == "true" || v == "1"
}

func (f *form) optIP(k string) string {
	v := strings.TrimSpace(f.raw(k))
	if v != "" && !isIPv4(v) {
		f.fail(k, "Adresse IPv4 invalide")
	}
	return v
}

var macRe = regexp.MustCompile(`^([0-9a-f]{2}:){5}[0-9a-f]{2}$`)

func (f *form) mac(k string) string {
	v := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(f.raw(k))), "-", ":")
	if v != "" && !macRe.MatchString(v) {
		f.fail(k, "Adresse MAC invalide")
	}
	return v
}

var httpURLRe = regexp.MustCompile(`(?i)^https?://\S+$`)

func (f *form) url(k string) string {
	v := strings.TrimSpace(f.raw(k))
	if v != "" && !httpURLRe.MatchString(v) {
		f.fail(k, "URL http(s) invalide")
	}
	return v
}

// tags parses "web, prod , dns" into a JSON array (lower case, no duplicates).
func (f *form) tags(k string) string {
	out := []string{}
	for _, t := range strings.Split(f.raw(k), ",") {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || slices.Contains(out, t) {
			continue
		}
		if utf8.RuneCountInString(t) > 40 {
			f.fail(k, "40 caractères maximum par tag")
		}
		out = append(out, t)
	}
	if len(out) > 30 {
		f.fail(k, "30 tags maximum")
	}
	b, _ := json.Marshal(out)
	return string(b)
}

func (f *form) enum(k string, allowed ...string) string {
	v := f.raw(k)
	if !slices.Contains(allowed, v) {
		if v == "" && len(allowed) > 0 {
			f.fail(k, "Valeur requise")
		} else {
			f.fail(k, "Valeur invalide")
		}
	}
	return v
}

// jsonArray decodes a JSON list field into dst (64 items max); invalid JSON gives an empty list.
func (f *form) jsonArray(k string, dst any) {
	v := f.raw(k)
	if v == "" || json.Unmarshal([]byte(v), dst) != nil {
		json.Unmarshal([]byte("[]"), dst)
	}
}

/* ---------------------------------------------------------------- responses */

type formState struct {
	OK       bool              `json:"ok,omitempty"`
	Message  string            `json:"message,omitempty"`
	Errors   map[string]string `json:"errors,omitempty"`
	Nonce    int64             `json:"nonce,omitempty"`
	Redirect string            `json:"redirect,omitempty"`
	ID       int64             `json:"id,omitempty"`
}

func formInvalid(w http.ResponseWriter, f *form) {
	writeJSON(w, 200, formState{Errors: f.errs, Message: "Certains champs sont invalides."})
}

func formFail(w http.ResponseWriter, field, msg string) {
	st := formState{Message: msg}
	if field != "" {
		st.Errors = map[string]string{field: msg}
	}
	writeJSON(w, 200, st)
}

func formOK(w http.ResponseWriter, msg string) {
	writeJSON(w, 200, formState{OK: true, Message: msg, Nonce: time.Now().UnixMilli()})
}

func formRedirect(w http.ResponseWriter, to string, id int64) {
	writeJSON(w, 200, formState{OK: true, Redirect: to, ID: id, Nonce: time.Now().UnixMilli()})
}

// formDBError turns a UNIQUE violation into a field error, anything else into a 500.
func formDBError(w http.ResponseWriter, err error, field, msg string) {
	if strings.Contains(err.Error(), "UNIQUE") && field != "" {
		writeJSON(w, 200, formState{Errors: map[string]string{field: msg}, Message: "Doublon détecté."})
		return
	}
	serverErr(w, err)
}

/* ---------------------------------------------------------------- queries */

// jsonColumns are TEXT columns holding JSON, decoded when rows are sent to the browser.
var jsonColumns = map[string]bool{"tags": true, "disks": true, "nics": true, "routes_a": true, "routes_b": true}

// rows runs a query and returns JSON-ready maps (the TypeScript types live in the web UI).
func (s *Server) rows(q string, args ...any) ([]map[string]any, error) {
	return s.scanRows(true, q, args...)
}

// scanRows decodes the JSON columns when decode is set (backups keep them as stored text).
func (s *Server) scanRows(decode bool, q string, args ...any) ([]map[string]any, error) {
	rs, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	cols, _ := rs.Columns()
	out := []map[string]any{}
	for rs.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rs.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := make(map[string]any, len(cols))
		for i, c := range cols {
			v := vals[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			if str, ok := v.(string); ok && decode && jsonColumns[c] {
				var dec any
				if json.Unmarshal([]byte(str), &dec) == nil {
					v = dec
				} else {
					v = []any{}
				}
			}
			m[c] = v
		}
		out = append(out, m)
	}
	return out, rs.Err()
}

func (s *Server) row(q string, args ...any) (map[string]any, error) {
	r, err := s.rows(q, args...)
	if err != nil {
		return nil, err
	}
	if len(r) == 0 {
		return nil, sql.ErrNoRows
	}
	return r[0], nil
}

// insertRow / updateRow build the statement from validated column values (keys are code constants).
func (s *Server) insertRow(q execer, table string, cols map[string]any) (int64, error) {
	keys := sortedKeys(cols)
	args := make([]any, len(keys))
	for i, k := range keys {
		args[i] = cols[k]
	}
	res, err := q.Exec(fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, table, strings.Join(keys, ","),
		strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")), args...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Server) updateRow(q execer, table string, id int64, cols map[string]any) error {
	keys := sortedKeys(cols)
	sets := make([]string, len(keys))
	args := make([]any, 0, len(keys)+1)
	for i, k := range keys {
		sets[i] = k + " = ?"
		args = append(args, cols[k])
	}
	_, err := q.Exec(fmt.Sprintf(`UPDATE %s SET %s, updated_at = datetime('now') WHERE id = ?`, table, strings.Join(sets, ", ")), append(args, id)...)
	return err
}

// execer is *sql.DB or *sql.Tx. Inside a transaction always use the Tx: the pool has one
// connection, so a call on s.db would wait for the transaction forever.
type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

// mgLog records a journal entry from a management handler (summaries as homelab-management wrote them).
func (s *Server) mgLog(r *http.Request, entity string, id int64, action, summary string) {
	logSkip(r) // the explicit summary replaces the generic route label
	actor := ""
	if li := logInfoFrom(r); li != nil {
		actor = li.actor
	}
	if actor == "" { // GET routes (exports) are not wrapped by the journal middleware
		_, actor, _ = s.currentUser(r)
	}
	s.logEvent(actor, entity, id, action, summary)
}

func intParam(r *http.Request, k string) int64 {
	n, _ := strconv.ParseInt(r.URL.Query().Get(k), 10, 64)
	return n
}

func writeRows(w http.ResponseWriter, rows []map[string]any, err error) {
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, rows)
}

func logErr(what string, err error) {
	if err != nil {
		slog.Error(what, "err", err)
	}
}
