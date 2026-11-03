package main

// Node.js apps of the hosts deployed with the base-node playbook (its node-app command),
// reported by agents: see agent/src/node.rs and agent/node-app-helper.sh. Deploys, restarts…
// are host actions (node_*); logs, variables, deploy keys and app creation go through the agent
// on demand (askNode), like node-app-ui's API: secrets are answered to the user, never stored.

import (
	"cmp"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket/wsjson"
)

// Same rules as node-app and node-app-ui.
var (
	nodeAppName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,99}$`)
	nodeOpID    = regexp.MustCompile(`^[0-9]{8}-[0-9]{6}-[a-z-]{1,30}$`)
)

type nodeOp struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"` // deploy, auto-deploy, update
	Commit   string `json:"commit"`
	Started  int64  `json:"started"`
	Finished *int64 `json:"finished"`
	Result   string `json:"result"` // running, success, failed, rolled_back
}

// Wire format shared with agent/src/node.rs (App). Never the app's variables (.env).
type nodeApp struct {
	Name             string   `json:"name"`
	Port             int      `json:"port"`
	Status           string   `json:"status"` // PM2: online, stopped, errored, launching, stopping
	Restarts         int      `json:"restarts"`
	MemoryMB         float64  `json:"memory_mb"`
	FailedCommit     string   `json:"failed_commit"`
	Source           string   `json:"source"` // git or local
	Repo             string   `json:"repo"`   // token masked by the helper
	Branch           string   `json:"branch"`
	StartCommand     string   `json:"start_command"`
	MigrateCommand   string   `json:"migrate_command"`
	AutoDeploy       bool     `json:"auto_deploy"`
	AutoUpdate       bool     `json:"auto_update"`
	DeployedCommit   string   `json:"deployed_commit"`
	DeployKey        string   `json:"deploy_key"`
	ManagedByAnsible bool     `json:"managed_by_ansible"`
	History          []nodeOp `json:"history"` // most recent first
}

type nodeKey struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"` // shared or app (deploy key)
	Type        string `json:"type"`
	Comment     string `json:"comment"`
	Fingerprint string `json:"fingerprint"`
	Created     int64  `json:"created"`
	PublicKey   string `json:"public_key"`
}

type nodeSnapshot struct {
	Apps        []nodeApp `json:"apps"`
	SSHKeys     []nodeKey `json:"ssh_keys"`
	UIPort      int       `json:"ui_port"` // node-app-ui, 0 when not installed
	Actions     bool      `json:"actions"` // NODE_APPS_ACTIONS: the action helper is installed
	Error       string    `json:"error,omitempty"`
	CollectedAt int64     `json:"collected_at"`
	// Computed by the hub.
	Online  int `json:"online"`
	Failing int `json:"failing"`
	// Problems already e-mailed (reported once).
	Alerted []string `json:"alerted,omitempty"`
}

// nodeProblem explains why an app needs attention, "" when it is fine.
func nodeProblem(a nodeApp) string {
	switch {
	case a.Status == "errored":
		return "en erreur"
	case a.FailedCommit != "":
		return "échec du déploiement de " + a.FailedCommit
	case len(a.History) > 0 && a.History[0].Result == "failed":
		return "dernière opération en échec"
	case len(a.History) > 0 && a.History[0].Result == "rolled_back":
		return "dernière opération annulée (retour arrière)"
	}
	return ""
}

