package main

// Native apps (iOS / macOS): push notifications through APNs, a compact summary for
// widgets, and preferences shared with the web interface. Devices are tied to the API
// token that registered them, so revoking the token stops its notifications.

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
)

// apns sends with a provider token (.p8 key), configured by environment variables:
// HLT_APNS_KEY (path to the .p8 file), HLT_APNS_KEY_ID, HLT_APNS_TEAM_ID, HLT_APNS_TOPIC (bundle id).
type apns struct {
	key           *ecdsa.PrivateKey
	keyID, teamID string
	topic         string
	client        *http.Client

	mu    sync.Mutex
	jwt   string
	jwtAt time.Time
}

var (
	apnsOnce   sync.Once
	apnsClient *apns
)

// apnsConfig returns nil when push is not configured.
func apnsConfig() *apns {
	apnsOnce.Do(func() {
		path, kid, team, topic := env("APNS_KEY", ""), env("APNS_KEY_ID", ""), env("APNS_TEAM_ID", ""), env("APNS_TOPIC", "")
		if path == "" || kid == "" || team == "" || topic == "" {
			return
		}
		b, err := os.ReadFile(path)
		if err != nil {
			slog.Error("APNs key", "err", err)
			return
		}
		blk, _ := pem.Decode(b)
		if blk == nil {
			slog.Error("APNs key: not a PEM file", "path", path)
			return
		}
		k, err := x509.ParsePKCS8PrivateKey(blk.Bytes)
		ek, ok := k.(*ecdsa.PrivateKey)
		if err != nil || !ok {
			slog.Error("APNs key: expected the .p8 (ECDSA P-256) key from the Apple developer account", "err", err)
			return
		}
		apnsClient = &apns{key: ek, keyID: kid, teamID: team, topic: topic, client: &http.Client{Timeout: 15 * time.Second}}
	})
	return apnsClient
}

// token returns the provider JWT; Apple wants it renewed between 20 and 60 minutes.
func (a *apns) token() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.jwt != "" && time.Since(a.jwtAt) < 40*time.Minute {
		return a.jwt, nil
	}
	enc := base64.RawURLEncoding.EncodeToString
	head, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": a.keyID})
	claims, _ := json.Marshal(map[string]any{"iss": a.teamID, "iat": time.Now().Unix()})
	unsigned := enc(head) + "." + enc(claims)
	sum := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, a.key, sum[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64) // JWS wants r||s, each left-padded to 32 bytes
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	a.jwt, a.jwtAt = unsigned+"."+enc(sig), time.Now()
	return a.jwt, nil
}

// send posts one notification; gone is true when Apple says the device token is dead.
func (a *apns) send(device string, sandbox bool, payload []byte) (gone bool, err error) {
	jwt, err := a.token()
	if err != nil {
		return false, err
	}
	host := "https://api.push.apple.com"
	if sandbox {
		host = "https://api.sandbox.push.apple.com"
	}
	req, _ := http.NewRequest("POST", host+"/3/device/"+device, bytes.NewReader(payload))
	req.Header.Set("authorization", "bearer "+jwt)
	req.Header.Set("apns-topic", a.topic)
	req.Header.Set("apns-push-type", "alert")
	req.Header.Set("apns-priority", "10")
	resp, err := a.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		return false, nil
	}
	var body struct{ Reason string }
	json.NewDecoder(resp.Body).Decode(&body)
	gone = resp.StatusCode == 410 || body.Reason == "BadDeviceToken" || body.Reason == "Unregistered" || body.Reason == "DeviceTokenNotForTopic"
	return gone, fmt.Errorf("APNs %d %s", resp.StatusCode, body.Reason)
}

// pushPayload groups the events of one notifier window into one notification, like the e-mail.
// hostMessage explains why a host is not operational, with the same wording as its e-mail alert.
func hostMessage(h *Host) string {
	switch {
	case !h.AgentDown:
		return ""
	case h.Reachable != nil && *h.Reachable:
		return "Agent hors ligne, l'hôte répond toujours au ping"
	}
	return "Agent hors ligne, l'hôte ne répond pas au ping"
}

