package main

// Server updates. The release check runs every 6 hours (and on demand); applying an update
// depends on how the server was installed (HLT_INSTALL):
//   - deb: the button writes the wanted release tag to a request file; a root systemd path
//     unit shipped by the package (homelab-tools-update.path) downloads that release's .deb
//     from GitHub, checks its SHA-256 and installs it. The server itself never runs as root.
//   - docker: the image is updated by Docker (docker compose pull && docker compose up -d), or
//     by the button when a Watchtower with its HTTP API runs beside the server
//     (HLT_WATCHTOWER_URL and HLT_WATCHTOWER_TOKEN): Watchtower pulls the image and recreates
//     the container, so the server never touches the Docker socket.
//   - lxc-oci: the image run as a Proxmox LXC container (no Docker daemon); the settings page
//     only lists the manual steps, since Proxmox recreates the CT from the new image.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

var releaseTag = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)

var releaseCheckNow = make(chan struct{}, 1)

// dockerPending is the tag Watchtower was asked to install; the restarted process starts empty.
var dockerPending atomic.Value

func (s *Server) checkRelease(ctx context.Context) {
	client := &http.Client{Timeout: 20 * time.Second}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/"+repo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	var rel struct {
		Tag string `json:"tag_name"`
	}
	if resp.StatusCode == 200 && json.NewDecoder(resp.Body).Decode(&rel) == nil && releaseTag.MatchString(rel.Tag) {
		agentRelease.Lock()
		agentRelease.tag = rel.Tag
		agentRelease.checked = time.Now()
		agentRelease.Unlock()
	}
}

func (s *Server) runReleaseCheck(ctx context.Context) {
	for {
		s.checkRelease(ctx)
		select {
		case <-ctx.Done():
			return
		case <-releaseCheckNow:
		case <-time.After(6 * time.Hour):
		}
	}
}

func updateRequestPath() string {
	return env("UPDATE_REQUEST", "/var/lib/homelab-tools/update/request")
}

func (s *Server) updateState() map[string]any {
	latest := latestAgentVersion()
	agentRelease.Lock()
	checked := agentRelease.checked
	agentRelease.Unlock()
	out := map[string]any{
		"current": version, "latest": latest, "available": latest != "" && versionLess(version, latest),
		"install": s.cfg.Install, "checked_at": checked.Unix(), "repo": repo,
	}
	if checked.IsZero() {
		out["checked_at"] = 0
	}
	if b, err := os.ReadFile(updateRequestPath()); err == nil && s.cfg.Install == "deb" {
		out["pending"] = strings.TrimSpace(string(b))
	}
	if s.cfg.Install == "docker" {
		out["docker_auto"] = watchtowerURL() != ""
		if p, _ := dockerPending.Load().(string); p != "" {
			out["pending"] = p
		}
	}
	return out
}

func (s *Server) handleUpdateState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.updateState())
}

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	s.checkRelease(ctx)
	writeJSON(w, 200, s.updateState())
}

func watchtowerURL() string { return strings.TrimRight(env("WATCHTOWER_URL", ""), "/") }

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	docker := s.cfg.Install == "docker" && watchtowerURL() != ""
	if s.cfg.Install != "deb" && !docker {
		writeErr(w, 409, "Mise à jour depuis l'interface réservée au paquet .deb ou à Docker avec Watchtower (sinon : docker compose pull)")
		return
	}
	tag := latestAgentVersion()
	if !releaseTag.MatchString(tag) || !versionLess(version, tag) {
		writeErr(w, 409, "Aucune mise à jour disponible")
		return
	}
	if docker {
		if !dockerPending.CompareAndSwap(nil, tag) && !dockerPending.CompareAndSwap("", tag) {
			writeErr(w, 409, "Mise à jour déjà en cours")
			return
		}
		// Watchtower answers once the container is recreated, which ends this process: don't wait.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()
			req, _ := http.NewRequestWithContext(ctx, "POST", watchtowerURL()+"/v1/update", nil)
			req.Header.Set("Authorization", "Bearer "+env("WATCHTOWER_TOKEN", ""))
			resp, err := http.DefaultClient.Do(req)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode >= 300 {
					err = fmt.Errorf("Watchtower a répondu %s", resp.Status)
				}
			}
			if err != nil {
				slog.Error("docker update", "err", err)
			}
			dockerPending.Store("") // still running after the call: nothing was replaced
		}()
		logName(r, version+" → "+tag)
		writeJSON(w, 200, s.updateState())
		return
	}
	p := updateRequestPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o770); err != nil {
		serverErr(w, err)
		return
	}
	if err := os.WriteFile(p, []byte(tag+"\n"), 0o660); err != nil {
		serverErr(w, err)
		return
	}
	logName(r, version+" → "+tag)
	writeJSON(w, 200, s.updateState())
}
