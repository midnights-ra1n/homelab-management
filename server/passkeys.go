package main

// Passkeys (WebAuthn), offered only over HTTPS. User verification (biometrics, PIN) is
// required: a passkey replaces the password, it is not a second factor. The user handle is
// the user id in ASCII, as homelab-management wrote it, so existing passkeys keep working.

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// passkeysTable is created by the monitoring role (homelab-management already has it).
const passkeysTable = `CREATE TABLE passkeys (
	id           TEXT PRIMARY KEY,
	user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	public_key   BLOB NOT NULL,
	counter      INTEGER NOT NULL DEFAULT 0,
	transports   TEXT NOT NULL DEFAULT '',
	name         TEXT NOT NULL,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	last_used_at TEXT,
	flags        INTEGER);
	CREATE INDEX passkeys_user ON passkeys(user_id);`

type pkUser struct {
	id    int64
	name  string
	creds []webauthn.Credential
}

func (u *pkUser) WebAuthnID() []byte                         { return []byte(strconv.FormatInt(u.id, 10)) }
func (u *pkUser) WebAuthnName() string                       { return u.name }
func (u *pkUser) WebAuthnDisplayName() string                { return u.name }
func (u *pkUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

// Ceremonies in progress, one use each, 5 minutes.
// shortcut: in memory, a restart cancels the ceremonies in progress; fine for a single instance.
var pkSessions = struct {
	sync.Mutex
	m map[string]pkSession
}{m: map[string]pkSession{}}

type pkSession struct {
	data   webauthn.SessionData
	userID int64 // 0 for a sign-in
	origin string
}

func storePkSession(p pkSession) string {
	pkSessions.Lock()
	defer pkSessions.Unlock()
	now := time.Now()
	for k, v := range pkSessions.m {
		if v.data.Expires.Before(now) {
			delete(pkSessions.m, k)
		}
	}
	if len(pkSessions.m) > 1000 {
		clear(pkSessions.m)
	}
	id := randomToken(16)
	pkSessions.m[id] = p
	return id
}

func takePkSession(id string, userID int64, origin string) (webauthn.SessionData, bool) {
	pkSessions.Lock()
	defer pkSessions.Unlock()
	p, ok := pkSessions.m[id]
	delete(pkSessions.m, id)
	return p.data, ok && p.userID == userID && p.origin == origin && p.data.Expires.After(time.Now())
}

func (s *Server) passkeysAvailable(r *http.Request) bool { return s.isHTTPS(r) }

// relyingParty derives the WebAuthn configuration from the browser's origin, which the
// middleware already checked against the Host (or HLT_PUBLIC_URL).
func (s *Server) relyingParty(r *http.Request) (*webauthn.WebAuthn, string, bool) {
	origin := r.Header.Get("Origin")
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || !s.isHTTPS(r) || !s.sameOrigin(r) {
		return nil, "", false
	}
	w, err := webauthn.New(&webauthn.Config{
		RPID: u.Hostname(), RPDisplayName: "Homelab", RPOrigins: []string{origin},
		Timeouts: webauthn.TimeoutsConfig{
			Login:        webauthn.TimeoutConfig{Enforce: true, Timeout: 5 * time.Minute},
			Registration: webauthn.TimeoutConfig{Enforce: true, Timeout: 5 * time.Minute},
		},
	})
	return w, origin, err == nil
}

func (s *Server) loadPkUser(id int64) (*pkUser, error) {
	u := &pkUser{id: id}
	if err := s.db.QueryRow(`SELECT username FROM users WHERE id=?`, id).Scan(&u.name); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, public_key, counter, transports, flags FROM passkeys WHERE user_id=?`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, transports string
		var pk []byte
		var counter uint32
		var flags sql.NullInt64
		if err := rows.Scan(&cid, &pk, &counter, &transports, &flags); err != nil {
			return nil, err
		}
		raw, err := base64.RawURLEncoding.DecodeString(cid)
		if err != nil {
			continue
		}
		c := webauthn.Credential{ID: raw, PublicKey: pk, Authenticator: webauthn.Authenticator{SignCount: counter}}
		if flags.Valid {
			c.Flags = webauthn.CredentialFlagsFromMsgpByte(byte(flags.Int64))
		} else {
			c.Flags.UserPresent, c.Flags.UserVerified = true, true
			c.Flags.BackupEligible = true // legacy row: replaced by the authenticator's flags in handlePasskeyLoginFinish
		}
		for _, t := range strings.Split(transports, ",") {
			if t != "" {
				c.Transport = append(c.Transport, protocol.AuthenticatorTransport(t))
			}
		}
		u.creds = append(u.creds, c)
	}
	return u, rows.Err()
}

func (s *Server) handlePasskeyLoginBegin(w http.ResponseWriter, r *http.Request) {
	wa, origin, ok := s.relyingParty(r)
	if !ok {
		writeErr(w, 400, "Les passkeys nécessitent HTTPS")
		return
	}
	opts, sess, err := wa.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"session": storePkSession(pkSession{data: *sess, origin: origin}), "options": opts.Response})
}

func (s *Server) handlePasskeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	setLogActor(r, "IP "+ip)
	if !s.limiter.allow("login:" + ip) {
		writeErr(w, http.StatusTooManyRequests, "Trop de tentatives, réessayez dans une minute")
		return
	}
	wa, origin, ok := s.relyingParty(r)
	if !ok {
		writeErr(w, 400, "Les passkeys nécessitent HTTPS")
		return
	}
	sess, ok := takePkSession(r.URL.Query().Get("session"), 0, origin)
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if !ok || err != nil {
		writeErr(w, 400, "Demande de connexion expirée, réessayez")
		return
	}
	parsed, err := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(body))
	if err != nil {
		writeErr(w, 400, "Réponse de passkey invalide")
		return
	}
	var user *pkUser
	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		id, err := strconv.ParseInt(string(userHandle), 10, 64)
		if err != nil {
			return nil, err
		}
		if user, err = s.loadPkUser(id); err != nil {
			return nil, err
		}
		for i := range user.creds {
			var flags sql.NullInt64
			cid := base64.RawURLEncoding.EncodeToString(user.creds[i].ID)
			if bytes.Equal(user.creds[i].ID, rawID) && s.db.QueryRow(`SELECT flags FROM passkeys WHERE id=?`, cid).Scan(&flags) == nil && !flags.Valid {
				user.creds[i].Flags = webauthn.NewCredentialFlags(parsed.Response.AuthenticatorData.Flags)
			}
		}
		return user, nil
	}
	cred, err := wa.ValidateDiscoverableLogin(handler, sess, parsed)
	if err != nil || user == nil {
		slog.Warn("passkey rejected", "ip", ip, "err", err)
		writeErr(w, http.StatusUnauthorized, "Passkey non reconnue")
		return
	}
	setLogActor(r, user.name)
	s.db.Exec(`UPDATE passkeys SET counter=?, flags=?, last_used_at=datetime('now') WHERE id=?`,
		cred.Authenticator.SignCount, int64(cred.Flags.MsgpByte()), base64.RawURLEncoding.EncodeToString(cred.ID))
	s.startSession(w, r, user.id)
}

type passkeyRow struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	CreatedAt  string  `json:"created_at"`
	LastUsedAt *string `json:"last_used_at"`
}

func (s *Server) handleListPasskeys(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id=? ORDER BY created_at`, r.Context().Value(ctxKey{}).(int64))
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	out := []passkeyRow{}
	for rows.Next() {
		var p passkeyRow
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.LastUsedAt); err != nil {
			serverErr(w, err)
			return
		}
		out = append(out, p)
	}
	writeJSON(w, 200, map[string]any{"passkeys": out, "available": s.passkeysAvailable(r)})
}

