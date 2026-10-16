package main

// Database administration shared by both roles: disk usage, per-table size, clean-up,
// compaction and an optional size limit (setting db_max_mb). The limit is checked on the
// pages in use, so it holds without running VACUUM: freed pages are reused by SQLite.

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

func (s *Server) dbPath() string {
	if s.cfg.Role == RoleManagement {
		return filepath.Join(s.cfg.DataDir, "homelab.db")
	}
	return filepath.Join(s.cfg.DataDir, "hlm.db")
}

func (s *Server) dbFileSizes() (file, wal int64) {
	if fi, err := os.Stat(s.dbPath()); err == nil {
		file = fi.Size()
	}
	if fi, err := os.Stat(s.dbPath() + "-wal"); err == nil {
		wal = fi.Size()
	}
	return
}

// dbUsedBytes is the size of the pages holding data (file size minus free pages).
func (s *Server) dbUsedBytes() int64 {
	var pages, free, size int64
	s.db.QueryRow(`PRAGMA page_count`).Scan(&pages)
	s.db.QueryRow(`PRAGMA freelist_count`).Scan(&free)
	s.db.QueryRow(`PRAGMA page_size`).Scan(&size)
	return (pages - free) * size
}

func (s *Server) dbLimit() int64 {
	n, _ := strconv.ParseInt(s.getSetting("db_max_mb", "0"), 10, 64)
	return n << 20
}

// prunable lists the tables trimmed, oldest rows first, when the limit is exceeded,
// with the expression giving each row's age in unix seconds.
func (s *Server) prunable() []struct{ table, ts string } {
	activity := struct{ table, ts string }{"activity", "CAST(strftime('%s', created_at) AS INTEGER)"}
	if s.cfg.Role == RoleManagement {
		return []struct{ table, ts string }{activity}
	}
	return []struct{ table, ts string }{
		{"host_metrics", "ts"}, {"monitor_results", "ts/1000"}, activity,
	}
}

// enforceDBLimit deletes the oldest tenth of the history until the data fits the limit.
func (s *Server) enforceDBLimit() {
	limit := s.dbLimit()
	if limit <= 0 {
		return
	}
	now := time.Now().Unix()
	for range 20 {
		used := s.dbUsedBytes()
		if used <= limit {
			return
		}
		deleted := int64(0)
		for _, p := range s.prunable() {
			var oldest *int64
			if err := s.db.QueryRow(fmt.Sprintf(`SELECT MIN(%s) FROM %s`, p.ts, p.table)).Scan(&oldest); err != nil || oldest == nil {
				continue
			}
			cut := *oldest + max((now-*oldest)/10, 3600)
			res, err := s.db.Exec(fmt.Sprintf(`DELETE FROM %s WHERE %s < ?`, p.table, p.ts), cut)
			if err != nil {
				slog.Error("db limit", "table", p.table, "err", err)
				continue
			}
			n, _ := res.RowsAffected()
			deleted += n
		}
		if deleted == 0 {
			slog.Warn("database above its size limit with nothing left to trim", "used", used, "limit", limit)
			return
		}
		s.logEvent("système", "database", 0, "cleanup",
			fmt.Sprintf("Limite de taille atteinte : %d lignes d'historique les plus anciennes supprimées", deleted))
	}
}

type tableSize struct {
	Name  string `json:"name"`
	Rows  int64  `json:"rows"`
	Bytes int64  `json:"bytes"`
}

func (s *Server) handleDatabase(w http.ResponseWriter, r *http.Request) {
	file, wal := s.dbFileSizes()
	out := map[string]any{
		"path": s.dbPath(), "file_bytes": file, "wal_bytes": wal, "used_bytes": s.dbUsedBytes(),
		"limit_bytes": s.dbLimit(), "log_retention_days": logRetentionDays,
	}
	// dbstat gives the real size of each table and its indexes.
	sizes := map[string]int64{}
	if rows, err := s.db.Query(`SELECT m.tbl_name, SUM(d.pgsize) FROM dbstat d JOIN sqlite_master m ON m.name=d.name GROUP BY m.tbl_name`); err == nil {
		for rows.Next() {
			var n string
			var b int64
			if rows.Scan(&n, &b) == nil {
				sizes[n] = b
			}
		}
		rows.Close()
	}
	var names []string
	if rows, err := s.db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`); err == nil {
		for rows.Next() {
			var n string
			if rows.Scan(&n) == nil {
				names = append(names, n)
			}
		}
		rows.Close()
	}
	tables := []tableSize{}
	for _, n := range names {
		t := tableSize{Name: n, Bytes: sizes[n]}
		s.db.QueryRow(`SELECT COUNT(*) FROM "` + n + `"`).Scan(&t.Rows)
		tables = append(tables, t)
	}
	out["tables"] = tables
	var st syscall.Statfs_t
	if syscall.Statfs(s.cfg.DataDir, &st) == nil {
		out["disk_total_bytes"] = int64(st.Blocks) * int64(st.Bsize)
		out["disk_free_bytes"] = int64(st.Bavail) * int64(st.Bsize)
	}
	if s.cfg.Role == RoleManagement {
		out["uploads_bytes"] = dirSize(filepath.Join(s.cfg.DataDir, "uploads"))
	}
	writeJSON(w, 200, out)
}

func dirSize(dir string) int64 {
	var n int64
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if fi, err := e.Info(); err == nil && !e.IsDir() {
			n += fi.Size()
		}
	}
	return n
}

func (s *Server) handleDBCleanup(w http.ResponseWriter, r *http.Request) {
	s.cleanup()
	s.handleDatabase(w, r)
}

func (s *Server) handleDBVacuum(w http.ResponseWriter, r *http.Request) {
	s.cleanup()
	if _, err := s.db.Exec(`VACUUM`); err != nil {
		serverErr(w, err)
		return
	}
	s.handleDatabase(w, r)
}
