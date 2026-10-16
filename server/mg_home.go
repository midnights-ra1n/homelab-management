package main

// Start page (shortcuts, groups, icons) and map (positions, links).

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

func (s *Server) mgShortcuts(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{}
	for k, q := range map[string]string{
		"groups":    `SELECT id, name, position FROM shortcut_groups ORDER BY position, id`,
		"shortcuts": `SELECT s.*, a.display_name AS asset_name FROM shortcuts s LEFT JOIN assets a ON a.id = s.asset_id ORDER BY s.position, s.name COLLATE NOCASE`,
		"icons":     `SELECT * FROM uploaded_icons ORDER BY id DESC`,
	} {
		rows, err := s.rows(q)
		if err != nil {
			serverErr(w, err)
			return
		}
		out[k] = rows
	}
	writeJSON(w, 200, out)
}

func (s *Server) mgSaveShortcut(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	u := strings.TrimSpace(f.raw("url"))
	if u == "" {
		f.fail("url", "L'URL est requise")
	} else if !httpURLRe.MatchString(u) {
		f.fail("url", "URL http(s) invalide")
	}
	b2i := func(b bool) int {
		if b {
			return 1
		}
		return 0
	}
	cols := map[string]any{
		"name": f.required("name", "Le nom", 80), "url": u, "description": f.text("description", 200),
		"group_id": f.optID("group_id"), "icon_type": f.enum("icon_type", "none", "dashboard", "selfhst", "upload", "url"),
		"icon_value": f.text("icon_value", 500), "asset_id": f.optID("asset_id"),
		"new_tab": b2i(f.check("new_tab")), "status_check": b2i(f.check("status_check")),
	}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	var err error
	if id > 0 {
		err = s.updateRow(s.db, "shortcuts", id, cols)
		logSkip(r)
	} else {
		var pos int64
		s.db.QueryRow(`SELECT COALESCE(MAX(position), -1) + 1 FROM shortcuts`).Scan(&pos)
		cols["position"] = pos
		if id, err = s.insertRow(s.db, "shortcuts", cols); err == nil {
			s.mgLog(r, "shortcut", id, "create", fmt.Sprintf("Raccourci « %s » ajouté", cols["name"]))
		}
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if r.PathValue("id") != "" {
		formOK(w, "Raccourci mis à jour.")
	} else {
		formOK(w, "Raccourci ajouté.")
	}
}

func (s *Server) mgReorderShortcuts(w http.ResponseWriter, r *http.Request) {
	var in struct {
		GroupID *int64  `json:"group_id"`
		IDs     []int64 `json:"ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	logSkip(r)
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	for i, id := range in.IDs {
		tx.Exec(`UPDATE shortcuts SET position = ?, group_id = ? WHERE id = ?`, i, in.GroupID, id)
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) mgSaveGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	name := f.required("name", "Le nom", 60)
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	logSkip(r)
	var err error
	if id > 0 {
		_, err = s.db.Exec(`UPDATE shortcut_groups SET name = ? WHERE id = ?`, name, id)
	} else {
		_, err = s.db.Exec(`INSERT INTO shortcut_groups (name, position) VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM shortcut_groups))`, name)
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if id > 0 {
		formOK(w, "Groupe renommé.")
	} else {
		formOK(w, "Groupe créé.")
	}
}

/* ---------------------------------------------------------------- probes */

type probeResult struct {
	Up     bool `json:"up"`
	Status int  `json:"status,omitempty"`
	MS     int  `json:"ms"`
}

// insecureClient accepts self-signed certificates (homelab services, Proxmox by default).
var insecureClient = &http.Client{
	Transport:     &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, Proxy: http.ProxyFromEnvironment},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// probeURL: any HTTP answer below 500 means the service is reachable (401/403 included).
func probeURL(ctx context.Context, u string, timeout time.Duration) probeResult {
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	do := func(method string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, method, u, nil)
		if err != nil {
			return nil, err
		}
		return insecureClient.Do(req)
	}
	resp, err := do("HEAD")
	if err == nil && (resp.StatusCode == 405 || resp.StatusCode == 501) {
		resp.Body.Close()
		resp, err = do("GET")
	}
	ms := int(time.Since(start).Milliseconds())
	if err != nil {
		return probeResult{MS: ms}
	}
	resp.Body.Close()
	return probeResult{Up: resp.StatusCode < 500, Status: resp.StatusCode, MS: ms}
}

func (s *Server) mgProbeShortcuts(w http.ResponseWriter, r *http.Request) {
	var in struct {
		URLs []string `json:"urls"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	logSkip(r)
	var urls []string
	for _, u := range in.URLs {
		if httpURLRe.MatchString(u) && !slices.Contains(urls, u) && len(urls) < 100 {
			urls = append(urls, u)
		}
	}
	out := map[string]probeResult{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 16)
	for _, u := range urls {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			res := probeURL(r.Context(), u, 4*time.Second)
			<-sem
			mu.Lock()
			out[u] = res
			mu.Unlock()
		}()
	}
	wg.Wait()
	writeJSON(w, 200, out)
}