func pushPayload(evs []Event) []byte {
	type pushEvent struct {
		Kind    string `json:"kind"`
		Name    string `json:"name"`
		From    string `json:"from,omitempty"`
		To      string `json:"to,omitempty"`
		Message string `json:"message,omitempty"`
		At      int64  `json:"at"`
	}
	label := func(e Event) string {
		if l, ok := warningLabels[e.Kind]; ok && e.To == "" {
			return l[0]
		}
		return statusLabels[e.To]
	}
	var title string
	var lines []string
	out := make([]pushEvent, 0, len(evs))
	down := 0
	for _, e := range evs {
		out = append(out, pushEvent{e.Kind, e.Name, e.From, e.To, e.Message, e.At.Unix()})
		if statusRank(e.To) >= statusRank(StatusMinor) {
			down++
		}
		line := e.Name
		if l := label(e); l != "" {
			line += " : " + l
		}
		if e.Message != "" {
			line += " · " + e.Message
		}
		lines = append(lines, line)
	}
	if len(evs) == 1 {
		title = evs[0].Name
		if l := label(evs[0]); l != "" {
			title += " : " + l
		}
		lines = []string{evs[0].Message}
	} else if down > 0 {
		title = fmt.Sprintf("%d service(s) en panne", down)
	} else {
		title = fmt.Sprintf("%d changement(s) d'état", len(evs))
	}
	if lines[0] == "" {
		lines[0] = evs[0].Kind
	}
	b, _ := json.Marshal(map[string]any{
		"aps": map[string]any{
			"alert":              map[string]string{"title": title, "body": strings.Join(capped(lines, 4), "\n")},
			"sound":              "default",
			"thread-id":          "midnights-monitoring",
			"mutable-content":    1, // lets a Notification Service Extension reload the widgets
			"interruption-level": map[bool]string{true: "time-sensitive", false: "active"}[down > 0],
		},
		"events": out,
	})
	return b
}

func (s *Server) handleTestPush(w http.ResponseWriter, r *http.Request) {
	if apnsConfig() == nil {
		writeErr(w, 400, "Notifications push non configurées : définissez HLT_APNS_KEY, HLT_APNS_KEY_ID, HLT_APNS_TEAM_ID et HLT_APNS_TOPIC")
		return
	}
	s.push([]Event{{Kind: "Test", Name: "Midnights Monitoring", Message: "Notification de test", At: time.Now()}})
	s.handleListDevices(w, r)
}

// push sends the events to every registered device and forgets the dead ones.
func (s *Server) push(evs []Event) {
	a := apnsConfig()
	if a == nil {
		return
	}
	rows, err := s.db.Query(`SELECT token, sandbox FROM push_devices`)
	if err != nil {
		slog.Error("push devices", "err", err)
		return
	}
	type dev struct {
		token   string
		sandbox bool
	}
	var devs []dev
	for rows.Next() {
		var d dev
		if rows.Scan(&d.token, &d.sandbox) == nil {
			devs = append(devs, d)
		}
	}
	rows.Close()
	payload := pushPayload(evs)
	for _, d := range devs {
		gone, err := a.send(d.token, d.sandbox, payload)
		if gone {
			s.db.Exec(`DELETE FROM push_devices WHERE token=?`, d.token)
		}
		msg := ""
		if err != nil {
			msg = err.Error()
			slog.Warn("push", "err", err, "removed", gone)
		}
		s.db.Exec(`UPDATE push_devices SET last_error=?, last_push_at=? WHERE token=?`, msg, time.Now().Unix(), d.token)
	}
}

type pushDevice struct {
	Token      string `json:"token"`
	Name       string `json:"name"`
	Sandbox    bool   `json:"sandbox"`
	TokenName  string `json:"api_token"`
	CreatedAt  int64  `json:"created_at"`
	LastPushAt int64  `json:"last_push_at"`
	LastError  string `json:"last_error"`
}

