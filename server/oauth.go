package main

// OAuth 2.1 for the MCP server (MCP authorization spec 2025-06-18), so Claude can connect
// on its own with only the server address:
//   - discovery: /.well-known/oauth-protected-resource (RFC 9728) and
//     /.well-known/oauth-authorization-server (RFC 8414);
//   - dynamic client registration (RFC 7591), limited to Claude's redirect URIs (claude.ai and
//     claude.com connectors) and loopback ones (Claude Code, Claude Desktop); it can be turned off;
//   - clients created by hand in the settings (client id + secret) for any https redirect URI;
//   - authorization code with PKCE S256 only, approved by a signed-in user on /oauth/authorize
//     (a page of the web app), access tokens of 1 hour and rotating refresh tokens of 90 days,
//     all stored hashed.
// The static bearer token of the settings keeps working for clients configured by hand.

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

const oauthTables = `CREATE TABLE IF NOT EXISTS oauth_clients(
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	secret_hash BLOB,
	redirect_uris TEXT NOT NULL,
	dynamic INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	last_used_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS oauth_tokens(
	hash BLOB PRIMARY KEY,
	client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	expires_at INTEGER NOT NULL);`

const (
	oauthAccessTTL  = time.Hour
	oauthRefreshTTL = 90 * 24 * time.Hour
	oauthCodeTTL    = 2 * time.Minute
)

// claudeRedirects are the callbacks of Claude's custom connectors (web, desktop and mobile apps).
var claudeRedirects = []string{"https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"}

// validRedirect accepts Claude's callbacks and loopback addresses (RFC 8252); clients made by
// hand may also use any https address.
func validRedirect(raw string, manual bool) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Fragment != "" || u.Host == "" || len(raw) > 500 {
		return false
	}
	if slices.Contains(claudeRedirects, raw) {
		return true
	}
	if h := u.Hostname(); u.Scheme == "http" && (h == "localhost" || h == "127.0.0.1" || h == "::1") {
		return true
	}
	return manual && u.Scheme == "https"
}

type oauthClient struct {
	ID        string   `json:"client_id"`
	Name      string   `json:"name"`
	Redirects []string `json:"redirect_uris"`
	Dynamic   bool     `json:"dynamic"`
	Secret    bool     `json:"confidential"`
	CreatedAt int64    `json:"created_at"`
	LastUsed  int64    `json:"last_used_at"`
	Tokens    int      `json:"active_tokens"`
	secret    []byte
}

func (s *Server) loadClients(where string, args ...any) ([]oauthClient, error) {
	rows, err := s.db.Query(`SELECT c.id, c.name, c.secret_hash, c.redirect_uris, c.dynamic, c.created_at, c.last_used_at,
		(SELECT COUNT(*) FROM oauth_tokens t WHERE t.client_id = c.id AND t.kind = 'refresh' AND t.expires_at > ?)
		FROM oauth_clients c `+where+` ORDER BY c.created_at DESC`, append([]any{time.Now().Unix()}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []oauthClient{}
	for rows.Next() {
		var c oauthClient
		var redirects string
		if err := rows.Scan(&c.ID, &c.Name, &c.secret, &redirects, &c.Dynamic, &c.CreatedAt, &c.LastUsed, &c.Tokens); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(redirects), &c.Redirects)
		c.Secret = c.secret != nil
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Server) getClient(id string) (*oauthClient, bool) {
	list, err := s.loadClients(`WHERE c.id = ?`, id)
	if err != nil || len(list) == 0 {
		return nil, false
	}
	return &list[0], true
}

// insertClient stores a client and returns its secret ("" for a public client).
func (s *Server) insertClient(name string, redirects []string, confidential, dynamic bool) (*oauthClient, string, error) {
	c := &oauthClient{ID: "mcp-" + randomToken(16), Name: name, Redirects: redirects, Dynamic: dynamic, Secret: confidential, CreatedAt: time.Now().Unix()}
	var secret string
	var hash any
	if confidential {
		secret = "mcpcs_" + randomToken(32)
		hash = hashToken(secret)
	}
	b, _ := json.Marshal(redirects)
	_, err := s.db.Exec(`INSERT INTO oauth_clients(id, name, secret_hash, redirect_uris, dynamic, created_at) VALUES(?,?,?,?,?,?)`,
		c.ID, name, hash, string(b), dynamic, c.CreatedAt)
	return c, secret, err
}

// Authorization codes live in memory for two minutes; a restart only cancels logins in progress.
type oauthCode struct {
	client, redirect, challenge string
	expires                     time.Time
}

var oauthCodes = struct {
	sync.Mutex
	m map[string]oauthCode
}{m: map[string]oauthCode{}}

func oauthErr(w http.ResponseWriter, code int, kind, desc string) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, code, map[string]string{"error": kind, "error_description": desc})
}