func (s *Server) storeNodeApps(id int64, hostName string, d *nodeSnapshot) error {
	d.Apps, d.SSHKeys = capped(d.Apps, 200), capped(d.SSHKeys, 100)
	d.Online, d.Failing = 0, 0
	var problems, fresh []string
	var prev nodeSnapshot
	var raw string
	if s.db.QueryRow(`SELECT node_apps FROM hosts WHERE id=?`, id).Scan(&raw) == nil {
		json.Unmarshal([]byte(raw), &prev)
	}
	known := map[string]bool{}
	for _, k := range prev.Alerted {
		known[k] = true
	}
	for i := range d.Apps {
		a := &d.Apps[i]
		a.Name, a.Status, a.FailedCommit = clip(a.Name, 100), clip(a.Status, 20), clip(a.FailedCommit, 40)
		a.Source, a.Repo, a.Branch = clip(a.Source, 10), clip(a.Repo, 500), clip(a.Branch, 200)
		a.StartCommand, a.MigrateCommand = clip(a.StartCommand, 500), clip(a.MigrateCommand, 500)
		a.DeployedCommit, a.DeployKey = clip(a.DeployedCommit, 40), clip(a.DeployKey, 1000)
		a.History = capped(a.History, 20)
		for j := range a.History {
			o := &a.History[j]
			o.ID, o.Kind, o.Commit, o.Result = clip(o.ID, 60), clip(o.Kind, 20), clip(o.Commit, 40), clip(o.Result, 20)
		}
		if a.Status == "online" {
			d.Online++
		}
		if p := nodeProblem(*a); p != "" {
			d.Failing++
			k := a.Name + " : " + p
			problems = append(problems, k)
			if !known[k] {
				fresh = append(fresh, k)
			}
		}
	}
	for i := range d.SSHKeys {
		k := &d.SSHKeys[i]
		k.ID, k.Name, k.Kind, k.Type = clip(k.ID, 110), clip(k.Name, 100), clip(k.Kind, 10), clip(k.Type, 40)
		k.Comment, k.Fingerprint, k.PublicKey = clip(k.Comment, 200), clip(k.Fingerprint, 100), clip(k.PublicKey, 1000)
	}
	d.Error = clip(d.Error, 500)
	d.Alerted = problems
	if len(fresh) > 0 && s.getSetting("notify_node_apps", "true") == "true" {
		s.notifier.add(Event{Kind: KindNodeApp, Name: hostName, Message: strings.Join(fresh, " ; "), At: time.Now()})
	}
	d.CollectedAt = time.Now().Unix()
	b, _ := json.Marshal(d)
	_, err := s.db.Exec(`UPDATE hosts SET node_apps=? WHERE id=?`, string(b), id)
	return err
}

/* ---------- Reads on demand (logs, operation logs) ---------- */

type nodeReadResult struct {
	ID        string  `json:"id"`
	OK        bool    `json:"ok"`
	Text      string  `json:"text"`
	Offset    int64   `json:"offset"`    // oplog: where to read from next time
	Operation *nodeOp `json:"operation"` // oplog: the operation's latest history entry
	Error     string  `json:"error,omitempty"`
}

// Reads waiting for their agent's answer, by request id.
var nodeReads = struct {
	sync.Mutex
	m map[string]nodeReadWait
}{m: map[string]nodeReadWait{}}

type nodeReadWait struct {
	host int64
	ch   chan nodeReadResult
}

// deliverNodeRead hands an agent's answer to the request waiting for it, from that host only.
func deliverNodeRead(host int64, res *nodeReadResult) {
	nodeReads.Lock()
	w, ok := nodeReads.m[res.ID]
	nodeReads.Unlock()
	if ok && w.host == host {
		select {
		case w.ch <- *res:
		default:
		}
	}
}

func (s *Server) nodeRead(w http.ResponseWriter, r *http.Request, id int64, args ...string) {
	if res, ok := s.askNode(w, r, id, "", 45*time.Second, args...); ok {
		writeJSON(w, 200, res)
	}
}

