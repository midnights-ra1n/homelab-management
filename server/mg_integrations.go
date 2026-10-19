package main

// Integrations (Proxmox VE, Webmin, Midnights Monitoring) and SSH keys. Secrets are stored
// encrypted (AES-256-GCM) and never sent to the browser.

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

var integrationTypes = []string{"proxmox", "webmin", "hlm"}

type integrationConfig struct {
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
	TokenID     string `json:"token_id,omitempty"`
	TokenSecret string `json:"token_secret,omitempty"`
	AuthHeader  string `json:"auth_header,omitempty"`
	VerifyTLS   *bool  `json:"verify_tls,omitempty"`
	SSHKeyID    int64  `json:"ssh_key_id,omitempty"`
	SSHUser     string `json:"ssh_user,omitempty"`
	SSHPort     int    `json:"ssh_port,omitempty"`
	SSHHostKey  string `json:"ssh_host_key,omitempty"` // SHA256 fingerprint pinned on first connection (TOFU)
}

func (c integrationConfig) verify(def bool) bool {
	if c.VerifyTLS == nil {
		return def
	}
	return *c.VerifyTLS
}

type integration struct {
	ID        int64             `json:"id"`
	Type      string            `json:"type"`
	Name      string            `json:"name"`
	URL       string            `json:"url"`
	Enabled   int               `json:"enabled"`
	Config    integrationConfig `json:"-"`
	CreatedAt string            `json:"created_at"`
	UpdatedAt string            `json:"updated_at"`
}

