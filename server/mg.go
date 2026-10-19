package main

// Management role: homelab-management ported from Next.js. The database is homelab.db, the
// same file and schema as before, so an existing installation is picked up by copying its
// data directory (homelab.db, secret.key, uploads/).

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type mgState struct {
	uploads string

	vncMu sync.Mutex
	vnc   map[string]vncSession

	iconsMu sync.Mutex
	icons   []iconEntry
	iconsAt time.Time

	statusMu   sync.Mutex
	statusBusy bool
}

var mgSettingDefs = map[string]string{
	"timezone":          defaultTimezone,
	"db_max_mb":         "0",
	"fw_default_policy": "allow",
	// Inventory items are created / updated from the hosts of the Midnights Monitoring integrations.
	"inventory_sync": "true",
}

func (s *Server) initManagement() error {
	uploads := filepath.Join(s.cfg.DataDir, "uploads")
	if err := os.MkdirAll(uploads, 0o700); err != nil {
		return err
	}
	key, err := loadSecretKey(s.cfg.DataDir)
	if err != nil {
		return err
	}
	db, err := openSQLite(filepath.Join(s.cfg.DataDir, "homelab.db"), mgMigrations)
	if err != nil {
		return err
	}
	s.db = db
	s.key = key
	s.mg = &mgState{uploads: uploads, vnc: map[string]vncSession{}}
	return nil
}

func (s *Server) startManagement(ctx context.Context) {
	go s.runAssetStatus(ctx)
	go s.runInventorySync(ctx)
}

// loadSecretKey returns sha256(APP_SECRET or DATA_DIR/secret.key), as homelab-management did.
func loadSecretKey(dir string) ([]byte, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		path := filepath.Join(dir, "secret.key")
		b, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) || (err == nil && strings.TrimSpace(string(b)) == "") {
			buf := make([]byte, 32)
			rand.Read(buf)
			b = []byte(hex.EncodeToString(buf))
			if err := os.WriteFile(path, b, 0o600); err != nil {
				return nil, err
			}
		} else if err != nil {
			return nil, err
		}
		secret = strings.TrimSpace(string(b))
	}
	k := sha256.Sum256([]byte(secret))
	return k[:], nil
}

// encrypt / decrypt use homelab-management's format: v1.<iv>.<tag>.<data>, base64 parts.
func (s *Server) encrypt(plain string) string {
	block, _ := aes.NewCipher(s.key)
	gcm, _ := cipher.NewGCM(block)
	iv := make([]byte, 12)
	rand.Read(iv)
	sealed := gcm.Seal(nil, iv, []byte(plain), nil)
	data, tag := sealed[:len(sealed)-16], sealed[len(sealed)-16:]
	enc := base64.StdEncoding.EncodeToString
	return strings.Join([]string{"v1", enc(iv), enc(tag), enc(data)}, ".")
}

func (s *Server) decrypt(payload string) (string, error) {
	p := strings.Split(payload, ".")
	if len(p) != 4 || p[0] != "v1" {
		return "", errors.New("format de secret inconnu")
	}
	dec := base64.StdEncoding.DecodeString
	iv, err1 := dec(p[1])
	tag, err2 := dec(p[2])
	data, err3 := dec(p[3])
	if err := errors.Join(err1, err2, err3); err != nil || len(iv) != 12 {
		return "", errors.New("secret illisible")
	}
	block, _ := aes.NewCipher(s.key)
	gcm, _ := cipher.NewGCM(block)
	out, err := gcm.Open(nil, iv, append(data, tag...), nil)
	if err != nil {
		return "", errors.New("secret illisible (clé de chiffrement différente ?)")
	}
	return string(out), nil
}

// monitoringURL is the address of the first Midnights Monitoring integration, for the
// management UI's shortcut to the monitoring dashboard.
func (s *Server) monitoringURL() string {
	if s.cfg.Role != RoleManagement {
		return ""
	}
	var u string
	s.db.QueryRow(`SELECT url FROM integrations WHERE type='hlm' AND enabled=1 ORDER BY id LIMIT 1`).Scan(&u)
	return u
}

func (s *Server) handleMgSettings(w http.ResponseWriter, r *http.Request) {
	file, wal := s.dbFileSizes()
	writeJSON(w, 200, map[string]any{"settings": s.allSettings(), "db_size": file + wal, "version": version})
}