func (s *Server) handlePasskeyRegisterBegin(w http.ResponseWriter, r *http.Request) {
	wa, origin, ok := s.relyingParty(r)
	if !ok {
		writeErr(w, 400, "Les passkeys nécessitent HTTPS")
		return
	}
	uid := r.Context().Value(ctxKey{}).(int64)
	user, err := s.loadPkUser(uid)
	if err != nil {
		serverErr(w, err)
		return
	}
	opts, sess, err := wa.BeginRegistration(user,
		webauthn.WithConveyancePreference(protocol.PreferNoAttestation),
		webauthn.WithExclusions(webauthn.Credentials(user.creds).CredentialDescriptors()),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey: protocol.ResidentKeyRequirementRequired, UserVerification: protocol.VerificationRequired,
		}))
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"session": storePkSession(pkSession{data: *sess, userID: uid, origin: origin}), "options": opts.Response})
}

// handlePasskeyRegisterFinish takes the credential as the body, ?session= and ?name=.
func (s *Server) handlePasskeyRegisterFinish(w http.ResponseWriter, r *http.Request) {
	wa, origin, ok := s.relyingParty(r)
	if !ok {
		writeErr(w, 400, "Les passkeys nécessitent HTTPS")
		return
	}
	uid := r.Context().Value(ctxKey{}).(int64)
	sess, ok := takePkSession(r.URL.Query().Get("session"), uid, origin)
	if !ok {
		writeErr(w, 400, "Demande expirée, réessayez")
		return
	}
	user, err := s.loadPkUser(uid)
	if err != nil {
		serverErr(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	cred, err := wa.FinishRegistration(user, sess, r)
	if err != nil {
		slog.Warn("passkey registration rejected", "err", err)
		writeErr(w, 400, "Enregistrement de la passkey refusé")
		return
	}
	name := clip(strings.TrimSpace(r.URL.Query().Get("name")), 60)
	if name == "" {
		name = "Passkey"
	}
	var transports []string
	for _, t := range cred.Transport {
		transports = append(transports, string(t))
	}
	if _, err := s.db.Exec(`INSERT INTO passkeys(id, user_id, public_key, counter, transports, name, flags) VALUES(?,?,?,?,?,?,?)`,
		base64.RawURLEncoding.EncodeToString(cred.ID), uid, cred.PublicKey, cred.Authenticator.SignCount,
		strings.Join(transports, ","), name, int64(cred.Flags.MsgpByte())); err != nil {
		serverErr(w, err)
		return
	}
	logName(r, name)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleDeletePasskey(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value(ctxKey{}).(int64)
	var name string
	if err := s.db.QueryRow(`SELECT name FROM passkeys WHERE id=? AND user_id=?`, r.PathValue("id"), uid).Scan(&name); err != nil {
		writeErr(w, 404, "Passkey introuvable")
		return
	}
	if _, err := s.db.Exec(`DELETE FROM passkeys WHERE id=? AND user_id=?`, r.PathValue("id"), uid); err != nil {
		serverErr(w, err)
		return
	}
	logName(r, name)
	w.WriteHeader(http.StatusNoContent)
}