func (s *Server) loadIntegrations(where string, args ...any) ([]integration, error) {
	rows, err := s.db.Query(`SELECT id, type, name, url, enabled, config, created_at, updated_at FROM integrations `+where+` ORDER BY type, name COLLATE NOCASE`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []integration
	for rows.Next() {
		var i integration
		var cfg string
		if err := rows.Scan(&i.ID, &i.Type, &i.Name, &i.URL, &i.Enabled, &cfg, &i.CreatedAt, &i.UpdatedAt); err != nil {
			return nil, err
		}
		if cfg != "" {
			if plain, err := s.decrypt(cfg); err == nil {
				json.Unmarshal([]byte(plain), &i.Config)
			}
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (s *Server) getIntegration(id int64, typ string) (*integration, error) {
	list, err := s.loadIntegrations(`WHERE id = ? AND type = ?`, id, typ)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, integrationErr("Intégration introuvable")
	}
	return &list[0], nil
}

// public is the browser view of an integration: no secret, only whether one is set.
func (i integration) public() map[string]any {
	c := i.Config
	return map[string]any{
		"id": i.ID, "type": i.Type, "name": i.Name, "url": i.URL, "enabled": i.Enabled, "created_at": i.CreatedAt, "updated_at": i.UpdatedAt,
		"config": map[string]any{
			"username": c.Username, "token_id": c.TokenID, "verify_tls": c.VerifyTLS,
			"has_secret": c.Password != "" || c.TokenSecret != "", "has_header": c.AuthHeader != "",
			"ssh_key_id": nilIfZero(c.SSHKeyID), "ssh_user": c.SSHUser, "ssh_port": nilIfZero(int64(c.SSHPort)), "ssh_host_key": c.SSHHostKey,
		},
	}
}

func nilIfZero(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}

func (s *Server) mgListIntegrations(w http.ResponseWriter, r *http.Request) {
	where, args := "", []any{}
	if t := r.URL.Query().Get("type"); t != "" {
		where, args = "WHERE type = ?", append(args, t)
	}
	list, err := s.loadIntegrations(where, args...)
	if err != nil {
		serverErr(w, err)
		return
	}
	out := []map[string]any{}
	for _, i := range list {
		out = append(out, i.public())
	}
	writeJSON(w, 200, out)
}

var sshUserRe = regexp.MustCompile(`(?i)^([a-z_][a-z0-9_.-]*)?$`)

// integrationForm validates the form and merges it with the saved configuration: a secret
// left empty keeps the saved one; changing host or asking to forget resets the pinned SSH key.
func integrationForm(f *form, prev *integration) (integration, bool) {
	u := strings.TrimRight(strings.TrimSpace(f.raw("url")), "/")
	if u == "" {
		f.fail("url", "L'URL est requise")
	} else if !httpURLRe.MatchString(u) {
		f.fail("url", "URL http(s) invalide")
	}
	sshUser := strings.TrimSpace(f.raw("ssh_user"))
	if len(sshUser) > 32 || !sshUserRe.MatchString(sshUser) {
		f.fail("ssh_user", "Nom d'utilisateur SSH invalide")
	}
	in := integration{Type: f.enum("type", integrationTypes...), Name: f.required("name", "Le nom", 80), URL: u}
	if f.check("enabled") {
		in.Enabled = 1
	}
	verify := f.check("verify_tls")
	var keyID int64
	if v, ok := f.optID("ssh_key_id").(int64); ok {
		keyID = v
	}
	var port int
	if v, ok := f.optNum("ssh_port", true, 1, 65535).(int64); ok {
		port = int(v)
	}
	c := integrationConfig{
		Username: f.text("username", 200), Password: f.text("password", 500), TokenID: f.text("token_id", 200),
		TokenSecret: f.text("token_secret", 500), AuthHeader: f.text("auth_header", 1000), VerifyTLS: &verify,
		SSHKeyID: keyID, SSHUser: sshUser, SSHPort: port,
	}
	if prev != nil {
		p := prev.Config
		if c.Password == "" {
			c.Password = p.Password
		}
		if c.TokenSecret == "" {
			c.TokenSecret = p.TokenSecret
		}
		if c.AuthHeader == "" && !f.check("clear_header") {
			c.AuthHeader = p.AuthHeader
		}
		if hostOf(prev.URL) == hostOf(u) && p.SSHPort == c.SSHPort && !f.check("reset_host_key") {
			c.SSHHostKey = p.SSHHostKey
		}
	}
	in.Config = c
	return in, f.valid()
}

func hostOf(u string) string {
	p, err := url.Parse(u)
	if err != nil {
		return ""
	}
	return p.Hostname()
}

func (s *Server) mgSaveIntegration(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	var prev *integration
	if id > 0 {
		list, err := s.loadIntegrations(`WHERE id = ?`, id)
		if err != nil || len(list) == 0 {
			writeErr(w, 404, "Intégration introuvable")
			return
		}
		prev = &list[0]
	}
	in, valid := integrationForm(f, prev)
	if !valid {
		formInvalid(w, f)
		return
	}
	cfg, _ := json.Marshal(in.Config)
	enc := s.encrypt(string(cfg))
	var err error
	if id > 0 {
		_, err = s.db.Exec(`UPDATE integrations SET name = ?, url = ?, config = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?`,
			in.Name, in.URL, enc, in.Enabled, id)
		s.mgLog(r, "integration", id, "update", "Intégration « "+in.Name+" » modifiée")
	} else {
		var res interface{ LastInsertId() (int64, error) }
		res, err = s.db.Exec(`INSERT INTO integrations (type, name, url, config, enabled) VALUES (?, ?, ?, ?, ?)`, in.Type, in.Name, in.URL, enc, in.Enabled)
		if err == nil {
			id, _ = res.LastInsertId()
			s.mgLog(r, "integration", id, "create", fmt.Sprintf("Intégration %s « %s » ajoutée", in.Type, in.Name))
		}
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if prev != nil {
		formOK(w, "Intégration mise à jour.")
	} else {
		formOK(w, "Intégration ajoutée.")
	}
}

// mgTestIntegration tests the form's values without saving them.
func (s *Server) mgTestIntegration(w http.ResponseWriter, r *http.Request) {
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	logSkip(r)
	var prev *integration
	if id, _ := strconv.ParseInt(f.raw("id"), 10, 64); id > 0 {
		if list, err := s.loadIntegrations(`WHERE id = ?`, id); err == nil && len(list) > 0 {
			prev = &list[0]
		}
	}
	in, valid := integrationForm(f, prev)
	if !valid {
		for _, msg := range f.errs {
			writeJSON(w, 200, map[string]any{"ok": false, "message": msg})
			return
		}
	}
	in.ID = -1
	if prev != nil {
		in.ID = prev.ID
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	msg, err := s.testIntegration(ctx, &in)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "message": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "message": msg})
}

func (s *Server) testIntegration(ctx context.Context, i *integration) (string, error) {
	switch i.Type {
	case "proxmox":
		return s.testProxmox(ctx, i)
	case "webmin":
		return s.testWebmin(ctx, i)
	case "hlm":
		d, err := s.hlmData(ctx, i)
		if err != nil {
			return "", err
		}
		up := 0
		for _, h := range d.Hosts {
			if h["status"] == "operational" {
				up++
			}
		}
		return fmt.Sprintf("%d hôte(s) dont %d opérationnel(s), %d sonde(s)", len(d.Hosts), up, len(d.Monitors)), nil
	}
	return "", integrationErr("Type d'intégration inconnu")
}

/* ------------------------------------------------------------ HTTP client */

type integrationError struct {
	msg    string
	status int
}

func (e *integrationError) Error() string { return e.msg }

func integrationErr(msg string) error { return &integrationError{msg: msg} }

var (
	secureHTTP   = &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}}
	insecureHTTP = &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
)

// httpJSON calls an integration's API and turns network failures into readable French messages.
func httpJSON(ctx context.Context, method, u string, headers map[string]string, body io.Reader, verifyTLS bool, timeout time.Duration, out any) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return integrationErr("URL invalide")
	}
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := secureHTTP
	if !verifyTLS {
		client = insecureHTTP
	}
	resp, err := client.Do(req)
	if err != nil {
		var dnsErr *net.DNSError
		var certErr *tls.CertificateVerificationError
		switch msg := err.Error(); {
		case errors.Is(err, context.DeadlineExceeded):
			return integrationErr("Délai dépassé (pas de réponse)")
		case strings.Contains(msg, "connection refused"):
			return integrationErr("Connexion refusée")
		case errors.As(err, &dnsErr):
			return integrationErr("Hôte introuvable (DNS)")
		case strings.Contains(msg, "no route to host") || strings.Contains(msg, "network is unreachable"):
			return integrationErr("Hôte injoignable")
		case errors.As(err, &certErr) || strings.Contains(msg, "certificate"):
			return integrationErr("Certificat TLS non reconnu — désactive la vérification TLS pour un certificat auto-signé")
		default:
			return integrationErr(msg)
		}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		text, _ := io.ReadAll(io.LimitReader(resp.Body, 160))
		hint := fmt.Sprintf("HTTP %d", resp.StatusCode)
		switch resp.StatusCode {
		case 401:
			hint = "Authentification refusée"
		case 403:
			hint = "Permissions insuffisantes"
		}
		if t := strings.TrimSpace(string(text)); t != "" {
			hint += " — " + t
		}
		return &integrationError{msg: hint, status: resp.StatusCode}
	}
	if out == nil || resp.StatusCode == 204 {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<20)).Decode(out); err != nil {
		return integrationErr("Réponse illisible : " + err.Error())
	}
	return nil
}

