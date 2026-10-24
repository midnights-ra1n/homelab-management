package main

// Node.js apps of the hosts deployed with the base-node playbook (its node-app command),
// reported by agents: see agent/src/node.rs and agent/node-app-helper.sh. Deploys, restarts…
// are host actions (node_*); logs are read on demand through the agent (nodeRead).

import (
	"cmp"
	"context"
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
	s.agentsMu.Lock()
	conn := s.agents[id]
	s.agentsMu.Unlock()
	if conn == nil {
		writeErr(w, 409, "L'agent n'est pas connecté")
		return
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
	ctx, cancel := context.WithTimeout(conn.ctx, 10*time.Second)
	err := wsjson.Write(ctx, conn.conn, map[string]any{"type": "node_read", "id": rid, "args": args})
	cancel()
	if err != nil {
		writeErr(w, 502, "Impossible de joindre l'agent : "+err.Error())
		return
	}
	select {
	case res := <-req.ch:
		if !res.OK {
			writeErr(w, 502, cmp.Or(res.Error, "Lecture impossible sur l'hôte"))
			return
		}
		writeJSON(w, 200, res)
	case <-time.After(45 * time.Second):
		writeErr(w, 504, "L'agent n'a pas répondu (agent trop ancien, ou applications Node.js non installées ?)")
	case <-r.Context().Done():
	}
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