func (s *Server) apiRegisterDevice(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token   string `json:"token"`
		Name    string `json:"name"`
		Sandbox bool   `json:"sandbox"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Token = strings.ToLower(strings.TrimSpace(in.Token))
	if b, err := hex.DecodeString(in.Token); err != nil || len(b) < 32 || len(b) > 100 {
		writeErr(w, 400, "Le jeton APNs doit être la chaîne hexadécimale fournie par iOS (deviceToken)")
		return
	}
	name, msg := validName(in.Name)
	if msg != "" {
		writeErr(w, 400, msg)
		return
	}
	tokID, _ := r.Context().Value(tokenCtxKey{}).(int64)
	if _, err := s.db.Exec(`INSERT INTO push_devices(token,name,sandbox,api_token_id,created_at) VALUES(?,?,?,?,?)
		ON CONFLICT(token) DO UPDATE SET name=excluded.name, sandbox=excluded.sandbox, api_token_id=excluded.api_token_id`,
		in.Token, name, in.Sandbox, tokID, time.Now().Unix()); err != nil {
		serverErr(w, err)
		return
	}
	logName(r, name)
	writeJSON(w, 201, map[string]any{"token": in.Token, "push_enabled": apnsConfig() != nil})
}

func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	if _, err := s.db.Exec(`DELETE FROM push_devices WHERE token=?`, strings.ToLower(r.PathValue("token"))); err != nil {
		serverErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListDevices(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT d.token, d.name, d.sandbox, COALESCE(t.name, ''), d.created_at, d.last_push_at, d.last_error
		FROM push_devices d LEFT JOIN api_tokens t ON t.id = d.api_token_id ORDER BY d.created_at DESC`)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	out := []pushDevice{}
	for rows.Next() {
		var d pushDevice
		if err := rows.Scan(&d.Token, &d.Name, &d.Sandbox, &d.TokenName, &d.CreatedAt, &d.LastPushAt, &d.LastError); err != nil {
			serverErr(w, err)
			return
		}
		out = append(out, d)
	}
	writeJSON(w, 200, map[string]any{"push_enabled": apnsConfig() != nil, "devices": out})
}

// apiWidgets is one small call for home screen widgets: overall state, what is down and the power draw.
func (s *Server) apiWidgets(w http.ResponseWriter, r *http.Request) {
	sum, _, err := s.widgets()
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, sum)
}

// widgets is the /widgets payload (also the summary of /overview), with the hosts it was built from.
func (s *Server) widgets() (map[string]any, []Host, error) {
	sum, hosts, mons, err := s.statusSummary()
	if err != nil {
		return nil, nil, err
	}
	type item struct {
		Kind    string `json:"kind"` // host or monitor
		ID      int64  `json:"id"`
		Name    string `json:"name"`
		Status  string `json:"status"`
		Message string `json:"message"`
	}
	down := []item{}
	for _, h := range hosts {
		if statusRank(h.Status) >= statusRank(StatusDegraded) {
			down = append(down, item{"host", h.ID, h.Name, h.Status, hostMessage(&h)})
		}
	}
	for _, m := range mons {
		if statusRank(m.Status) >= statusRank(StatusDegraded) {
			down = append(down, item{"monitor", m.ID, m.Name, m.Status, m.Message})
		}
	}
	sum["problems"] = capped(down, 10)
	// Power: the latest reading and the 24 h average of each enabled smart plug, summed.
	var now, avg *float64
	var plugs int
	err = s.db.QueryRow(`SELECT COUNT(*), SUM(cur), SUM(avg) FROM (SELECT
		(SELECT value FROM monitor_results WHERE monitor_id=m.id ORDER BY ts DESC LIMIT 1) AS cur,
		(SELECT AVG(value) FROM monitor_results WHERE monitor_id=m.id AND ts>=?) AS avg
		FROM monitors m WHERE m.type='meross' AND m.enabled=1)`, time.Now().Add(-24*time.Hour).UnixMilli()).Scan(&plugs, &now, &avg)
	if err != nil {
		return nil, nil, err
	}
	sum["power"] = map[string]any{"plugs": plugs, "now_w": now, "avg_24h_w": avg}
	return sum, hosts, nil
}

const maxPreferences = 16 << 10

// preferences are free-form keys shared by the web interface and the apps (theme, views…).
func (s *Server) preferences() map[string]json.RawMessage {
	p := map[string]json.RawMessage{}
	json.Unmarshal([]byte(s.getSetting("preferences", "{}")), &p)
	return p
}

func (s *Server) handleGetPreferences(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.preferences())
}

// handlePutPreferences merges the keys sent (null removes one), so two clients editing
// different keys do not overwrite each other.
func (s *Server) handlePutPreferences(w http.ResponseWriter, r *http.Request) {
	var in map[string]json.RawMessage
	if !readJSONLimit(w, r, &in, maxPreferences) {
		return
	}
	p := s.preferences()
	for k, v := range in {
		if k == "" || len(k) > 64 {
			writeErr(w, 400, "Les clés doivent contenir de 1 à 64 caractères")
			return
		}
		if string(v) == "null" {
			delete(p, k)
		} else {
			p[k] = v
		}
	}
	b, _ := json.Marshal(p)
	if len(b) > maxPreferences {
		writeErr(w, 400, "Les préférences dépassent 16 Ko")
		return
	}
	if err := s.setSetting("preferences", string(b)); err != nil {
		serverErr(w, err)
		return
	}
	logName(r, strings.Join(slices.Sorted(maps.Keys(in)), ", "))
	writeJSON(w, 200, p)
}