// source is one integration's result in a list view (an error does not hide the others).
type source[T any] struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	URL   string `json:"url"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Data  T      `json:"data,omitempty"`
}

func collect[T any](ctx context.Context, list []integration, fetch func(context.Context, *integration) (T, error)) []source[T] {
	out := make([]source[T], len(list))
	var wg sync.WaitGroup
	for i := range list {
		wg.Add(1)
		go func() {
			defer wg.Done()
			it := &list[i]
			out[i] = source[T]{ID: it.ID, Name: it.Name, URL: it.URL}
			d, err := fetch(ctx, it)
			if err != nil {
				out[i].Error = err.Error()
				return
			}
			out[i].OK, out[i].Data = true, d
		}()
	}
	wg.Wait()
	return out
}

/* ------------------------------------------------------------- SSH keys */

func (s *Server) mgListSSHKeys(w http.ResponseWriter, r *http.Request) {
	rows, err := s.rows(`SELECT id, name, type, public_key, fingerprint, created_at FROM ssh_keys ORDER BY name COLLATE NOCASE`)
	writeRows(w, rows, err)
}

var sshKeyNameRe = regexp.MustCompile(`^[\w .@-]+$`)

func (s *Server) mgSaveSSHKey(w http.ResponseWriter, r *http.Request) {
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	name := strings.TrimSpace(f.raw("name"))
	if name == "" {
		f.fail("name", "Le nom est requis")
	} else if len(name) > 60 || !sshKeyNameRe.MatchString(name) {
		f.fail("name", "Lettres, chiffres, espace, « . @ - _ » uniquement")
	}
	mode := f.enum("mode", "ed25519", "rsa", "import")
	priv := f.text("private_key", 20000)
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	comment := "homelab-tools:" + name
	var pemKey []byte
	switch mode {
	case "import":
		if priv == "" {
			formFail(w, "private_key", "Colle la clé privée")
			return
		}
		pemKey = []byte(priv + "\n")
	case "ed25519":
		_, k, _ := ed25519.GenerateKey(rand.Reader)
		blk, err := ssh.MarshalPrivateKey(k, comment)
		if err != nil {
			serverErr(w, err)
			return
		}
		pemKey = pem.EncodeToMemory(blk)
	case "rsa":
		k, err := rsa.GenerateKey(rand.Reader, 4096)
		if err != nil {
			serverErr(w, err)
			return
		}
		blk, err := ssh.MarshalPrivateKey(k, comment)
		if err != nil {
			serverErr(w, err)
			return
		}
		pemKey = pem.EncodeToMemory(blk)
	}
	signer, err := ssh.ParsePrivateKey(pemKey)
	if err != nil {
		var pp *ssh.PassphraseMissingError
		if errors.As(err, &pp) {
			formFail(w, "private_key", "Clé privée protégée par une phrase de passe : non prise en charge")
		} else {
			formFail(w, "private_key", "Clé privée illisible : "+err.Error())
		}
		return
	}
	pub := signer.PublicKey()
	pubLine := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub))) + " " + comment
	res, err := s.db.Exec(`INSERT INTO ssh_keys (name, type, public_key, private_key, fingerprint) VALUES (?, ?, ?, ?, ?)`,
		name, pub.Type(), pubLine, s.encrypt(string(pemKey)), ssh.FingerprintSHA256(pub))
	if err != nil {
		formDBError(w, err, "name", "Une clé porte déjà ce nom")
		return
	}
	id, _ := res.LastInsertId()
	s.mgLog(r, "system", id, "create", "Clé SSH « "+name+" » ajoutée")
	if mode == "import" {
		formOK(w, "Clé importée.")
	} else {
		formOK(w, "Clé générée : ajoute la clé publique dans authorized_keys.")
	}
}

func (s *Server) privateKey(id int64) (ssh.Signer, error) {
	var enc string
	if err := s.db.QueryRow(`SELECT private_key FROM ssh_keys WHERE id = ?`, id).Scan(&enc); err != nil {
		return nil, integrationErr("Clé SSH introuvable (supprimée ?)")
	}
	plain, err := s.decrypt(enc)
	if err != nil {
		return nil, integrationErr("Clé SSH illisible")
	}
	return ssh.ParsePrivateKey([]byte(plain))
}

// sshExec runs a read-only command over key-based SSH. The host key is pinned: an empty
// expected fingerprint accepts the first one seen (returned to be remembered).
func sshExec(ctx context.Context, host string, port int, user string, signer ssh.Signer, expected, command string) (string, string, error) {
	var seen string
	cfg := &ssh.ClientConfig{
		User: user, Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)}, Timeout: 15 * time.Second,
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			seen = ssh.FingerprintSHA256(key)
			if expected != "" && expected != seen {
				return errors.New("host key mismatch")
			}
			return nil
		},
	}
	d := net.Dialer{Timeout: 15 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return "", "", integrationErr("SSH : " + err.Error())
	}
	deadline := time.Now().Add(20 * time.Second)
	conn.SetDeadline(deadline)
	c, chans, reqs, err := ssh.NewClientConn(conn, host, cfg)
	if err != nil {
		conn.Close()
		switch {
		case strings.Contains(err.Error(), "host key mismatch"):
			return "", seen, integrationErr("SSH : empreinte de l'hôte modifiée — possible attaque MITM. Réinitialise l'empreinte si l'hôte a été réinstallé.")
		case strings.Contains(err.Error(), "unable to authenticate"):
			return "", seen, integrationErr("SSH : authentification refusée (clé publique absente de authorized_keys ?)")
		}
		return "", seen, integrationErr("SSH : " + err.Error())
	}
	client := ssh.NewClient(c, chans, reqs)
	defer client.Close()
	sess, err := client.NewSession()
	if err != nil {
		return "", seen, integrationErr("SSH : " + err.Error())
	}
	defer sess.Close()
	stdout, _ := sess.StdoutPipe()
	if err := sess.Start(command); err != nil {
		return "", seen, integrationErr("SSH : " + err.Error())
	}
	out, _ := io.ReadAll(io.LimitReader(stdout, 256_000))
	sess.Wait()
	return string(out), seen, nil
}
