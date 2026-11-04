package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// benchServer seeds a large homelab: every host reports Docker, Node.js apps and pending updates.
func benchServer(b *testing.B, hosts, monitors int) *Server {
	b.Helper()
	dir := b.TempDir()
	db, err := openDB(dir)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { db.Close() })
	s := &Server{cfg: Config{DataDir: dir, Role: RoleMonitoring}, db: db, key: make([]byte, 32), agents: map[int64]*agentConn{}}
	now := time.Now().Unix()
	disks := []map[string]any{}
	for i := range 6 {
		disks = append(disks, map[string]any{"mount": fmt.Sprintf("/mnt/%d", i), "fs": "ext4", "used": 1 << 34, "total": 1 << 36})
	}
	latest, _ := json.Marshal(map[string]any{"cpu": 12.5, "mem_used": 1 << 32, "mem_total": 1 << 34, "disks": disks})
	containers := []map[string]any{}
	for i := range 12 {
		containers = append(containers, map[string]any{"id": fmt.Sprint("c", i), "name": fmt.Sprint("service-", i), "image": "ghcr.io/acme/app:latest", "state": "running"})
	}
	docker, _ := json.Marshal(map[string]any{"collected_at": now, "containers": containers})
	history := []map[string]any{}
	for i := range 20 {
		history = append(history, map[string]any{"id": fmt.Sprint(i), "kind": "deploy", "started": now, "result": "success", "commit": "a3f9c1e"})
	}
	nodeApps, _ := json.Marshal(map[string]any{"collected_at": now, "apps": []map[string]any{{"name": "site", "status": "online", "history": history}, {"name": "api", "status": "online", "history": history}}})
	pkgs := []map[string]any{}
	for i := range 80 {
		pkgs = append(pkgs, map[string]any{"name": fmt.Sprint("libfoo", i), "candidate": "1.2.3-4"})
	}
	updates, _ := json.Marshal(map[string]any{"checked_at": now, "pending": 80, "packages": pkgs})
	info, _ := json.Marshal(map[string]any{"hostname": "h", "os": "Debian 13", "agent_version": "v0.1.12"})
	for i := range hosts {
		res, err := db.Exec(`INSERT INTO hosts(name,token_hash,info,updates,node_apps,created_at) VALUES(?,?,?,?,?,?)`, fmt.Sprint("host-", i), []byte(fmt.Sprint("t", i)), string(info), string(updates), string(nodeApps), now)
		if err != nil {
			b.Fatal(err)
		}
		id, _ := res.LastInsertId()
		if _, err := db.Exec(`INSERT INTO host_live(host_id,latest,docker,last_seen) VALUES(?,?,?,?)`, id, string(latest), string(docker), now); err != nil {
			b.Fatal(err)
		}
		s.agents[id] = &agentConn{}
	}
	for i := range monitors {
		res, err := db.Exec(`INSERT INTO monitors(name,type,target,interval_s,timeout_s,status,created_at) VALUES(?,?,?,60,5,'operational',?)`, fmt.Sprint("mon-", i), "http", "https://example.org", now)
		if err != nil {
			b.Fatal(err)
		}
		id, _ := res.LastInsertId()
		tx, _ := db.Begin()
		for m := range 1440 {
			tx.Exec(`INSERT INTO monitor_results(monitor_id,ts,status,latency_ms) VALUES(?,?,'operational',12.5)`, id, time.Now().Add(-time.Duration(m)*time.Minute).UnixMilli())
		}
		for d := range 90 {
			tx.Exec(`INSERT INTO monitor_daily(monitor_id,day,total,up,worst) VALUES(?,?,1440,1440,0)`, id, (now/86400-int64(d))*86400)
		}
		tx.Commit()
	}
	return s
}

func BenchmarkLoadHosts(b *testing.B) {
	s := benchServer(b, 40, 0)
	for b.Loop() {
		if _, err := s.loadHosts(""); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkOverview(b *testing.B) {
	s := benchServer(b, 40, 30)
	req := httptest.NewRequest(http.MethodGet, "/api/overview", nil)
	for b.Loop() {
		w := httptest.NewRecorder()
		s.handleOverview(w, req)
		if w.Code != 200 {
			b.Fatal(w.Code, w.Body.String())
		}
		b.SetBytes(int64(w.Body.Len()))
	}
}

func BenchmarkListHosts(b *testing.B) {
	s := benchServer(b, 40, 0)
	req := httptest.NewRequest(http.MethodGet, "/api/hosts", nil)
	for b.Loop() {
		w := httptest.NewRecorder()
		s.handleListHosts(w, req)
		b.SetBytes(int64(w.Body.Len()))
	}
}

func BenchmarkStoreMetrics(b *testing.B) {
	s := benchServer(b, 1, 0)
	m := &agentMetrics{CPU: 12, MemUsed: 1, MemTotal: 2}
	for b.Loop() {
		if err := s.storeMetrics(1, m); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkOverviewCached(b *testing.B) {
	s := benchServer(b, 40, 30)
	h := cacheJSON(3*time.Second, s.handleOverview)
	req := httptest.NewRequest(http.MethodGet, "/api/overview", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	for b.Loop() {
		w := httptest.NewRecorder()
		h(w, req)
		b.SetBytes(int64(w.Body.Len()))
	}
}
