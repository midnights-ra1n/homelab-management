package main

// Deployments and tasks (port of lib/data/{deployments,tasks}.ts and their actions).

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
)

var (
	deploymentKinds    = []string{"physical", "vm", "lxc", "docker", "application", "other"}
	deploymentStatuses = []string{"planned", "preparing", "in_progress", "testing", "blocked", "done", "cancelled"}
	activeDeployments  = []string{"planned", "preparing", "in_progress", "testing", "blocked"}
	deploymentLabels   = map[string]string{"planned": "Planifié", "preparing": "Préparation", "in_progress": "En cours",
		"testing": "Tests", "blocked": "Bloqué", "done": "Terminé", "cancelled": "Annulé"}
	priorities   = []string{"low", "medium", "high", "critical"}
	taskStatuses = []string{"todo", "in_progress", "done"}
)

const deploymentSelect = `
  SELECT d.*, h.display_name AS target_host_name, a.display_name AS asset_name,
    s.name AS subnet_name, s.cidr AS subnet_cidr,
    (SELECT COUNT(*) FROM deployment_steps st WHERE st.deployment_id = d.id) AS steps_total,
    (SELECT COUNT(*) FROM deployment_steps st WHERE st.deployment_id = d.id AND st.done = 1) AS steps_done
  FROM deployments d
  LEFT JOIN assets h ON h.id = d.target_host_id
  LEFT JOIN assets a ON a.id = d.asset_id
  LEFT JOIN subnets s ON s.id = d.subnet_id`

const deploymentOrder = ` ORDER BY
  CASE d.status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'testing' THEN 2 WHEN 'preparing' THEN 3
    WHEN 'planned' THEN 4 WHEN 'done' THEN 5 ELSE 6 END,
  CASE d.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  COALESCE(d.target_date, '9999'), d.id DESC`

func inList(col string, values []string) (string, []any) {
	args := make([]any, len(values))
	for i, v := range values {
		args[i] = v
	}
	return col + " IN (" + strings.TrimSuffix(strings.Repeat("?,", len(values)), ",") + ")", args
}

func (s *Server) mgListDeployments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var where []string
	var args []any
	switch st := q.Get("status"); {
	case st == "active":
		c, a := inList("d.status", activeDeployments)
		where, args = append(where, c), append(args, a...)
	case slices.Contains(deploymentStatuses, st):
		where, args = append(where, "d.status = ?"), append(args, st)
	}
	if k := q.Get("kind"); k != "" {
		where, args = append(where, "d.kind = ?"), append(args, k)
	}
	if v := q.Get("asset"); v != "" {
		where, args = append(where, "(d.asset_id = ? OR d.target_host_id = ?)"), append(args, v, v)
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		like := "%" + clip(v, 100) + "%"
		where, args = append(where, "(d.title LIKE ? OR d.description LIKE ? OR d.tags LIKE ?)"), append(args, like, like, like)
	}
	sqlq := deploymentSelect
	if len(where) > 0 {
		sqlq += " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := s.rows(sqlq+deploymentOrder, args...)
	writeRows(w, rows, err)
}

func (s *Server) mgDeployment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := s.row(deploymentSelect+" WHERE d.id = ?", id)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "Déploiement introuvable")
		return
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if d["steps"], err = s.rows(`SELECT id, label, done, position FROM deployment_steps WHERE deployment_id = ? ORDER BY position, id`, id); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, d)
}

// mgWorkOptions: choices of the deployment and task forms, and the counters of the dashboard.
func (s *Server) mgWorkOptions(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{}
	today := time.Now().In(localTZ()).Format("2006-01-02")
	for k, q := range map[string]struct {
		q    string
		args []any
	}{
		"deployments":       {`SELECT id, title FROM deployments WHERE status NOT IN ('done','cancelled') ORDER BY title`, nil},
		"deployment_counts": {`SELECT status, COUNT(*) AS n FROM deployments GROUP BY status`, nil},
		"task_tags":         {`SELECT DISTINCT value AS tag FROM tasks, json_each(tasks.tags) ORDER BY value`, nil},
		"task_counts": {`SELECT COALESCE(SUM(status = 'todo'), 0) AS todo, COALESCE(SUM(status = 'in_progress'), 0) AS in_progress,
		   COALESCE(SUM(status = 'done'), 0) AS done,
		   COALESCE(SUM(status != 'done' AND due_date IS NOT NULL AND due_date < ?), 0) AS overdue FROM tasks`, []any{today}},
		"open_tasks": {taskSelect + ` WHERE t.status != 'done' ORDER BY
		   CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date,
		   CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 8`, nil},
	} {
		rows, err := s.rows(q.q, q.args...)
		if err != nil {
			serverErr(w, err)
			return
		}
		out[k] = rows
	}
	writeJSON(w, 200, out)
}

