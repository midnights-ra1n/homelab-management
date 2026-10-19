package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	db, err := openDB(dir)
	if err != nil {
		t.Fatal(err)
	}
	priv, err := loadOrCreateKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{cfg: Config{DataDir: dir, Role: RoleMonitoring}, db: db, priv: priv, key: make([]byte, 32), pub: priv.Public().(ed25519.PublicKey),
		limiter: newRateLimiter(100, time.Minute), agents: map[int64]*agentConn{}}
	s.notifier = newNotifier(s)
	if err := s.initSetup(); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routes())
	t.Cleanup(func() { ts.Close(); db.Close() })
	return s, ts
}

func do(t *testing.T, ts *httptest.Server, method, path, cookie string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, ts.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", ts.URL)
	if cookie != "" {
		req.Header.Set("Cookie", sessionCookie+"="+cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func setupAdmin(t *testing.T, s *Server, ts *httptest.Server) string {
	t.Helper()
	resp, out := do(t, ts, "POST", "/api/auth/setup", "", credentials{Username: "admin", Password: "correct horse battery"})
	if resp.StatusCode != 200 {
		t.Fatalf("setup: %d %v", resp.StatusCode, out)
	}
	for _, c := range resp.Cookies() {
		if c.Name == sessionCookie {
			if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
				t.Fatal("session cookie must be HttpOnly + SameSite=Strict")
			}
			return c.Value
		}
	}
	t.Fatal("no session cookie")
	return ""
}

func TestSetupAndAuth(t *testing.T) {
	s, ts := newTestServer(t)
	if resp, _ := do(t, ts, "GET", "/api/hosts", "", nil); resp.StatusCode != 401 {
		t.Fatalf("unauthenticated access: %d", resp.StatusCode)
	}
	cookie := setupAdmin(t, s, ts)
	if resp, _ := do(t, ts, "POST", "/api/auth/setup", "", credentials{Username: "y", Password: "correct horse battery"}); resp.StatusCode != 409 {
		t.Fatalf("second setup must be refused: %d", resp.StatusCode)
	}
	if resp, _ := do(t, ts, "GET", "/api/hosts", cookie, nil); resp.StatusCode != 200 {
		t.Fatalf("authenticated access: %d", resp.StatusCode)
	}
	if resp, _ := do(t, ts, "POST", "/api/auth/login", "", credentials{Username: "admin", Password: "wrong password!!"}); resp.StatusCode != 401 {
		t.Fatalf("bad password: %d", resp.StatusCode)
	}
	if resp, _ := do(t, ts, "POST", "/api/auth/login", "", credentials{Username: "admin", Password: "correct horse battery"}); resp.StatusCode != 200 {
		t.Fatalf("login: %d", resp.StatusCode)
	}
}

func TestCrossOriginMutationBlocked(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	req, _ := http.NewRequest("POST", ts.URL+"/api/hosts", strings.NewReader(`{"name":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Cookie", sessionCookie+"="+cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Fatalf("cross-origin POST: %d", resp.StatusCode)
	}
}

func TestAgentHandshakeAndMetrics(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	_, created := do(t, ts, "POST", "/api/hosts", cookie, map[string]string{"name": "pve-01"})
	install := created["install"].(map[string]any)
	token := install["token"].(string)
	pub, _ := base64.StdEncoding.DecodeString(install["key"].(string))

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/agent/ws"
	nonce := make([]byte, 32)
	rand.Read(nonce)
	hdr := http.Header{"Authorization": {"Bearer " + token}, "X-Agent-Nonce": {base64.StdEncoding.EncodeToString(nonce)}}

	// Unknown token is refused before the upgrade.
	bad := http.Header{"Authorization": {"Bearer " + strings.Repeat("a", 43)}, "X-Agent-Nonce": hdr["X-Agent-Nonce"]}
	if _, resp, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{HTTPHeader: bad}); err == nil || resp.StatusCode != 401 {
		t.Fatalf("unknown token must be refused")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	var hello struct {
		Type     string `json:"type"`
		Sig      string `json:"sig"`
		Interval int    `json:"interval"`
	}
	if err := wsjson.Read(ctx, c, &hello); err != nil {
		t.Fatal(err)
	}
	sig, _ := base64.StdEncoding.DecodeString(hello.Sig)
	msg := append([]byte(agentAuthContext), nonce...)
	msg = append(msg, hashToken(token)...)
	if !ed25519.Verify(pub, msg, sig) {
		t.Fatal("hub signature does not verify with the advertised key")
	}
	wsjson.Write(ctx, c, agentMsg{Type: "info", Info: &agentInfo{Hostname: "pve-01", OS: "Debian 13"}})
	wsjson.Write(ctx, c, agentMsg{Type: "metrics", Metrics: &agentMetrics{CPU: 12.5, MemUsed: 1, MemTotal: 4, Disks: []agentDisk{{Mount: "/", Used: 1, Total: 2}}}})
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		s.db.QueryRow(`SELECT COUNT(*) FROM host_metrics`).Scan(&n)
		if n == 1 {
			_, h := do(t, ts, "GET", "/api/hosts/1", cookie, nil)
			if h["status"] != StatusOperational || !h["connected"].(bool) {
				t.Fatalf("host status: %v", h)
			}
			testLive(t, ctx, c, ts, cookie)
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("metrics were not stored")
}

// testLive: the first poll asks the agent for live mode, the samples it streams are served.
func testLive(t *testing.T, ctx context.Context, c *websocket.Conn, ts *httptest.Server, cookie string) {
	if _, l := do(t, ts, "GET", "/api/hosts/1/live", cookie, nil); l["live"] != false {
		t.Fatalf("no sample yet: %v", l)
	}
	var ask map[string]any
	if err := wsjson.Read(ctx, c, &ask); err != nil || ask["type"] != "live" || ask["seconds"] != 60.0 {
		t.Fatalf("live request: %v %v", ask, err)
	}
	wsjson.Write(ctx, c, agentMsg{Type: "live", Metrics: &agentMetrics{CPU: 42}})
	for range 60 {
		if _, l := do(t, ts, "GET", "/api/hosts/1/live", cookie, nil); l["live"] == true {
			if l["metrics"].(map[string]any)["cpu"] != 42.0 {
				t.Fatalf("live sample: %v", l)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("live sample not served")
}

func TestStatusMatcher(t *testing.T) {
	m, ok := statusMatcher("200-299, 301")
	if !ok || !m(204) || !m(301) || m(302) || m(500) {
		t.Fatal("matcher")
	}
	for _, bad := range []string{"", "abc", "300-200", "99", "200-700"} {
		if _, ok := statusMatcher(bad); ok {
			t.Fatalf("%q must be rejected", bad)
		}
	}
}

func TestHTTPAndTCPChecks(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/fail" {
			w.WriteHeader(503)
		}
		w.Write([]byte("hello world"))
	}))
	defer up.Close()
	cases := []struct {
		m    Monitor
		want string
	}{
		{Monitor{Name: "a", Type: "http", Target: up.URL}, StatusOperational},
		{Monitor{Name: "b", Type: "http", Target: up.URL + "/fail"}, StatusMinor},
		{Monitor{Name: "c", Type: "http", Target: up.URL, Config: MonitorConfig{Keyword: "absent"}}, StatusMinor},
		{Monitor{Name: "d", Type: "tcp", Target: strings.TrimPrefix(up.URL, "http://")}, StatusOperational},
	}
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := l.Addr().String()
	l.Close()
	cases = append(cases, struct {
		m    Monitor
		want string
	}{Monitor{Name: "e", Type: "tcp", Target: closed}, StatusMajor})
	for _, c := range cases {
		if msg := c.m.validate(); msg != "" {
			t.Fatalf("%s: %s", c.m.Name, msg)
		}
		if got := runCheck(context.Background(), &c.m); got.status != c.want {
			t.Errorf("%s: got %s (%s), want %s", c.m.Name, got.status, got.message, c.want)
		}
	}
}

func TestPingCheck(t *testing.T) {
	m := Monitor{Name: "p", Type: "ping", Target: "127.0.0.1"}
	if msg := m.validate(); msg != "" {
		t.Fatal(msg)
	}
	got := runCheck(context.Background(), &m)
	if got.status == StatusUnknown {
		t.Skip("ICMP unavailable here:", got.message)
	}
	if got.status != StatusOperational || got.latency == nil {
		t.Fatalf("got %s (%s)", got.status, got.message)
	}
}

func TestUDPCheck(t *testing.T) {
	echo, _ := net.ListenPacket("udp", "127.0.0.1:0")
	defer echo.Close()
	go func() {
		buf := make([]byte, 64)
		for {
			n, a, err := echo.ReadFrom(buf)
			if err != nil {
				return
			}
			echo.WriteTo(append([]byte("pong "), buf[:n]...), a)
		}
	}()
	silent, _ := net.ListenPacket("udp", "127.0.0.1:0")
	defer silent.Close()
	closed, _ := net.ListenPacket("udp", "127.0.0.1:0")
	closedAddr := closed.LocalAddr().String()
	closed.Close()
	for _, c := range []struct {
		m    Monitor
		want string
	}{
		{Monitor{Name: "echo", Type: "udp", Target: echo.LocalAddr().String(), Config: MonitorConfig{Payload: "ping", Expected: "pong"}}, StatusOperational},
		{Monitor{Name: "bad answer", Type: "udp", Target: echo.LocalAddr().String(), Config: MonitorConfig{Expected: "nope"}}, StatusMinor},
		{Monitor{Name: "wireguard-like", Type: "udp", Target: silent.LocalAddr().String(), TimeoutS: 1}, StatusOperational},
		{Monitor{Name: "silent, answer expected", Type: "udp", Target: silent.LocalAddr().String(), TimeoutS: 1, Config: MonitorConfig{Expected: "x"}}, StatusMajor},
		{Monitor{Name: "closed", Type: "udp", Target: closedAddr, TimeoutS: 1}, StatusMajor},
	} {
		if msg := c.m.validate(); msg != "" {
			t.Fatalf("%s: %s", c.m.Name, msg)
		}
		if got := runCheck(context.Background(), &c.m); got.status != c.want {
			t.Errorf("%s: got %s (%s), want %s", c.m.Name, got.status, got.message, c.want)
		}
	}
}

func TestMonitorValidation(t *testing.T) {
	for _, m := range []Monitor{
		{Name: "x", Type: "http", Target: "file:///etc/passwd"},
		{Name: "x", Type: "tcp", Target: "host"},
		{Name: "x", Type: "dns", Target: "example.com", Config: MonitorConfig{RecordType: "ANY"}},
		{Name: "x", Type: "exec", Target: "rm -rf /"},
		{Name: "", Type: "tcp", Target: "a:1"},
		{Name: "x", Type: "tcp", Target: "a:1", IntervalS: 5},
		{Name: "x", Type: "ping", Target: "192.168.1.1:22"},
	} {
		if m.validate() == "" {
			t.Errorf("%+v must be rejected", m)
		}
	}
}

func TestEmailTemplateEscapes(t *testing.T) {
	evs := []Event{{Kind: "Sonde", Name: `<script>alert(1)</script>`, From: StatusOperational, To: StatusMajor, At: time.Now()}}
	subj, body, err := renderEmail("Alerte\r\nBcc: x@evil {{.Down}}", defaultEmailHTML, buildEmailData("T", "", evs))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(body, "<script>") {
		t.Fatal("service name must be HTML-escaped")
	}
	if strings.ContainsAny(subj, "\r\n") {
		t.Fatal("subject must not contain line breaks")
	}
	if !strings.Contains(body, "#9d3533") {
		t.Fatal("status colour missing")
	}
}

func TestNotifierGroupsEvents(t *testing.T) {
	s, _ := newTestServer(t)
	s.setSetting("notify_window_s", "3600")
	for i := 0; i < 15; i++ {
		s.notifier.add(Event{Name: "svc", From: StatusOperational, To: StatusMajor, At: time.Now()})
	}
	s.notifier.mu.Lock()
	n, timer := len(s.notifier.pending), s.notifier.timer
	s.notifier.mu.Unlock()
	if n != 15 || timer == nil {
		t.Fatalf("expected 15 pending events behind a single timer, got %d", n)
	}
	timer.Stop()
}

func TestSettingsValidation(t *testing.T) {
	if validateSettings(settingDefs, map[string]string{"nope": "1"}) == "" {
		t.Fatal("unknown key accepted")
	}
	if validateSettings(settingDefs, map[string]string{"agent_interval_s": "1"}) == "" {
		t.Fatal("out of range accepted")
	}
	if validateSettings(settingDefs, map[string]string{"email_html": "{{.Broken"}) == "" {
		t.Fatal("broken template accepted")
	}
	if msg := validateSettings(settingDefs, map[string]string{"agent_interval_s": "60", "smtp_tls": "tls"}); msg != "" {
		t.Fatal(msg)
	}
}

func TestPasswordHash(t *testing.T) {
	h := hashPassword("correct horse battery")
	if !checkPassword(h, "correct horse battery") || checkPassword(h, "wrong") || checkPassword("garbage", "x") {
		t.Fatal("password hashing")
	}
}

func TestHTTPSCertificateCheck(t *testing.T) {
	up := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer up.Close()
	m := Monitor{Name: "tls", Type: "http", Target: up.URL, Config: MonitorConfig{CheckSSL: true, IgnoreTLS: true}}
	if msg := m.validate(); msg != "" {
		t.Fatal(msg)
	}
	res := runCheck(context.Background(), &m)
	if res.status != StatusOperational || res.certExpiry == nil || !strings.Contains(res.message, "certificat valide") {
		t.Fatalf("got %+v", res)
	}
	plain := Monitor{Name: "x", Type: "http", Target: "http://example.fr", Config: MonitorConfig{CheckSSL: true}}
	if plain.validate() == "" {
		t.Fatal("check_ssl on http:// must be rejected")
	}
}

func TestCertificateWarningSentOnce(t *testing.T) {
	s, _ := newTestServer(t)
	s.setSetting("notify_window_s", "3600")
	m := Monitor{Name: "cloud", Type: "ssl", Target: "example.fr", Config: MonitorConfig{WarnDays: 3}}
	m.validate()
	id, err := s.insertMonitor(&m)
	if err != nil {
		t.Fatal(err)
	}
	soon := time.Now().Add(50 * time.Hour)
	for i := 0; i < 3; i++ {
		mons, _ := s.loadMonitors("WHERE id=?", id)
		if err := s.recordResult(&mons[0], checkResult{status: StatusOperational, certExpiry: &soon}, StatusOperational); err != nil {
			t.Fatal(err)
		}
	}
	s.notifier.mu.Lock()
	defer s.notifier.mu.Unlock()
	if len(s.notifier.pending) != 1 || s.notifier.pending[0].Kind != KindCert {
		t.Fatalf("expected exactly one certificate warning, got %+v", s.notifier.pending)
	}
	s.notifier.timer.Stop()
	d := buildEmailData("T", "", s.notifier.pending)
	subj, _, err := renderEmail(defaultSubject, defaultEmailHTML, d)
	if err != nil || !strings.Contains(subj, "Avertissement") {
		t.Fatalf("subject %q err %v", subj, err)
	}
}

func TestTimezoneSetting(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	if resp, _ := do(t, ts, "PUT", "/api/settings", cookie, map[string]string{"timezone": "Mars/Olympus"}); resp.StatusCode != 400 {
		t.Fatal("unknown zone accepted")
	}
	if resp, _ := do(t, ts, "PUT", "/api/settings", cookie, map[string]string{"timezone": "Europe/Paris"}); resp.StatusCode != 200 {
		t.Fatal("Europe/Paris refused")
	}
	// 11:46 UTC on 14 Oct 2026 is 13:46 in Paris (CEST).
	at := time.Date(2026, 10, 14, 11, 46, 0, 0, time.UTC)
	d := buildEmailData("T", "", []Event{{Kind: "Sonde", Name: "x", From: StatusOperational, To: StatusMajor, At: at}})
	if d.Events[0].Time != "13:46:00" {
		t.Fatalf("event time %s, want 13:46:00", d.Events[0].Time)
	}
	tzLoc.Store(time.UTC) // other tests expect the default
}

func TestForwardedProto(t *testing.T) {
	for hdr, want := range map[[2]string]string{
		{"X-Forwarded-Proto", "https"}:                    "https",
		{"X-Forwarded-Proto", "HTTPS, http"}:              "https",
		{"Forwarded", `for=1.2.3.4;proto="https";host=x`}: "https",
		{"Forwarded", "for=1.2.3.4"}:                      "",
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set(hdr[0], hdr[1])
		if got := forwardedProto(r); got != want {
			t.Errorf("%s: %q → %q, want %q", hdr[0], hdr[1], got, want)
		}
	}
}

func TestParseProxies(t *testing.T) {
	nets, bad := parseProxies(`"192.168.1.10, 172.18.0.0/16;::1 nope"`)
	if len(nets) != 3 || len(bad) != 1 || nets[0].String() != "192.168.1.10/32" || nets[2].String() != "::1/128" {
		t.Fatalf("%v %v", nets, bad)
	}
	if publicURL(`"https://mon.example.fr/"`) != "https://mon.example.fr" || publicURL("mon.example.fr") != "" {
		t.Fatal("public URL")
	}
}

func TestHostStatusAgentDown(t *testing.T) {
	s, _ := newTestServer(t)
	now := time.Now().Unix()
	yes, no := true, false
	for _, c := range []struct {
		name      string
		h         Host
		reachable *bool
		want      string
	}{
		{"connected", Host{ID: 1, LastSeen: now, Connected: true}, nil, StatusOperational},
		{"just disconnected", Host{ID: 2, LastSeen: now - 20}, nil, StatusOperational},
		{"agent stopped, host up", Host{ID: 3, LastSeen: now - 120}, &yes, StatusDegraded},
		{"agent stopped, host down", Host{ID: 4, LastSeen: now - 120}, &no, StatusMajor},
		{"agent stopped, no ICMP", Host{ID: 5, LastSeen: now - 120}, nil, StatusMajor},
		{"silent but connected", Host{ID: 6, LastSeen: now - 600, Connected: true}, &yes, StatusDegraded},
	} {
		s.hostPings.set(c.h.ID, c.reachable)
		if got := s.hostStatus(&c.h); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
	if ip := hostAddress(json.RawMessage(`{"ips":[{"iface":"lo","address":"127.0.0.1"},{"iface":"docker0","address":"172.17.0.1"},{"iface":"eth0","address":"fe80::1"},{"iface":"eth0","address":"192.168.1.20"}]}`)); ip != "192.168.1.20" {
		t.Errorf("hostAddress = %q", ip)
	}
}

func TestLegacyPortRedirect(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	h := legacyHandler(ok, "8080", "3000", true)
	for _, c := range []struct{ method, host, path, loc string }{
		{"GET", "192.168.1.20:8080", "/hosts?x=1", "http://192.168.1.20:3000/hosts?x=1"},
		{"GET", "[fd00::1]:8080", "/", "http://[fd00::1]:3000/"},
		{"GET", "192.168.1.20:8080", "/api/health", ""},   // API and agents are served
		{"POST", "192.168.1.20:8080", "/oauth/token", ""}, // writes are served
		{"GET", "monitoring.example.fr", "/", ""},         // behind a reverse proxy: served
	} {
		r := httptest.NewRequest(c.method, c.path, nil)
		r.Host = c.host
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if got := w.Header().Get("Location"); got != c.loc || (c.loc == "" && w.Code != 200) {
			t.Errorf("%s %s%s: code %d, Location %q, want %q", c.method, c.host, c.path, w.Code, got, c.loc)
		}
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.Host = "192.168.1.20:8080"
	w := httptest.NewRecorder()
	legacyHandler(ok, "8080", "3000", false).ServeHTTP(w, r)
	if w.Code != 200 {
		t.Errorf("docker: code %d, want 200 (no redirect)", w.Code)
	}
}