// askNode sends one request to the host's root helper, with an optional payload, and waits for
// its answer; on failure it has already written the HTTP error.
func (s *Server) askNode(w http.ResponseWriter, r *http.Request, id int64, payload string, wait time.Duration, args ...string) (nodeReadResult, bool) {
	s.agentsMu.Lock()
	conn := s.agents[id]
	s.agentsMu.Unlock()
	if conn == nil {
		writeErr(w, 409, "L'agent n'est pas connecté")
		return nodeReadResult{}, false
	}
	req := nodeReadWait{host: id, ch: make(chan nodeReadResult, 1)}
	rid := randHex(16)
	nodeReads.Lock()
	nodeReads.m[rid] = req
	nodeReads.Unlock()
	defer func() {
		nodeReads.Lock()
		delete(nodeReads.m, rid)
		nodeReads.Unlock()
	}()
	msg := map[string]any{"type": "node_read", "id": rid, "args": args}
	if payload != "" {
		msg["payload"] = payload
	}
	ctx, cancel := context.WithTimeout(conn.ctx, 10*time.Second)
	err := wsjson.Write(ctx, conn.conn, msg)
	cancel()
	if err != nil {
		writeErr(w, 502, "Impossible de joindre l'agent : "+err.Error())
		return nodeReadResult{}, false
	}
	select {
	case res := <-req.ch:
		if !res.OK {
			writeErr(w, 502, cmp.Or(res.Error, "Lecture impossible sur l'hôte"))
			return nodeReadResult{}, false
		}
		return res, true
	case <-time.After(wait):
		writeErr(w, 504, "L'agent n'a pas répondu (agent trop ancien, helper non installé, ou connexion coupée ?)")
	case <-r.Context().Done():
	}
	return nodeReadResult{}, false
}

func nodeAppParam(w http.ResponseWriter, r *http.Request) (int64, string, bool) {
	id, ok := pathID(w, r)
	if !ok {
		return 0, "", false
	}
	app := r.PathValue("app")
	if !nodeAppName.MatchString(app) {
		writeErr(w, 400, "Nom d'application invalide")
		return 0, "", false
	}
	return id, app, true
}

// GET /api/hosts/{id}/node-apps/{app}/logs?lines=200: the app's PM2 logs.
func (s *Server) handleNodeLogs(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	lines, err := strconv.Atoi(r.URL.Query().Get("lines"))
	if err != nil {
		lines = 200
	}
	s.nodeRead(w, r, id, "logs", app, strconv.Itoa(min(max(lines, 10), 2000)))
}

// GET /api/hosts/{id}/node-apps/{app}/operations/{op}?offset=0: an operation's log from offset.
func (s *Server) handleNodeOplog(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	op := r.PathValue("op")
	offset, err := strconv.ParseInt(cmp.Or(r.URL.Query().Get("offset"), "0"), 10, 64)
	if !nodeOpID.MatchString(op) || err != nil || offset < 0 || offset > 1<<40 {
		writeErr(w, 400, "Opération ou position invalide")
		return
	}
	s.nodeRead(w, r, id, "oplog", app, op, fmt.Sprint(offset))
}

/* ---------- Variables, deploy keys and creation (node-app-ui's API, through the agent) ---------- */

// GET /api/hosts/{id}/node-apps/{app}/env: the raw .env file (comments included).
func (s *Server) handleNodeEnv(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	if res, ok := s.askNode(w, r, id, "", 45*time.Second, "env", app); ok {
		writeJSON(w, 200, map[string]string{"text": res.Text})
	}
}

// PUT /api/hosts/{id}/node-apps/{app}/env {text}: replaces the variables, then restarts the app.
func (s *Server) handleNodeSetEnv(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if !readJSONLimit(w, r, &req, 256<<10) {
		return
	}
	logName(r, app+" (variables)")
	if res, ok := s.askNode(w, r, id, req.Text, 5*time.Minute, "setenv", app); ok {
		writeJSON(w, 200, map[string]string{"output": res.Text})
	}
}