type stepIn struct {
	Label string `json:"label"`
	Done  bool   `json:"done"`
}

func deploymentForm(f *form) (map[string]any, []stepIn) {
	var steps []stepIn
	f.jsonArray("steps", &steps)
	for i := range steps {
		steps[i].Label = strings.TrimSpace(steps[i].Label)
		if steps[i].Label == "" || len([]rune(steps[i].Label)) > 300 {
			f.fail("steps", "Étape invalide (1 à 300 caractères)")
		}
	}
	if len(steps) > 64 {
		f.fail("steps", "64 étapes maximum")
	}
	return map[string]any{
		"title": f.required("title", "Le titre", 160), "kind": f.enum("kind", deploymentKinds...),
		"status": f.enum("status", deploymentStatuses...), "priority": f.enum("priority", priorities...),
		"description": f.text("description", 5000), "target_host_id": f.optID("target_host_id"), "asset_id": f.optID("asset_id"),
		"planned_cpu": f.optNum("planned_cpu", true, 1, 1024), "planned_ram_gb": f.optNum("planned_ram_gb", false, 0, 65536),
		"planned_disk_gb": f.optNum("planned_disk_gb", false, 0, 10_000_000), "planned_ip": f.optIP("planned_ip"),
		"subnet_id": f.optID("subnet_id"), "target_date": f.optDate("target_date"), "notes": f.text("notes", 10000),
		"tags": f.tags("tags"), "vmid": f.optNum("vmid", true, 1, 999999999), "apps": f.text("apps", 2000),
		"local_fqdn": f.text("local_fqdn", 253), "public_fqdn": f.text("public_fqdn", 253),
	}, steps
}

