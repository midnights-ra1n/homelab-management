package main

// JSON backup / restore of the management data (format of homelab-management, so its
// backups restore here), plus the counters of the settings page.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// backupTables are saved in insertion order (dependencies first).
var backupTables = []string{"settings", "vlans", "subnets", "integrations", "ssh_keys", "assets", "hardware_items", "ip_addresses",
	"deployments", "deployment_steps", "tasks", "shortcut_groups", "shortcuts", "uploaded_icons", "map_positions",
	"map_links", "vpn_tunnels", "firewall_rules", "domains", "update_reminders", "activity"}

type backupDoc struct {
	App        string                      `json:"app"`
	Version    int                         `json:"version"`
	ExportedAt string                      `json:"exported_at"`
	Secrets    bool                        `json:"secrets"`
	Tables     map[string][]map[string]any `json:"tables"`
	Files      map[string]string           `json:"files"`
}

func (s *Server) mgExport(w http.ResponseWriter, r *http.Request) {
	secrets := r.URL.Query().Get("secrets") == "1"
	doc := backupDoc{App: "homelab-management", Version: 1, ExportedAt: time.Now().UTC().Format(time.RFC3339), Secrets: secrets,
		Tables: map[string][]map[string]any{}, Files: map[string]string{}}
	for _, t := range backupTables {
		// JSON columns stay as stored text, as homelab-management exported them.
		rows, err := s.scanRows(false, `SELECT * FROM `+t)
		if err != nil {
			serverErr(w, err)
			return
		}
		doc.Tables[t] = rows
	}
	for _, row := range doc.Tables["integrations"] {
		row["config"] = ""
		if secrets {
			if list, err := s.loadIntegrations(`WHERE id = ?`, row["id"]); err == nil && len(list) == 1 {
				row["config"] = list[0].Config
			}
		}
	}
	for _, row := range doc.Tables["ssh_keys"] {
		plain := ""
		if secrets {
			plain, _ = s.decrypt(fmtVal(row["private_key"]))
		}
		row["private_key"] = plain
	}
	for _, icon := range doc.Tables["uploaded_icons"] {
		name := filepath.Base(fmtVal(icon["filename"]))
		if b, err := os.ReadFile(filepath.Join(s.mg.uploads, name)); err == nil {
			doc.Files[name] = base64.StdEncoding.EncodeToString(b)
		}
	}
	s.mgLog(r, "system", 0, "export", map[bool]string{true: "Export de la sauvegarde (avec secrets)", false: "Export de la sauvegarde"}[secrets])
	w.Header().Set("Content-Disposition", `attachment; filename="homelab-backup-`+time.Now().Format("2006-01-02")+`.json"`)
	writeJSON(w, 200, doc)
}

func (s *Server) mgImport(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 128<<20)
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		formFail(w, "file", "Fichier trop volumineux ou illisible")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		formFail(w, "file", "Choisis un fichier .json")
		return
	}
	defer file.Close()
	if r.PostFormValue("confirm") != "on" {
		formFail(w, "", "Coche la confirmation pour remplacer les données.")
		return
	}
	var doc backupDoc
	if err := json.NewDecoder(io.LimitReader(file, 128<<20)).Decode(&doc); err != nil || doc.App != "homelab-management" || doc.Version != 1 || doc.Tables == nil {
		formFail(w, "", "Import impossible : fichier de sauvegarde invalide")
		return
	}
	if err := s.importBackup(r.Context(), &doc); err != nil {
		formFail(w, "", "Import impossible : "+err.Error())
		return
	}
	for name, b64 := range doc.Files {
		if b, err := base64.StdEncoding.DecodeString(b64); err == nil {
			os.WriteFile(filepath.Join(s.mg.uploads, filepath.Base(name)), b, 0o600)
		}
	}
	s.mgLog(r, "system", 0, "update", "Restauration d'une sauvegarde")
	formOK(w, "Sauvegarde restaurée.")
}

func (s *Server) importBackup(ctx context.Context, doc *backupDoc) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	// Foreign keys off while the tables are emptied and refilled in dependency order.
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), `PRAGMA foreign_keys = ON`)
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, t := range slices.Backward(backupTables) {
		if _, err := tx.Exec(`DELETE FROM ` + t); err != nil {
			return err
		}
	}
	for _, t := range backupTables {
		// Column names come from the current schema, never from the file's keys.
		cols := map[string]bool{}
		rs, err := tx.Query(`SELECT name FROM pragma_table_info(?)`, t)
		if err != nil {
			return err
		}
		for rs.Next() {
			var n string
			rs.Scan(&n)
			cols[n] = true
		}
		rs.Close()
		for _, row := range doc.Tables[t] {
			if t == "integrations" {
				if !slices.Contains(integrationTypes, fmtVal(row["type"])) {
					continue // Beszel, Maintenant and PatchMon are gone
				}
				switch c := row["config"].(type) {
				case map[string]any:
					b, _ := json.Marshal(c)
					row["config"] = s.encrypt(string(b))
				case string:
					if !strings.HasPrefix(c, "v1.") {
						row["config"] = s.encrypt("{}")
					}
				default:
					row["config"] = s.encrypt("{}")
				}
			}
			if t == "ssh_keys" {
				k := fmtVal(row["private_key"])
				if k == "" {
					continue // backup without secrets: the key is unusable
				}
				if !strings.HasPrefix(k, "v1.") {
					row["private_key"] = s.encrypt(k)
				}
			}
			var keys []string
			var args []any
			for _, k := range sortedKeys(row) {
				if !cols[k] {
					continue
				}
				v := row[k]
				if m, ok := v.(map[string]any); ok {
					b, _ := json.Marshal(m)
					v = string(b)
				} else if l, ok := v.([]any); ok {
					b, _ := json.Marshal(l)
					v = string(b)
				}
				keys, args = append(keys, k), append(args, v)
			}
			if len(keys) == 0 {
				continue
			}
			if _, err := tx.Exec(`INSERT INTO `+t+` (`+strings.Join(keys, ",")+`) VALUES (`+strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")+`)`, args...); err != nil {
				return err
			}
		}
	}
	// Emptying tasks queued their Nextcloud copies for deletion: the restored tasks keep them.
	if _, err := tx.Exec(`DELETE FROM caldav_deleted`); err != nil {
		return err
	}
	// Backups made before the homelab ID existed.
	if _, err := tx.Exec(`UPDATE hardware_items SET hl_id = printf('HL-%04d', id) WHERE hl_id = ''`); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Server) mgStats(w http.ResponseWriter, r *http.Request) {
	row, err := s.row(`SELECT (SELECT COUNT(*) FROM assets) AS assets, (SELECT COUNT(*) FROM ip_addresses) AS ips,
	   (SELECT COUNT(*) FROM deployments) AS deployments, (SELECT COUNT(*) FROM tasks) AS tasks,
	   (SELECT COUNT(*) FROM shortcuts) AS shortcuts, (SELECT MAX(updated_at) FROM assets) AS last_asset_update`)
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, row)
}