// POST /api/hosts/{id}/node-apps/{app}/key {regenerate?, private_key?}: the app's deploy key,
// created if needed (before the app itself too), replaced, or imported.
func (s *Server) handleNodeKey(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	var req struct {
		Regenerate bool   `json:"regenerate"`
		PrivateKey string `json:"private_key"`
	}
	if !readJSONLimit(w, r, &req, 64<<10) {
		return
	}
	verb, payload := "key", ""
	switch {
	case strings.TrimSpace(req.PrivateKey) != "":
		verb, payload = "importkey", req.PrivateKey
		logName(r, app+" (clé SSH importée)")
	case req.Regenerate:
		verb = "newkey"
		logName(r, app+" (nouvelle clé SSH)")
	default:
		logName(r, app+" (clé SSH)")
	}
	if res, ok := s.askNode(w, r, id, payload, time.Minute, verb, app); ok {
		writeJSON(w, 200, map[string]string{"key": strings.TrimSpace(res.Text)})
	}
}

// nodeCreate is POST /api/apps of node-app-ui; the host's helper checks it again.
type nodeCreate struct {
	Name       string `json:"name"`
	Source     string `json:"source"`
	Branch     string `json:"branch,omitempty"`
	Port       int    `json:"port,omitempty"`
	Preset     string `json:"preset,omitempty"`
	Start      string `json:"start,omitempty"`
	Migrate    string `json:"migrate,omitempty"`
	Env        string `json:"env,omitempty"`
	EnvMerge   string `json:"env_merge,omitempty"`
	PrivateKey string `json:"private_key,omitempty"`
	AutoDeploy *bool  `json:"auto_deploy,omitempty"`
	AutoUpdate *bool  `json:"auto_update,omitempty"`
}

var nodeGitURL = regexp.MustCompile(`^(https?://|ssh://|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)\S{1,490}$`)

func (c nodeCreate) problem() string {
	switch {
	case !nodeAppName.MatchString(c.Name):
		return "Nom invalide (minuscules, chiffres, - et _)"
	case !nodeGitURL.MatchString(c.Source):
		return "Source invalide : URL git attendue (https://… ou git@hôte:compte/dépôt.git)"
	case c.Port < 0 || c.Port > 65535:
		return "Port invalide"
	case len(c.Branch) > 200 || strings.HasPrefix(c.Branch, "-"):
		return "Branche ou tag invalide"
	case len(c.Start) > 500 || len(c.Migrate) > 500 || strings.ContainsAny(c.Start+c.Migrate, "\r\n"):
		return "Commande invalide"
	case c.EnvMerge != "" && c.EnvMerge != "saisie" && c.EnvMerge != "code":
		return "Fusion des variables invalide"
	}
	return ""
}

// POST /api/hosts/{id}/node-apps: records the app (clone, detection) then deploys it in the
// background. 201 {warnings}, 409 {need_key, error} when the deploy key must be added first.
func (s *Server) handleNodeCreate(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req nodeCreate
	if !readJSONLimit(w, r, &req, 256<<10) {
		return
	}
	req.Source, req.Branch = strings.TrimSpace(req.Source), strings.TrimSpace(req.Branch)
	if msg := req.problem(); msg != "" {
		writeErr(w, 400, msg)
		return
	}
	logName(r, req.Name)
	b, _ := json.Marshal(req)
	res, ok := s.askNode(w, r, id, string(b), 10*time.Minute, "create", req.Name)
	if !ok {
		return
	}
	var out struct {
		Warnings string `json:"warnings"`
		NeedKey  string `json:"need_key"`
	}
	json.Unmarshal([]byte(res.Text), &out)
	if out.NeedKey != "" {
		logSkip(r) // nothing created yet
		writeJSON(w, 409, map[string]string{"need_key": out.NeedKey, "error": "Ajoutez la deploy key au dépôt, puis réessayez."})
		return
	}
	writeJSON(w, 201, map[string]string{"warnings": out.Warnings})
}

/* ---------- Pause page and git push ---------- */

// The page's fields are checked on the host, by node-app: the JSON only passes through here.
func pauseConfig(w http.ResponseWriter, r *http.Request) (string, bool) {
	var raw json.RawMessage
	if !readJSONLimit(w, r, &raw, 256<<10) {
		return "", false
	}
	return string(raw), true
}

