package main

// WebSocket relay browser ↔ Proxmox for the noVNC console. A browser cannot send the API
// token header on a WebSocket: the server replays the handshake to /vncwebsocket with the
// token, then relays the bytes untouched. Sessions are one-time tokens valid 30 seconds.

import (
	"bufio"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type vncSession struct {
	integrationID int64
	node, typ     string
	vmid          int
	port, ticket  string
	expires       time.Time
}

func (s *Server) mgVncSession(w http.ResponseWriter, r *http.Request) {
	i, base, ok := s.pveTarget(w, r)
	if !ok {
		return
	}
	logSkip(r)
	var v struct {
		Port   any    `json:"port"`
		Ticket string `json:"ticket"`
	}
	if err := pve(r.Context(), i, "POST", base+"/vncproxy", url.Values{"websocket": {"1"}}, &v); err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "message": err.Error()})
		return
	}
	vmid, _ := strconv.Atoi(r.PathValue("vmid"))
	tok := randomToken(24)
	s.mg.vncMu.Lock()
	for k, x := range s.mg.vnc {
		if time.Now().After(x.expires) {
			delete(s.mg.vnc, k)
		}
	}
	s.mg.vnc[tok] = vncSession{integrationID: i.ID, node: r.PathValue("node"), typ: r.PathValue("type"), vmid: vmid,
		port: fmt.Sprint(v.Port), ticket: v.Ticket, expires: time.Now().Add(30 * time.Second)}
	s.mg.vncMu.Unlock()
	s.mgLog(r, "proxmox", i.ID, "action", fmt.Sprintf("%s : console de %s/%d ouverte", i.Name, r.PathValue("type"), vmid))
	writeJSON(w, 200, map[string]any{"ok": true, "token": tok, "password": v.Ticket})
}

func (s *Server) mgVncRelay(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := s.currentUser(r); !ok {
		writeErr(w, 401, "Connexion requise")
		return
	}
	if o := r.Header.Get("Origin"); o != "" && !s.sameOrigin(r) {
		writeErr(w, 403, "Origine refusée")
		return
	}
	tok := r.URL.Query().Get("token")
	s.mg.vncMu.Lock()
	v, ok := s.mg.vnc[tok]
	delete(s.mg.vnc, tok) // one use
	s.mg.vncMu.Unlock()
	if !ok || time.Now().After(v.expires) {
		writeErr(w, 403, "Session de console expirée")
		return
	}
	i, err := s.getIntegration(v.integrationID, "proxmox")
	if err != nil {
		writeErr(w, 404, "Intégration Proxmox introuvable")
		return
	}
	auth, err := pveAuth(r.Context(), i)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	var authLines strings.Builder
	for k, v := range auth {
		authLines.WriteString(k + ": " + v + "\r\n")
	}
	u, _ := url.Parse(i.URL)
	secure := u.Scheme == "https"
	port := u.Port()
	if port == "" {
		port = map[bool]string{true: "8006", false: "80"}[secure]
	}
	addr := net.JoinHostPort(u.Hostname(), port)
	var upstream net.Conn
	if secure {
		cfg := &tls.Config{InsecureSkipVerify: !i.Config.verify(false)}
		if net.ParseIP(u.Hostname()) == nil {
			cfg.ServerName = u.Hostname()
		}
		upstream, err = tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", addr, cfg)
	} else {
		upstream, err = net.DialTimeout("tcp", addr, 10*time.Second)
	}
	if err != nil {
		slog.Warn("vnc upstream", "integration", i.Name, "err", err)
		writeErr(w, 502, "Proxmox injoignable")
		return
	}
	defer upstream.Close()
	proto := r.Header.Get("Sec-WebSocket-Protocol")
	if proto == "" {
		proto = "binary"
	}
	ver := r.Header.Get("Sec-WebSocket-Version")
	if ver == "" {
		ver = "13"
	}
	path := fmt.Sprintf("/api2/json/nodes/%s/%s/%d/vncwebsocket?port=%s&vncticket=%s",
		url.PathEscape(v.node), v.typ, v.vmid, url.QueryEscape(v.port), url.QueryEscape(v.ticket))
	fmt.Fprintf(upstream, "GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"+
		"Sec-WebSocket-Version: %s\r\nSec-WebSocket-Protocol: %s\r\n%s\r\n",
		path, u.Host, r.Header.Get("Sec-WebSocket-Key"), ver, proto, authLines.String())

	conn, buf, err := http.NewResponseController(w).Hijack()
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetDeadline(time.Time{})
	// Proxmox's 101 answer goes back to the browser as-is, then both directions are copied.
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(conn, upstream)
		done <- struct{}{}
	}()
	go func() {
		io.Copy(upstream, io.MultiReader(bufferedReader(buf), conn))
		done <- struct{}{}
	}()
	<-done
}

// bufferedReader returns what the HTTP server already read past the request headers.
func bufferedReader(buf *bufio.ReadWriter) io.Reader {
	if n := buf.Reader.Buffered(); n > 0 {
		b, _ := buf.Reader.Peek(n)
		return io.LimitReader(buf.Reader, int64(len(b)))
	}
	return eofReader{}
}

type eofReader struct{}

func (eofReader) Read([]byte) (int, error) { return 0, io.EOF }
