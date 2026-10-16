// Command homelab-tools is the homelab server. One binary, two roles chosen at start-up:
//   - monitoring: receives agent metrics, runs probes (HTTP, TCP, DNS, SSL, SNMP), sends grouped
//     e-mail alerts and serves the public status page;
//   - management: inventory, IPAM, deployments, tasks, map, Proxmox / Webmin integrations,
//     fed by the monitoring role's API.
//
// Each role has its own database and its own web interface (same design system).
package main

import (
	"context"
	"crypto/ed25519"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

var version = "dev" // set with -ldflags "-X main.version=..."

// repo publishes the releases (server .deb, agent binaries) used by the update checks.
const repo = "midnights-ra1n/homelab-management"

const (
	RoleMonitoring = "monitoring"
	RoleManagement = "management"
)

type Config struct {
	Role           string
	Listen         string
	DataDir        string
	PublicURL      string
	TrustedProxies []*net.IPNet
	Install        string // deb, docker or "" (manual build): decides how updates are applied
}

type Server struct {
	cfg      Config
	db       *sql.DB
	priv     ed25519.PrivateKey
	pub      ed25519.PublicKey
	notifier *Notifier
	limiter  *rateLimiter

	setupMu   sync.Mutex
	setupOpen bool // true until the first account exists

	agentsMu sync.Mutex
	agents   map[int64]*agentConn

	mg  *mgState // management role only
	csp string
}

// env reads HLT_<k>, falling back to the HLM_<k> name used by homelab-monitoring.
func env(k, def string) string {
	if v := os.Getenv("HLT_" + k); v != "" {
		return v
	}
	if v := os.Getenv("HLM_" + k); v != "" {
		return v
	}
	return def
}

func main() {
	// Used by the Docker HEALTHCHECK: the distroless image has no curl.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		_, port, _ := net.SplitHostPort(env("LISTEN", ":8080"))
		c := &http.Client{Timeout: 3 * time.Second}
		resp, err := c.Get("http://127.0.0.1:" + port + "/api/health")
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		os.Exit(0)
	}
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "version") {
		fmt.Println(version)
		return
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))
	cfg := Config{
		Role:      env("ROLE", RoleMonitoring),
		Listen:    env("LISTEN", ":8080"),
		DataDir:   env("DATA_DIR", "./data"),
		PublicURL: strings.TrimRight(env("PUBLIC_URL", ""), "/"),
		Install:   env("INSTALL", ""),
	}
	if cfg.Role != RoleMonitoring && cfg.Role != RoleManagement {
		slog.Error("HLT_ROLE must be monitoring or management", "value", cfg.Role)
		os.Exit(1)
	}
	for _, c := range strings.Split(env("TRUSTED_PROXIES", ""), ",") {
		if c = strings.TrimSpace(c); c == "" {
			continue
		}
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			slog.Error("invalid HLT_TRUSTED_PROXIES entry", "value", c)
			os.Exit(1)
		}
		cfg.TrustedProxies = append(cfg.TrustedProxies, n)
	}
	if err := run(cfg); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(cfg Config) error {
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return err
	}
	s := &Server{
		cfg:     cfg,
		limiter: newRateLimiter(10, time.Minute),
		agents:  map[int64]*agentConn{},
	}
	var err error
	if cfg.Role == RoleManagement {
		err = s.initManagement()
	} else {
		err = s.initMonitoring()
	}
	if err != nil {
		return err
	}
	defer s.db.Close()
	s.loadTimezone()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := s.initSetup(); err != nil {
		return err
	}
	if cfg.Role == RoleManagement {
		s.startManagement(ctx)
	} else {
		if err := s.initDevMode(ctx); err != nil {
			return err
		}
		go s.runMonitors(ctx)
		go s.watchHosts(ctx)
		go s.runReports(ctx)
	}
	go s.runRetention(ctx)
	go s.runReleaseCheck(ctx)

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()
	slog.Info("homelab-tools listening", "role", cfg.Role, "addr", cfg.Listen, "version", version)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	if s.notifier != nil {
		s.notifier.flush()
	}
	return nil
}

func (s *Server) initMonitoring() error {
	db, err := openDB(s.cfg.DataDir)
	if err != nil {
		return err
	}
	priv, err := loadOrCreateKey(s.cfg.DataDir)
	if err != nil {
		db.Close()
		return err
	}
	s.db, s.priv, s.pub = db, priv, priv.Public().(ed25519.PublicKey)
	s.notifier = newNotifier(s)
	return nil
}