func (s *Server) mgSaveDeployment(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	cols, steps := deploymentForm(f)
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	var summary, action string
	if id > 0 {
		var before string
		if err := tx.QueryRow(`SELECT status FROM deployments WHERE id = ?`, id).Scan(&before); err != nil {
			writeErr(w, 404, "Déploiement introuvable")
			return
		}
		if err := s.updateRow(tx, "deployments", id, cols); err != nil {
			serverErr(w, err)
			return
		}
		tx.Exec(`UPDATE deployments SET completed_at = CASE WHEN status = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END WHERE id = ?`, id)
		action, summary = "update", fmt.Sprintf("Modification du déploiement « %s »", cols["title"])
		if before != cols["status"] {
			summary = fmt.Sprintf("« %s » → %s", cols["title"], deploymentLabels[cols["status"].(string)])
		}
	} else {
		if id, err = s.insertRow(tx, "deployments", cols); err != nil {
			serverErr(w, err)
			return
		}
		tx.Exec(`UPDATE deployments SET completed_at = datetime('now') WHERE id = ? AND status = 'done'`, id)
		action, summary = "create", fmt.Sprintf("Nouveau déploiement « %s »", cols["title"])
	}
	if _, err := tx.Exec(`DELETE FROM deployment_steps WHERE deployment_id = ?`, id); err != nil {
		serverErr(w, err)
		return
	}
	for i, st := range steps {
		if _, err := tx.Exec(`INSERT INTO deployment_steps (deployment_id, label, done, position) VALUES (?, ?, ?, ?)`, id, st.Label, st.Done, i); err != nil {
			serverErr(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.mgLog(r, "deployment", id, action, summary)
	formRedirect(w, fmt.Sprintf("/deploiements/%d", id), id)
}

func (s *Server) mgSetDeploymentStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !slices.Contains(deploymentStatuses, in.Status) {
		writeErr(w, 400, "État invalide")
		return
	}
	var title string
	if err := s.db.QueryRow(`SELECT title FROM deployments WHERE id = ?`, id).Scan(&title); err != nil {
		writeErr(w, 404, "Déploiement introuvable")
		return
	}
	if _, err := s.db.Exec(`UPDATE deployments SET status = ?, updated_at = datetime('now'),
	   completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END WHERE id = ?`, in.Status, in.Status, id); err != nil {
		serverErr(w, err)
		return
	}
	s.mgLog(r, "deployment", id, "update", fmt.Sprintf("« %s » → %s", title, deploymentLabels[in.Status]))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) mgAddStep(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Label string `json:"label"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	logSkip(r)
	label := clip(strings.TrimSpace(in.Label), 300)
	if label == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if _, err := s.db.Exec(`INSERT INTO deployment_steps (deployment_id, label, position)
	   VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM deployment_steps WHERE deployment_id = ?))`, id, label, id); err != nil {
		serverErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) mgToggleStep(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	logSkip(r)
	s.db.Exec(`UPDATE deployment_steps SET done = 1 - done WHERE id = ?`, id)
	s.db.Exec(`UPDATE deployments SET updated_at = datetime('now') WHERE id = (SELECT deployment_id FROM deployment_steps WHERE id = ?)`, id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) mgDeleteStep(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	logSkip(r)
	s.db.Exec(`DELETE FROM deployment_steps WHERE id = ?`, id)
	w.WriteHeader(http.StatusNoContent)
}

var slugRe = regexp.MustCompile(`[^a-z0-9.-]+`)

// mgPromoteDeployment creates the inventory item of a deployment and links them.
func (s *Server) mgPromoteDeployment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	d, err := s.row(`SELECT * FROM deployments WHERE id = ?`, id)
	if err != nil {
		writeErr(w, 404, "Déploiement introuvable")
		return
	}
	if d["asset_id"] != nil {
		formRedirect(w, fmt.Sprintf("/inventaire/%d", d["asset_id"]), d["asset_id"].(int64))
		return
	}
	kind := d["kind"].(string)
	if kind == "application" {
		kind = "docker"
	}
	title := clip(d["title"].(string), 120)
	status := "planned"
	if d["status"] == "done" {
		status = "online"
	}
	tags, _ := json.Marshal(d["tags"])
	cols := map[string]any{
		"kind": kind, "display_name": title, "hostname": strings.Trim(slugRe.ReplaceAllString(strings.ToLower(title), "-"), "-"),
		"status": status, "tags": string(tags), "parent_id": d["target_host_id"], "cpu_cores": d["planned_cpu"],
		"ram_gb": d["planned_ram_gb"], "description": d["description"], "disks": "[]",
	}
	if v, ok := d["vmid"].(int64); ok && v >= 100 && (kind == "vm" || kind == "lxc") {
		cols["proxmox_vmid"] = v
	}
	if apps, _ := d["apps"].(string); apps != "" {
		cols["notes"] = "Conteneurs / apps : " + apps
	}
	if gb, ok := d["planned_disk_gb"].(float64); ok {
		b, _ := json.Marshal([]map[string]any{{"name": "disk0", "type": "virtual", "capacity_gb": gb, "usage": ""}})
		cols["disks"] = string(b)
	} else if gb, ok := d["planned_disk_gb"].(int64); ok {
		b, _ := json.Marshal([]map[string]any{{"name": "disk0", "type": "virtual", "capacity_gb": gb, "usage": ""}})
		cols["disks"] = string(b)
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	assetID, err := s.insertRow(tx, "assets", cols)
	if err != nil {
		serverErr(w, err)
		return
	}
	if ip, _ := d["planned_ip"].(string); ip != "" {
		// Address already taken: the item is created without it.
		in := assetInput{primaryIP: ip, primarySubnet: d["subnet_id"]}
		tx.Exec(`SAVEPOINT ip`)
		if s.syncPrimaryIP(tx, assetID, in, cols["hostname"].(string)) != nil {
			tx.Exec(`ROLLBACK TO ip`)
		}
		tx.Exec(`RELEASE ip`)
	}
	tx.Exec(`UPDATE deployments SET asset_id = ?, updated_at = datetime('now') WHERE id = ?`, assetID, id)
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.mgLog(r, "asset", assetID, "create", "Ajout de « "+title+" » à l'inventaire")
	formRedirect(w, fmt.Sprintf("/inventaire/%d", assetID), assetID)
}

/* ------------------------------------------------------------------ tasks */

const taskSelect = `
  SELECT t.*, a.display_name AS asset_name, d.title AS deployment_title
  FROM tasks t
  LEFT JOIN assets a ON a.id = t.asset_id
  LEFT JOIN deployments d ON d.id = t.deployment_id`

func (s *Server) mgListTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var where []string
	var args []any
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		like := "%" + clip(v, 100) + "%"
		where, args = append(where, "(t.title LIKE ? OR t.description LIKE ?)"), append(args, like, like)
	}
	if v := q.Get("tag"); v != "" {
		where, args = append(where, "EXISTS (SELECT 1 FROM json_each(t.tags) WHERE value = ?)"), append(args, v)
	}
	if v := intParam(r, "asset"); v > 0 {
		where, args = append(where, "t.asset_id = ?"), append(args, v)
	}
	if v := intParam(r, "deployment"); v > 0 {
		where, args = append(where, "t.deployment_id = ?"), append(args, v)
	}
	sqlq := taskSelect
	if len(where) > 0 {
		sqlq += " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := s.rows(sqlq+` ORDER BY t.position,
	  CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
	  COALESCE(t.due_date, '9999'), t.id DESC`, args...)
	writeRows(w, rows, err)
}

func (s *Server) mgSaveTask(w http.ResponseWriter, r *http.Request) {
	id, ok := optPathID(w, r)
	if !ok {
		return
	}
	f, ok := parseForm(w, r)
	if !ok {
		return
	}
	cols := map[string]any{
		"title": f.required("title", "Le titre", 200), "description": f.text("description", 5000),
		"status": f.enum("status", taskStatuses...), "priority": f.enum("priority", priorities...),
		"due_date": f.optDate("due_date"), "tags": f.tags("tags"), "asset_id": f.optID("asset_id"),
		"deployment_id": f.optID("deployment_id"),
	}
	if !f.valid() {
		formInvalid(w, f)
		return
	}
	var err error
	if id > 0 {
		if err = s.updateRow(s.db, "tasks", id, cols); err == nil {
			s.db.Exec(`UPDATE tasks SET completed_at = CASE WHEN status = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END WHERE id = ?`, id)
			s.mgLog(r, "task", id, "update", fmt.Sprintf("Modification de la tâche « %s »", cols["title"]))
		}
	} else {
		var pos int64
		s.db.QueryRow(`SELECT COALESCE(MIN(position), 0) - 1 FROM tasks WHERE status = ?`, cols["status"]).Scan(&pos)
		cols["position"] = pos
		if id, err = s.insertRow(s.db, "tasks", cols); err == nil {
			s.db.Exec(`UPDATE tasks SET completed_at = datetime('now') WHERE id = ? AND status = 'done'`, id)
			s.mgLog(r, "task", id, "create", fmt.Sprintf("Nouvelle tâche « %s »", cols["title"]))
		}
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if r.PathValue("id") != "" {
		formOK(w, "Tâche mise à jour.")
	} else {
		formOK(w, "Tâche créée.")
	}
}

// mgMoveTask moves a task (drag and drop) to a column, before `before` (null = at the end).
func (s *Server) mgMoveTask(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Status string `json:"status"`
		Before *int64 `json:"before"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !slices.Contains(taskStatuses, in.Status) {
		writeErr(w, 400, "Colonne invalide")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	var prevStatus, title string
	if err := tx.QueryRow(`SELECT status, title FROM tasks WHERE id = ?`, id).Scan(&prevStatus, &title); err != nil {
		writeErr(w, 404, "Tâche introuvable")
		return
	}
	rows, err := tx.Query(`SELECT id FROM tasks WHERE status = ? AND id != ? ORDER BY position, id`, in.Status, id)
	if err != nil {
		serverErr(w, err)
		return
	}
	var ids []int64
	for rows.Next() {
		var t int64
		rows.Scan(&t)
		ids = append(ids, t)
	}
	rows.Close()
	at := len(ids)
	if in.Before != nil {
		if i := slices.Index(ids, *in.Before); i >= 0 {
			at = i
		}
	}
	ids = slices.Insert(ids, at, id)
	for pos, t := range ids {
		tx.Exec(`UPDATE tasks SET position = ? WHERE id = ?`, pos, t)
	}
	tx.Exec(`UPDATE tasks SET status = ?, updated_at = datetime('now'),
	   completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END WHERE id = ?`, in.Status, in.Status, id)
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	if prevStatus != in.Status && in.Status == "done" {
		s.mgLog(r, "task", id, "update", "Tâche terminée : « "+title+" »")
	} else {
		logSkip(r)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) mgClearDoneTasks(w http.ResponseWriter, r *http.Request) {
	res, err := s.db.Exec(`DELETE FROM tasks WHERE status = 'done'`)
	if err != nil {
		serverErr(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		s.mgLog(r, "task", 0, "delete", fmt.Sprintf("%d tâche(s) terminée(s) archivée(s)", n))
	} else {
		logSkip(r)
	}
	w.WriteHeader(http.StatusNoContent)
}