// GET /api/hosts/{id}/node-apps/{app}/pause: the page's last configuration.
func (s *Server) handleNodePauseShow(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	if res, ok := s.askNode(w, r, id, "", 45*time.Second, "pauseshow", app); ok {
		if !json.Valid([]byte(res.Text)) {
			res.Text = "{}"
		}
		writeJSON(w, 200, json.RawMessage(res.Text))
	}
}

// PUT /api/hosts/{id}/node-apps/{app}/pause {page}: pauses the app, or changes the page of a paused one.
func (s *Server) handleNodePause(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	cfg, ok := pauseConfig(w, r)
	if !ok {
		return
	}
	logName(r, app)
	if res, ok := s.askNode(w, r, id, cfg, 2*time.Minute+15*time.Second, "pause", app); ok {
		writeJSON(w, 200, map[string]string{"output": res.Text})
	}
}

// POST /api/hosts/{id}/node-apps/{app}/resume: the app runs again, on its latest deployed version.
func (s *Server) handleNodeResume(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	logName(r, app)
	if res, ok := s.askNode(w, r, id, "", 2*time.Minute+15*time.Second, "resume", app); ok {
		writeJSON(w, 200, map[string]string{"output": res.Text})
	}
}

// POST /api/hosts/{id}/node-apps/{app}/pause/preview {page}: the page as the host renders it, changing nothing.
func (s *Server) handleNodePausePreview(w http.ResponseWriter, r *http.Request) {
	id, _, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	cfg, ok := pauseConfig(w, r)
	if !ok {
		return
	}
	if res, ok := s.askNode(w, r, id, cfg, 45*time.Second, "pausepreview"); ok {
		writeJSON(w, 200, map[string]string{"html": res.Text})
	}
}

// nodeHookToken is derived from the hub's key: nothing to store.
// shortcut: no rotation, a leaked URL only makes the host look for a new commit; add a per-app salt if that ever matters.
func (s *Server) nodeHookToken(id int64, app string) string {
	m := hmac.New(sha256.New, s.priv.Seed())
	fmt.Fprintf(m, "node-hook|%d|%s", id, app)
	return hex.EncodeToString(m.Sum(nil))[:40]
}

// GET /api/hosts/{id}/node-apps/{app}/hook: the webhook URL to give to the git forge.
func (s *Server) handleNodeHookURL(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	writeJSON(w, 200, map[string]string{"url": fmt.Sprintf("%s/api/hooks/node/%d/%s/%s", s.baseURL(r), id, app, s.nodeHookToken(id, app))})
}

// POST /api/hooks/node/{id}/{app}/{token}: deploys the app's new commit, if any, right after a push.
// Same as node_pull: a push on another branch finds nothing new, so the payload is not read, and
// any git forge works. A push that arrives during an action is picked up by the host's timer.
func (s *Server) handleNodeHook(w http.ResponseWriter, r *http.Request) {
	id, app, ok := nodeAppParam(w, r)
	if !ok {
		return
	}
	if !hmac.Equal([]byte(r.PathValue("token")), []byte(s.nodeHookToken(id, app))) {
		writeErr(w, 404, "Introuvable")
		return
	}
	logName(r, app)
	hosts, err := s.loadHosts("WHERE id=?", id)
	if err != nil {
		serverErr(w, err)
		return
	}
	enabled := false
	if len(hosts) == 1 && hosts[0].NodeApps != nil {
		for _, a := range hosts[0].NodeApps.Apps {
			enabled = enabled || (a.Name == app && a.AutoDeploy)
		}
	}
	state := "started"
	switch {
	case !enabled:
		state = "auto_deploy_off"
	case actionBusy(hosts[0].Action):
		state = "busy"
	default:
		if err := s.agentSend(id, map[string]string{"type": "action", "action": "node_pull", "target": app}); err != nil {
			state = "agent_offline"
		} else {
			s.setHostActionTarget(id, "node_pull", app, "pending", "")
		}
	}
	if state != "started" {
		logSkip(r)
	}
	writeJSON(w, 202, map[string]string{"state": state})
}