// mcpOpen gates the public OAuth endpoints like /api/mcp itself: HTTPS and MCP enabled.
func (s *Server) mcpOpen(w http.ResponseWriter, r *http.Request) bool {
	if !s.isHTTPS(r) {
		writeErr(w, 403, "Le serveur MCP n'est disponible qu'en HTTPS (derrière un reverse proxy)")
		return false
	}
	if s.getSetting("mcp_enabled", "false") != "true" {
		writeErr(w, 404, "Le serveur MCP est désactivé (Paramètres → Serveur MCP)")
		return false
	}
	return true
}

func (s *Server) oauthRoutes(mux *http.ServeMux) {
	auth := s.requireAuth
	mux.HandleFunc("GET /.well-known/oauth-protected-resource", s.handleResourceMeta)
	mux.HandleFunc("GET /.well-known/oauth-protected-resource/api/mcp", s.handleResourceMeta)
	mux.HandleFunc("GET /.well-known/oauth-authorization-server", s.handleASMeta)
	mux.HandleFunc("POST /oauth/register", s.handleOAuthRegister)
	mux.HandleFunc("POST /oauth/token", s.handleOAuthToken)
	mux.HandleFunc("GET /api/oauth/authorize", auth(s.handleOAuthInfo))
	mux.HandleFunc("POST /api/oauth/authorize", auth(s.handleOAuthApprove))
	mux.HandleFunc("GET /api/mcp/clients", auth(s.handleListClients))
	mux.HandleFunc("POST /api/mcp/clients", auth(s.handleCreateClient))
	mux.HandleFunc("DELETE /api/mcp/clients/{id}", auth(s.handleDeleteClient))
}

func (s *Server) handleResourceMeta(w http.ResponseWriter, r *http.Request) {
	if !s.mcpOpen(w, r) {
		return
	}
	base := s.baseURL(r)
	w.Header().Set("Access-Control-Allow-Origin", "*")
	writeJSON(w, 200, map[string]any{"resource": base + "/api/mcp", "authorization_servers": []string{base},
		"bearer_methods_supported": []string{"header"}, "scopes_supported": []string{"mcp"},
		"resource_name": s.getSetting("status_title", "Homelab") + " (" + s.cfg.Role + ")"})
}

