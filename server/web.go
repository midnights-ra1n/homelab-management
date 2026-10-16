package main

import (
	"embed"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// The React app is built into web/dist (see ../web) and shipped inside the binary.
//
//go:embed all:web/dist
var webFS embed.FS

// Go's table lacks the PWA manifest type; browsers expect it to install the app.
func init() { _ = mime.AddExtensionType(".webmanifest", "application/manifest+json") }

func (s *Server) staticHandler() http.Handler {
	dist, _ := fs.Sub(webFS, "web/dist")
	files := http.FileServerFS(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeErr(w, http.StatusMethodNotAllowed, "Méthode non autorisée")
			return
		}
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if strings.HasPrefix(p, "api/") {
			writeErr(w, 404, "Route inconnue")
			return
		}
		if p == "" || p == "." {
			p = "index.html"
		}
		if _, err := fs.Stat(dist, p); err != nil {
			// Client-side routes (/status, /hosts/3 ...) all load the app shell.
			p = "index.html"
		}
		if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if s.cfg.Role == RoleManagement && (p == "index.html" || p == "manifest.webmanifest") {
			s.serveManagementShell(w, dist, p)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + p
		if p == "index.html" {
			r2.URL.Path = "/" // FileServer redirects /index.html to /
		}
		files.ServeHTTP(w, r2)
	})
}

// managementShell rewrites the app shell and the PWA manifest for the management role:
// its own name, description and icons (public/mg), so both installed apps stay distinct.
var managementShell = strings.NewReplacer(
	"Homelab Monitoring", "Homelab Management",
	"Supervision du homelab : hôtes, sondes et page de statut.", "Gestion du homelab : inventaire, réseau, déploiements, Proxmox.",
	`"/icon`, `"/mg/icon`, `"/apple-touch-icon.png"`, `"/mg/apple-touch-icon.png"`,
)

func (s *Server) serveManagementShell(w http.ResponseWriter, dist fs.FS, p string) {
	b, err := fs.ReadFile(dist, p)
	if err != nil {
		writeErr(w, 404, "Introuvable")
		return
	}
	ct := "text/html; charset=utf-8"
	if p != "index.html" {
		ct = "application/manifest+json"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "no-cache")
	io.WriteString(w, managementShell.Replace(string(b)))
}
