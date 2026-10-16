package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"database/sql"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Each entry runs once, in order; never edit a released entry, append a new one.
var migrations = []string{
	`CREATE TABLE users(
		id INTEGER PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at INTEGER NOT NULL);
	CREATE TABLE sessions(
		token_hash BLOB PRIMARY KEY,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		expires_at INTEGER NOT NULL);
	CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
	CREATE TABLE hosts(
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		token_hash BLOB UNIQUE NOT NULL,
		info TEXT NOT NULL DEFAULT '{}',
		latest TEXT NOT NULL DEFAULT '{}',
		last_seen INTEGER NOT NULL DEFAULT 0,
		maintenance INTEGER NOT NULL DEFAULT 0,
		public INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL);
	CREATE TABLE host_metrics(
		host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
		ts INTEGER NOT NULL,
		cpu REAL, mem_used INTEGER, mem_total INTEGER, swap_used INTEGER, swap_total INTEGER,
		disk_used INTEGER, disk_total INTEGER, net_rx REAL, net_tx REAL, load1 REAL, temp REAL,
		PRIMARY KEY(host_id, ts)) WITHOUT ROWID;
	CREATE TABLE monitors(
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		target TEXT NOT NULL,
		interval_s INTEGER NOT NULL,
		timeout_s INTEGER NOT NULL,
		config TEXT NOT NULL DEFAULT '{}',
		enabled INTEGER NOT NULL DEFAULT 1,
		maintenance INTEGER NOT NULL DEFAULT 0,
		public INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'unknown',
		message TEXT NOT NULL DEFAULT '',
		latency_ms REAL,
		last_check INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL);
	CREATE TABLE monitor_results(
		monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
		ts INTEGER NOT NULL,
		status TEXT NOT NULL,
		latency_ms REAL,
		message TEXT NOT NULL DEFAULT '',
		PRIMARY KEY(monitor_id, ts)) WITHOUT ROWID;
	CREATE TABLE monitor_daily(
		monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
		day INTEGER NOT NULL,
		total INTEGER NOT NULL,
		up INTEGER NOT NULL,
		worst INTEGER NOT NULL,
		PRIMARY KEY(monitor_id, day)) WITHOUT ROWID;`,
	`ALTER TABLE monitors ADD COLUMN cert_expires_at INTEGER;
	ALTER TABLE monitors ADD COLUMN cert_alerted_for INTEGER NOT NULL DEFAULT 0;`,
	`ALTER TABLE hosts ADD COLUMN updates TEXT NOT NULL DEFAULT '{}';`,
	`CREATE TABLE api_tokens(
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		token_hash BLOB UNIQUE NOT NULL,
		prefix TEXT NOT NULL,
		scopes TEXT NOT NULL,
		expires_at INTEGER,
		created_at INTEGER NOT NULL,
		last_used_at INTEGER NOT NULL DEFAULT 0);
	ALTER TABLE hosts ADD COLUMN smart TEXT NOT NULL DEFAULT '{}';
	ALTER TABLE monitor_daily ADD COLUMN latency_sum REAL NOT NULL DEFAULT 0;
	ALTER TABLE monitor_daily ADD COLUMN latency_n INTEGER NOT NULL DEFAULT 0;
	CREATE TABLE host_daily(
		host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
		day INTEGER NOT NULL,
		samples INTEGER NOT NULL,
		cpu_sum REAL NOT NULL,
		mem_sum REAL NOT NULL,
		PRIMARY KEY(host_id, day)) WITHOUT ROWID;`,
	`CREATE TABLE enroll_tokens(
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		token_hash BLOB UNIQUE NOT NULL,
		prefix TEXT NOT NULL,
		expires_at INTEGER,
		created_at INTEGER NOT NULL,
		last_used_at INTEGER NOT NULL DEFAULT 0,
		uses INTEGER NOT NULL DEFAULT 0);`,
	`ALTER TABLE hosts ADD COLUMN action TEXT NOT NULL DEFAULT '{}';`,
	`ALTER TABLE host_metrics ADD COLUMN cpu_temp REAL;
	ALTER TABLE hosts ADD COLUMN docker TEXT NOT NULL DEFAULT '{}';`,
	`ALTER TABLE monitor_results ADD COLUMN value REAL;
	ALTER TABLE monitor_daily ADD COLUMN energy_wh REAL NOT NULL DEFAULT 0;`,
	activityTable,
	passkeysTable,
	`ALTER TABLE monitors ADD COLUMN category TEXT NOT NULL DEFAULT '';`,
}

// activityTable is the journal shared by both roles (same shape as homelab-management's
// "activity" table, plus the actor), kept for logRetentionDays.
const activityTable = `CREATE TABLE IF NOT EXISTS activity (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	entity_type TEXT NOT NULL,
	entity_id   INTEGER,
	action      TEXT NOT NULL,
	summary     TEXT NOT NULL,
	created_at  TEXT NOT NULL DEFAULT (datetime('now')));
	CREATE INDEX IF NOT EXISTS activity_created ON activity(created_at DESC);
	ALTER TABLE activity ADD COLUMN actor TEXT NOT NULL DEFAULT '';`

func openDB(dir string) (*sql.DB, error) {
	return openSQLite(filepath.Join(dir, "hlm.db"), migrations)
}

// openSQLite migrates with foreign keys off (rebuilding a table must not cascade), then
// reopens with them on. The pragmas keep SQLite light: WAL, NORMAL sync, small cache.
func openSQLite(path string, migs []string) (*sql.DB, error) {
	const base = "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)" +
		"&_pragma=cache_size(-4000)&_pragma=temp_store(MEMORY)&_pragma=journal_size_limit(8388608)"
	db, err := sql.Open("sqlite", "file:"+path+base)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	err = migrate(db, migs)
	db.Close()
	if err != nil {
		return nil, err
	}
	if db, err = sql.Open("sqlite", "file:"+path+base+"&_pragma=foreign_keys(1)"); err != nil {
		return nil, err
	}
	// One connection: SQLite serialises writes anyway and this avoids SQLITE_BUSY entirely.
	db.SetMaxOpenConns(1)
	os.Chmod(path, 0o600)
	return db, nil
}

func migrate(db *sql.DB, migs []string) error {
	var v int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	for i := v; i < len(migs); i++ {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migs[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		var bad int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_check`).Scan(&bad); err != nil || bad > 0 {
			tx.Rollback()
			return fmt.Errorf("migration %d: %d invalid foreign keys (%v)", i+1, bad, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// loadOrCreateKey returns the hub's ed25519 key. Agents pin its public half and
// refuse any hub that cannot sign their connection challenge with it.
func loadOrCreateKey(dir string) (ed25519.PrivateKey, error) {
	path := filepath.Join(dir, "hub_ed25519.pem")
	if b, err := os.ReadFile(path); err == nil {
		blk, _ := pem.Decode(b)
		if blk == nil {
			return nil, errors.New("invalid hub key file")
		}
		k, err := x509.ParsePKCS8PrivateKey(blk.Bytes)
		if err != nil {
			return nil, err
		}
		pk, ok := k.(ed25519.PrivateKey)
		if !ok {
			return nil, errors.New("hub key is not ed25519")
		}
		return pk, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	_, pk, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(pk)
	if err != nil {
		return nil, err
	}
	b := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	if err := os.WriteFile(path, b, 0o600); err != nil {
		return nil, err
	}
	return pk, nil
}

func (s *Server) getSetting(k, def string) string {
	var v string
	if err := s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, k).Scan(&v); err != nil {
		return def
	}
	return v
}

func (s *Server) setSetting(k, v string) error {
	_, err := s.db.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v)
	return err
}