func (s *Server) handleASMeta(w http.ResponseWriter, r *http.Request) {
	if !s.mcpOpen(w, r) {
		return
	}
	base := s.baseURL(r)
	meta := map[string]any{"issuer": base, "authorization_endpoint": base + "/oauth/authorize", "token_endpoint": base + "/oauth/token",
		"response_types_supported": []string{"code"}, "grant_types_supported": []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported": []string{"S256"}, "scopes_supported": []string{"mcp"},
		"token_endpoint_auth_methods_supported": []string{"none", "client_secret_post", "client_secret_basic"}}
	if s.getSetting("mcp_dcr", "true") == "true" {
		meta["registration_endpoint"] = base + "/oauth/register"
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	writeJSON(w, 200, meta)
}

func (s *Server) handleOAuthRegister(w http.ResponseWriter, r *http.Request) {
	if !s.mcpOpen(w, r) {
		return
	}
	if !s.limiter.allow("oauth:" + s.clientIP(r)) {
		oauthErr(w, 429, "slow_down", "Trop de tentatives")
		return
	}
	if s.getSetting("mcp_dcr", "true") != "true" {
		oauthErr(w, 403, "access_denied", "Inscription automatique désactivée : créez un client OAuth dans les paramètres")
		return
	}
	var in struct {
		RedirectURIs []string `json:"redirect_uris"`
		ClientName   string   `json:"client_name"`
		AuthMethod   string   `json:"token_endpoint_auth_method"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in) != nil {
		oauthErr(w, 400, "invalid_client_metadata", "JSON invalide")
		return
	}
	if len(in.RedirectURIs) == 0 || len(in.RedirectURIs) > 10 {
		oauthErr(w, 400, "invalid_redirect_uri", "Une à dix adresses de redirection")
		return
	}
	for _, u := range in.RedirectURIs {
		if !validRedirect(u, false) {
			oauthErr(w, 400, "invalid_redirect_uri", "Inscription automatique réservée à Claude (claude.ai, claude.com) et aux applications locales : "+u)
			return
		}
	}
	method := in.AuthMethod
	if method == "" {
		method = "client_secret_basic" // RFC 7591 default
	}
	if method != "none" && method != "client_secret_post" && method != "client_secret_basic" {
		oauthErr(w, 400, "invalid_client_metadata", "token_endpoint_auth_method non pris en charge")
		return
	}
	name := clip(strings.TrimSpace(in.ClientName), 80)
	if name == "" {
		name = "Client MCP"
	}
	// Clients registered automatically but never used for a day are dropped.
	s.db.Exec(`DELETE FROM oauth_clients WHERE dynamic = 1 AND last_used_at = 0 AND created_at < ?`, time.Now().Add(-24*time.Hour).Unix())
	c, secret, err := s.insertClient(name, in.RedirectURIs, method != "none", true)
	if err != nil {
		serverErr(w, err)
		return
	}
	s.logEvent("inscription automatique", "mcp", 0, "create", "Client OAuth « "+name+" » inscrit pour le serveur MCP")
	out := map[string]any{"client_id": c.ID, "client_id_issued_at": c.CreatedAt, "client_name": name, "redirect_uris": in.RedirectURIs,
		"token_endpoint_auth_method": method, "grant_types": []string{"authorization_code", "refresh_token"}, "response_types": []string{"code"}}
	if secret != "" {
		out["client_secret"], out["client_secret_expires_at"] = secret, 0
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 201, out)
}

// checkAuthorize validates an authorization request and returns its client and redirect URI.
func (s *Server) checkAuthorize(q url.Values) (*oauthClient, string, string) {
	c, ok := s.getClient(q.Get("client_id"))
	if !ok {
		return nil, "", "Client OAuth inconnu : il a peut-être été révoqué, relancez la connexion depuis Claude"
	}
	redirect := q.Get("redirect_uri")
	if redirect == "" && len(c.Redirects) == 1 {
		redirect = c.Redirects[0]
	}
	if !slices.Contains(c.Redirects, redirect) {
		return nil, "", "Adresse de redirection non déclarée pour ce client"
	}
	if q.Get("response_type") != "code" {
		return nil, "", "Seul le flux « code » est pris en charge"
	}
	if ch := q.Get("code_challenge"); q.Get("code_challenge_method") != "S256" || len(ch) < 43 || len(ch) > 128 {
		return nil, "", "PKCE (S256) obligatoire"
	}
	return c, redirect, ""
}

func (s *Server) handleOAuthInfo(w http.ResponseWriter, r *http.Request) {
	if !s.mcpOpen(w, r) {
		return
	}
	c, redirect, msg := s.checkAuthorize(r.URL.Query())
	if msg != "" {
		writeErr(w, 400, msg)
		return
	}
	u, _ := url.Parse(redirect)
	writeJSON(w, 200, map[string]any{"client_name": c.Name, "redirect_host": u.Host, "dynamic": c.Dynamic,
		"server": s.getSetting("status_title", "Homelab"), "role": s.cfg.Role})
}

func (s *Server) handleOAuthApprove(w http.ResponseWriter, r *http.Request) {
	if !s.mcpOpen(w, r) {
		return
	}
	var in struct {
		Query   string `json:"query"`
		Approve bool   `json:"approve"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	q, _ := url.ParseQuery(strings.TrimPrefix(in.Query, "?"))
	c, redirect, msg := s.checkAuthorize(q)
	if msg != "" {
		writeErr(w, 400, msg)
		return
	}
	back := url.Values{}
	if st := q.Get("state"); st != "" {
		back.Set("state", st)
	}
	if in.Approve {
		code := randomToken(32)
		oauthCodes.Lock()
		for k, v := range oauthCodes.m {
			if time.Now().After(v.expires) {
				delete(oauthCodes.m, k)
			}
		}
		oauthCodes.m[code] = oauthCode{client: c.ID, redirect: redirect, challenge: q.Get("code_challenge"), expires: time.Now().Add(oauthCodeTTL)}
		oauthCodes.Unlock()
		back.Set("code", code)
		logName(r, c.Name)
	} else {
		back.Set("error", "access_denied")
		logName(r, c.Name+" (refusé)")
	}
	sep := "?"
	if strings.Contains(redirect, "?") {
		sep = "&"
	}
	writeJSON(w, 200, map[string]string{"redirect": redirect + sep + back.Encode()})
}

// clientCredentials reads client_secret_basic or client_secret_post credentials.
func clientCredentials(r *http.Request) (id, secret string) {
	if u, p, ok := r.BasicAuth(); ok {
		id, _ = url.QueryUnescape(u)
		secret, _ = url.QueryUnescape(p)
		return id, secret
	}
	return r.PostFormValue("client_id"), r.PostFormValue("client_secret")
}

func (s *Server) handleOAuthToken(w http.ResponseWriter, r *http.Request) {
	if !s.mcpOpen(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if r.ParseForm() != nil {
		oauthErr(w, 400, "invalid_request", "Formulaire invalide")
		return
	}
	id, secret := clientCredentials(r)
	c, ok := s.getClient(id)
	if !ok || (c.secret != nil && subtle.ConstantTimeCompare(hashToken(secret), c.secret) != 1) {
		if !s.limiter.allow("oauth:" + s.clientIP(r)) {
			oauthErr(w, 429, "slow_down", "Trop de tentatives")
			return
		}
		w.Header().Set("WWW-Authenticate", `Basic realm="mcp"`)
		oauthErr(w, 401, "invalid_client", "Client ou secret invalide")
		return
	}
	switch r.PostFormValue("grant_type") {
	case "authorization_code":
		oauthCodes.Lock()
		code, ok := oauthCodes.m[r.PostFormValue("code")]
		delete(oauthCodes.m, r.PostFormValue("code")) // one use, even on failure
		oauthCodes.Unlock()
		sum := sha256.Sum256([]byte(r.PostFormValue("code_verifier")))
		if !ok || time.Now().After(code.expires) || code.client != c.ID || code.redirect != r.PostFormValue("redirect_uri") ||
			base64.RawURLEncoding.EncodeToString(sum[:]) != code.challenge {
			oauthErr(w, 400, "invalid_grant", "Code d'autorisation invalide ou expiré")
			return
		}
	case "refresh_token":
		res, err := s.db.Exec(`DELETE FROM oauth_tokens WHERE hash = ? AND kind = 'refresh' AND client_id = ? AND expires_at > ?`,
			hashToken(r.PostFormValue("refresh_token")), c.ID, time.Now().Unix())
		if n, _ := res.RowsAffected(); err != nil || n == 0 {
			oauthErr(w, 400, "invalid_grant", "Jeton de renouvellement invalide ou expiré")
			return
		}
	default:
		oauthErr(w, 400, "unsupported_grant_type", "grant_type : authorization_code ou refresh_token")
		return
	}
	access, refresh := "mcpat_"+randomToken(32), "mcprt_"+randomToken(32)
	now := time.Now()
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	tx.Exec(`DELETE FROM oauth_tokens WHERE expires_at < ?`, now.Unix())
	tx.Exec(`UPDATE oauth_clients SET last_used_at = ? WHERE id = ?`, now.Unix(), c.ID)
	for _, t := range []struct {
		tok, kind string
		ttl       time.Duration
	}{{access, "access", oauthAccessTTL}, {refresh, "refresh", oauthRefreshTTL}} {
		if _, err := tx.Exec(`INSERT INTO oauth_tokens(hash, client_id, kind, expires_at) VALUES(?,?,?,?)`, hashToken(t.tok), c.ID, t.kind, now.Add(t.ttl).Unix()); err != nil {
			serverErr(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"access_token": access, "token_type": "Bearer", "expires_in": int(oauthAccessTTL.Seconds()),
		"refresh_token": refresh, "scope": "mcp"})
}

// oauthAccessValid tells whether tok is a live OAuth access token.
func (s *Server) oauthAccessValid(tok string) bool {
	if !strings.HasPrefix(tok, "mcpat_") {
		return false
	}
	var one int
	err := s.db.QueryRow(`SELECT 1 FROM oauth_tokens WHERE hash = ? AND kind = 'access' AND expires_at > ?`, hashToken(tok), time.Now().Unix()).Scan(&one)
	return err == nil
}

func (s *Server) handleListClients(w http.ResponseWriter, r *http.Request) {
	list, err := s.loadClients("")
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"clients": list, "claude_redirects": claudeRedirects})
}

func (s *Server) handleCreateClient(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name         string   `json:"name"`
		RedirectURIs []string `json:"redirect_uris"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > 80 {
		writeErr(w, 400, "Le nom est obligatoire (80 caractères au plus)")
		return
	}
	var redirects []string
	for _, u := range in.RedirectURIs {
		if u = strings.TrimSpace(u); u != "" {
			redirects = append(redirects, u)
		}
	}
	if len(redirects) == 0 {
		redirects = claudeRedirects
	}
	if len(redirects) > 10 {
		writeErr(w, 400, "Dix adresses de redirection au plus")
		return
	}
	for _, u := range redirects {
		if !validRedirect(u, true) {
			writeErr(w, 400, "Adresse de redirection invalide (https://… ou http://localhost…) : "+u)
			return
		}
	}
	c, secret, err := s.insertClient(name, redirects, true, false)
	if err != nil {
		serverErr(w, err)
		return
	}
	logName(r, name)
	writeJSON(w, 201, map[string]any{"client_id": c.ID, "client_secret": secret}) // the secret is shown once
}

func (s *Server) handleDeleteClient(w http.ResponseWriter, r *http.Request) {
	c, ok := s.getClient(r.PathValue("id"))
	if !ok {
		writeErr(w, 404, "Client OAuth introuvable")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	tx.Exec(`DELETE FROM oauth_tokens WHERE client_id = ?`, c.ID)
	if _, err := tx.Exec(`DELETE FROM oauth_clients WHERE id = ?`, c.ID); err != nil {
		serverErr(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	logName(r, c.Name)
	w.WriteHeader(http.StatusNoContent)
}