/* ---------------------------------------------------------------- icons */

type iconEntry struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
	Label    string `json:"label"`
}

// iconIndex lists Dashboard Icons and selfh.st icons, cached for 24 hours.
func (s *Server) iconIndex(ctx context.Context) []iconEntry {
	s.mg.iconsMu.Lock()
	defer s.mg.iconsMu.Unlock()
	if len(s.mg.icons) > 0 && time.Since(s.mg.iconsAt) < 24*time.Hour {
		return s.mg.icons
	}
	get := func(u string, v any) error {
		ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		return json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(v)
	}
	var entries []iconEntry
	var dash struct {
		SVG []string `json:"svg"`
	}
	if get("https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/tree.json", &dash) == nil {
		for _, f := range dash.SVG {
			n := strings.TrimSuffix(f, ".svg")
			entries = append(entries, iconEntry{"dashboard", n, strings.ReplaceAll(n, "-", " ")})
		}
	}
	var selfhst []struct{ Name, Reference, SVG string }
	if get("https://cdn.jsdelivr.net/gh/selfhst/icons/index.json", &selfhst) == nil {
		for _, i := range selfhst {
			if i.SVG == "Yes" {
				entries = append(entries, iconEntry{"selfhst", i.Reference, i.Name})
			}
		}
	}
	if len(entries) > 0 {
		s.mg.icons, s.mg.iconsAt = entries, time.Now()
	}
	return entries
}

func (s *Server) mgSearchIcons(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	provider := r.URL.Query().Get("provider")
	type scored struct {
		e     iconEntry
		score int
	}
	var list []scored
	for _, e := range s.iconIndex(r.Context()) {
		if provider != "" && e.Provider != provider {
			continue
		}
		n, l := strings.ToLower(e.Name), strings.ToLower(e.Label)
		score := -1
		switch {
		case q == "" || n == q:
			score = 0
		case strings.HasPrefix(n, q):
			score = 1
		case strings.HasPrefix(l, q):
			score = 2
		case strings.Contains(n, q) || strings.Contains(l, q):
			score = 3
		}
		if score >= 0 {
			list = append(list, scored{e, score})
		}
	}
	if q != "" {
		sort.SliceStable(list, func(i, j int) bool {
			if list[i].score != list[j].score {
				return list[i].score < list[j].score
			}
			return len(list[i].e.Name) < len(list[j].e.Name)
		})
	}
	out := []iconEntry{}
	for i := 0; i < len(list) && i < 60; i++ {
		out = append(out, list[i].e)
	}
	writeJSON(w, 200, out)
}

var iconTypes = map[string]string{
	"image/png": "png", "image/svg+xml": "svg", "image/webp": "webp", "image/jpeg": "jpg",
	"image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/gif": "gif",
}

var svgScriptRe = regexp.MustCompile(`(?i)<script|on\w+\s*=|javascript:`)

func (s *Server) mgUploadIcon(w http.ResponseWriter, r *http.Request) {
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil || hdr.Size == 0 {
		formFail(w, "file", "Choisis un fichier")
		return
	}
	defer file.Close()
	mime := hdr.Header.Get("Content-Type")
	ext, ok := iconTypes[mime]
	if !ok {
		formFail(w, "file", "Format non pris en charge (PNG, SVG, WebP, JPG, ICO, GIF)")
		return
	}
	if hdr.Size > 1<<20 {
		formFail(w, "file", "1 Mo maximum")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, 1<<20+1))
	if err != nil || len(data) > 1<<20 {
		formFail(w, "file", "1 Mo maximum")
		return
	}
	if ext == "svg" && svgScriptRe.Match(data) {
		formFail(w, "file", "SVG refusé : contient du script")
		return
	}
	b := make([]byte, 8)
	rand.Read(b)
	name := hex.EncodeToString(b) + "." + ext
	if err := os.WriteFile(filepath.Join(s.mg.uploads, name), data, 0o600); err != nil {
		serverErr(w, err)
		return
	}
	label := clip(strings.TrimSpace(f.raw("label")), 80)
	if label == "" {
		label = clip(strings.TrimSuffix(hdr.Filename, filepath.Ext(hdr.Filename)), 80)
	}
	res, err := s.db.Exec(`INSERT INTO uploaded_icons (filename, label, mime, size) VALUES (?, ?, ?, ?)`, name, label, mime, len(data))
	if err != nil {
		serverErr(w, err)
		return
	}
	id, _ := res.LastInsertId()
	icon, _ := s.row(`SELECT * FROM uploaded_icons WHERE id = ?`, id)
	logName(r, label)
	writeJSON(w, 200, map[string]any{"ok": true, "message": "Icône téléversée.", "nonce": time.Now().UnixMilli(), "icon": icon})
}

