package main

// Journal (activity table): every change made through the web UI or the API is recorded
// with who did it, then kept for logRetentionDays. Writes are logged by one middleware
// from the matched route, so no handler can forget it; handlers only add the item's name.

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

const logRetentionDays = 90

type logInfo struct {
	actor string
	name  string
	skip  bool
}

type logCtxKey struct{}

func logInfoFrom(r *http.Request) *logInfo {
	li, _ := r.Context().Value(logCtxKey{}).(*logInfo)
	return li
}

// logName attaches the affected item's name to the journal entry of this request.
func logName(r *http.Request, name string) {
	if li := logInfoFrom(r); li != nil {
		li.name = name
	}
}

// logSkip drops the journal entry of this request (no-op changes, previews).
func logSkip(r *http.Request) {
	if li := logInfoFrom(r); li != nil {
		li.skip = true
	}
}

func setLogActor(r *http.Request, actor string) {
	if li := logInfoFrom(r); li != nil {
		li.actor = actor
	}
}

// logEvent records one entry. id may be 0 when the entry is not about one item.
func (s *Server) logEvent(actor, entity string, id int64, action, summary string) {
	var eid any
	if id > 0 {
		eid = id
	}
	if _, err := s.db.Exec(`INSERT INTO activity(entity_type, entity_id, action, summary, actor) VALUES(?,?,?,?,?)`,
		entity, eid, action, clip(summary, 500), clip(actor, 120)); err != nil {
		slog.Error("journal", "err", err)
	}
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (w *statusRecorder) WriteHeader(code int) {
	if w.code == 0 {
		w.code = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusRecorder) Write(b []byte) (int, error) {
	if w.code == 0 {
		w.code = 200
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusRecorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// journal logs successful writes (and failed sign-ins) once the route has run.
func (s *Server) journal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions || !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		li := &logInfo{}
		r = r.WithContext(context.WithValue(r.Context(), logCtxKey{}, li))
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if li.skip || r.Pattern == "" {
			return
		}
		label, ok := journalLabels[r.Pattern]
		if !ok {
			return
		}
		failedLogin := rec.code == http.StatusUnauthorized && (r.Pattern == "POST /api/auth/login" || r.Pattern == "POST /api/v1/auth/login")
		if rec.code >= 400 && !failedLogin {
			return
		}
		actor := li.actor
		if actor == "" {
			actor = "IP " + s.clientIP(r)
		}
		summary := label.text
		if failedLogin {
			summary = "Échec de connexion"
		}
		if li.name != "" {
			summary += " : « " + li.name + " »"
		}
		id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if id > 0 && li.name == "" {
			summary += " (n° " + strconv.FormatInt(id, 10) + ")"
		}
		s.logEvent(actor, label.entity, id, label.action, summary)
	})
}

type journalLabel struct{ entity, action, text string }

func jl(entity, action, text string) journalLabel { return journalLabel{entity, action, text} }

// journalLabels maps a route pattern to its journal entry. Routes missing here are not logged
// (read-only POSTs such as previews and connection tests).
var journalLabels = map[string]journalLabel{
	// Shared
	"POST /api/auth/setup":          jl("account", "create", "Compte administrateur créé"),
	"POST /api/auth/login":          jl("account", "login", "Connexion"),
	"POST /api/auth/logout":         jl("account", "logout", "Déconnexion"),
	"POST /api/auth/password":       jl("account", "update", "Mot de passe modifié"),
	"PUT /api/settings":             jl("settings", "update", "Paramètres modifiés"),
	"POST /api/database/cleanup":    jl("database", "cleanup", "Base de données nettoyée"),
	"POST /api/database/vacuum":     jl("database", "vacuum", "Base de données compactée"),
	"POST /api/system/update":       jl("system", "update", "Mise à jour du serveur demandée"),
	"PUT /api/mcp/config":           jl("settings", "update", "Serveur MCP"),
	"POST /api/oauth/authorize":     jl("mcp", "create", "Accès au serveur MCP autorisé"),
	"POST /api/mcp/clients":         jl("mcp", "create", "Client OAuth créé"),
	"DELETE /api/mcp/clients/{id}":  jl("mcp", "delete", "Client OAuth révoqué"),
	"POST /api/import":              jl("settings", "import", "Import de données"),
	"POST /api/passkeys":            jl("account", "create", "Passkey ajoutée"),
	"DELETE /api/passkeys/{id}":     jl("account", "delete", "Passkey supprimée"),
	"POST /api/auth/passkey/finish": jl("account", "login", "Connexion par passkey"),

	// Monitoring
	"POST /api/hosts":                       jl("host", "create", "Hôte ajouté"),
	"PATCH /api/hosts/{id}":                 jl("host", "update", "Hôte modifié"),
	"POST /api/disks/refresh":               jl("host", "action", "Relevé SMART demandé à tous les hôtes"),
	"DELETE /api/hosts/{id}":                jl("host", "delete", "Hôte supprimé"),
	"POST /api/hosts/{id}/token":            jl("host", "update", "Jeton d'agent régénéré"),
	"POST /api/hosts/{id}/action":           jl("host", "action", "Action lancée sur l'hôte"),
	"POST /api/monitors":                    jl("monitor", "create", "Sonde ajoutée"),
	"PUT /api/monitors/{id}":                jl("monitor", "update", "Sonde modifiée"),
	"DELETE /api/monitors/{id}":             jl("monitor", "delete", "Sonde supprimée"),
	"POST /api/settings/test-email":         jl("settings", "test", "E-mail de test envoyé"),
	"POST /api/reports/monthly/send":        jl("report", "send", "Rapport mensuel envoyé"),
	"POST /api/reports/weekly/send":         jl("report", "send", "Rapport hebdomadaire envoyé"),
	"POST /api/reports/energy/send":         jl("report", "send", "Rapport de consommation envoyé"),
	"POST /api/meross/login":                jl("settings", "update", "Compte Meross connecté"),
	"DELETE /api/meross":                    jl("settings", "update", "Compte Meross déconnecté"),
	"PUT /api/status/layout":                jl("status", "update", "Page de statut modifiée"),
	"POST /api/enroll-tokens":               jl("token", "create", "Jeton d'inscription créé"),
	"DELETE /api/enroll-tokens/{id}":        jl("token", "delete", "Jeton d'inscription supprimé"),
	"POST /api/tokens":                      jl("token", "create", "Jeton d'API créé"),
	"DELETE /api/tokens/{id}":               jl("token", "delete", "Jeton d'API révoqué"),
	"POST /api/v1/auth/login":               jl("account", "login", "Connexion d'une application"),
	"POST /api/v1/auth/logout":              jl("account", "logout", "Déconnexion d'une application"),
	"POST /api/v1/hosts":                    jl("host", "create", "Hôte inscrit par l'API"),
	"POST /api/v1/devices":                  jl("device", "create", "Appareil inscrit aux notifications push"),
	"DELETE /api/v1/devices/{token}":        jl("device", "delete", "Appareil retiré des notifications push"),
	"DELETE /api/devices/{token}":           jl("device", "delete", "Appareil retiré des notifications push"),
	"POST /api/devices/test":                jl("device", "test", "Notification push de test envoyée"),
	"PUT /api/preferences":                  jl("settings", "update", "Préférences modifiées"),
	"PUT /api/v1/preferences":               jl("settings", "update", "Préférences modifiées par l'API"),
	"DELETE /api/v1/hosts/{id}":             jl("host", "delete", "Hôte supprimé par l'API"),
	"PUT /api/v1/hosts/{id}/maintenance":    jl("host", "update", "Maintenance de l'hôte modifiée par l'API"),
	"PUT /api/v1/monitors/{id}/maintenance": jl("monitor", "update", "Maintenance de la sonde modifiée par l'API"),
}

type activityRow struct {
	ID         int64  `json:"id"`
	EntityType string `json:"entity_type"`
	EntityID   *int64 `json:"entity_id"`
	Action     string `json:"action"`
	Summary    string `json:"summary"`
	Actor      string `json:"actor"`
	CreatedAt  string `json:"created_at"` // UTC, "YYYY-MM-DD HH:MM:SS"
}

func (s *Server) queryActivity(where string, args ...any) ([]activityRow, error) {
	rows, err := s.db.Query(`SELECT id, entity_type, entity_id, action, summary, actor, created_at FROM activity `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []activityRow{}
	for rows.Next() {
		var a activityRow
		if err := rows.Scan(&a.ID, &a.EntityType, &a.EntityID, &a.Action, &a.Summary, &a.Actor, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// handleLogs lists the journal, newest first: ?q= search, ?entity= type, ?entity_id=, ?before= id cursor.
func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"1=1"}
	var args []any
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		where = append(where, "(summary LIKE ? OR actor LIKE ?)")
		like := "%" + clip(v, 100) + "%"
		args = append(args, like, like)
	}
	if v := q.Get("entity"); v != "" {
		where = append(where, "entity_type=?")
		args = append(args, v)
	}
	if v, err := strconv.ParseInt(q.Get("entity_id"), 10, 64); err == nil && v > 0 {
		where = append(where, "entity_id=?")
		args = append(args, v)
	}
	if v, err := strconv.ParseInt(q.Get("before"), 10, 64); err == nil && v > 0 {
		where = append(where, "id<?")
		args = append(args, v)
	}
	limit := 100
	if v, err := strconv.Atoi(q.Get("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}
	items, err := s.queryActivity("WHERE "+strings.Join(where, " AND ")+" ORDER BY id DESC LIMIT ?", append(args, limit)...)
	if err != nil {
		serverErr(w, err)
		return
	}
	entities := []string{}
	rows, err := s.db.Query(`SELECT DISTINCT entity_type FROM activity ORDER BY 1`)
	if err == nil {
		for rows.Next() {
			var e string
			if rows.Scan(&e) == nil {
				entities = append(entities, e)
			}
		}
		rows.Close()
	}
	writeJSON(w, 200, map[string]any{"items": items, "entities": entities, "retention_days": logRetentionDays, "more": len(items) == limit})
}