func (s *Server) mgDeleteIcon(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var name, label string
	if err := s.db.QueryRow(`SELECT filename, label FROM uploaded_icons WHERE id = ?`, id).Scan(&name, &label); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.db.Exec(`DELETE FROM uploaded_icons WHERE id = ?`, id)
	s.db.Exec(`UPDATE shortcuts SET icon_type = 'none', icon_value = '' WHERE icon_type = 'upload' AND icon_value = ?`, name)
	os.Remove(filepath.Join(s.mg.uploads, filepath.Base(name)))
	logName(r, label)
	w.WriteHeader(http.StatusNoContent)
}

// mgServeUpload serves an uploaded icon with its stored image type, never anything else.
func (s *Server) mgServeUpload(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.PathValue("file"))
	var mime string
	if err := s.db.QueryRow(`SELECT mime FROM uploaded_icons WHERE filename = ?`, name).Scan(&mime); err != nil {
		writeErr(w, 404, "Introuvable")
		return
	}
	data, err := os.ReadFile(filepath.Join(s.mg.uploads, name))
	if err != nil {
		writeErr(w, 404, "Introuvable")
		return
	}
	if _, ok := iconTypes[mime]; !ok {
		mime = "application/octet-stream"
	}
	h := w.Header()
	h.Set("Content-Type", mime)
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	w.Write(data)
}

/* ------------------------------------------------------------------ map */

func (s *Server) mgMap(w http.ResponseWriter, r *http.Request) {
	pos, err := s.rows(`SELECT asset_id, x, y FROM map_positions`)
	if err != nil {
		serverErr(w, err)
		return
	}
	links, err := s.rows(`SELECT id, source_id, target_id, kind, label FROM map_links`)
	if err != nil {
		serverErr(w, err)
		return
	}
	positions := map[string]any{}
	for _, p := range pos {
		positions[fmt.Sprint(p["asset_id"])] = map[string]any{"x": p["x"], "y": p["y"]}
	}
	writeJSON(w, 200, map[string]any{"positions": positions, "links": links})
}

func (s *Server) mgSavePositions(w http.ResponseWriter, r *http.Request) {
	var in []struct {
		ID int64   `json:"id"`
		X  float64 `json:"x"`
		Y  float64 `json:"y"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	logSkip(r)
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	for _, p := range in {
		if p.ID <= 0 || math.IsNaN(p.X) || math.IsInf(p.X, 0) || math.IsNaN(p.Y) || math.IsInf(p.Y, 0) {
			continue
		}
		tx.Exec(`INSERT INTO map_positions (asset_id, x, y) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM assets WHERE id = ?)
		   ON CONFLICT(asset_id) DO UPDATE SET x = excluded.x, y = excluded.y`, p.ID, math.Round(p.X), math.Round(p.Y), p.ID)
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) mgResetPositions(w http.ResponseWriter, r *http.Request) {
	logSkip(r)
	s.db.Exec(`DELETE FROM map_positions`)
	w.WriteHeader(http.StatusNoContent)
}

var linkKinds = []string{"ethernet", "fiber", "wifi", "vpn", "logical"}

func (s *Server) mgCreateLink(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Source int64  `json:"source"`
		Target int64  `json:"target"`
		Kind   string `json:"kind"`
		Label  string `json:"label"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	logSkip(r)
	if !slices.Contains(linkKinds, in.Kind) || in.Source == in.Target {
		writeErr(w, 400, "Lien invalide")
		return
	}
	if _, err := s.db.Exec(`INSERT INTO map_links (source_id, target_id, kind, label) VALUES (?, ?, ?, ?)
	   ON CONFLICT(source_id, target_id) DO UPDATE SET kind = excluded.kind, label = excluded.label`,
		in.Source, in.Target, in.Kind, clip(in.Label, 60)); err != nil {
		writeErr(w, 400, "Lien invalide")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) mgDeleteLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	logSkip(r)
	s.db.Exec(`DELETE FROM map_links WHERE id = ?`, id)
	w.WriteHeader(http.StatusNoContent)
}
