package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestNodeHookDeploysOnlyWithItsToken(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	_, created := do(t, ts, "POST", "/api/hosts", cookie, map[string]string{"name": "vm"})
	token := created["install"].(map[string]any)["token"].(string)
	nonce := make([]byte, 32)
	rand.Read(nonce)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/api/agent/ws", &websocket.DialOptions{HTTPHeader: http.Header{
		"Authorization": {"Bearer " + token}, "X-Agent-Nonce": {base64.StdEncoding.EncodeToString(nonce)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	var hello map[string]any
	wsjson.Read(ctx, c, &hello)
	s.storeNodeApps(1, "vm", &nodeSnapshot{Apps: []nodeApp{{Name: "site", AutoDeploy: true}, {Name: "manual"}}})

	_, out := do(t, ts, "GET", "/api/hosts/1/node-apps/site/hook", cookie, nil)
	url, _ := out["url"].(string)
	path := url[strings.Index(url, "/api/hooks/"):]
	if resp, _ := do(t, ts, "GET", "/api/hosts/1/node-apps/site/hook", "", nil); resp.StatusCode != 401 {
		t.Fatalf("the URL is a secret, got %d", resp.StatusCode)
	}
	for _, bad := range []string{path[:len(path)-1] + "x", strings.Replace(path, "/site/", "/manual/", 1), strings.Replace(path, "/1/", "/2/", 1)} {
		if resp, _ := do(t, ts, "POST", bad, "", nil); resp.StatusCode != 404 {
			t.Fatalf("%s accepted: %d", bad, resp.StatusCode)
		}
	}
	resp, got := do(t, ts, "POST", path, "", nil)
	if resp.StatusCode != 202 || got["state"] != "started" {
		t.Fatalf("hook: %d %v", resp.StatusCode, got)
	}
	var m map[string]string
	if err := wsjson.Read(ctx, c, &m); err != nil || m["action"] != "node_pull" || m["target"] != "site" {
		t.Fatalf("agent received %v %v", m, err)
	}
	if _, got := do(t, ts, "POST", path, "", nil); got["state"] != "busy" {
		t.Fatalf("a push during an action is left to the timer: %v", got)
	}
	_, out = do(t, ts, "GET", "/api/hosts/1/node-apps/manual/hook", cookie, nil)
	manual := out["url"].(string)
	if _, got := do(t, ts, "POST", manual[strings.Index(manual, "/api/hooks/"):], "", nil); got["state"] != "auto_deploy_off" {
		t.Fatalf("auto deploy is off for this app: %v", got)
	}
}

func TestNodeAppAlertsAndReads(t *testing.T) {
	s, _ := newTestServer(t)
	s.setSetting("notify_window_s", "3600")
	res, _ := s.db.Exec(`INSERT INTO hosts(name,token_hash,created_at) VALUES('vm',x'03',0)`)
	id, _ := res.LastInsertId()
	snap := func(status string, last string) *nodeSnapshot {
		return &nodeSnapshot{Apps: []nodeApp{
			{Name: "site", Status: status, History: []nodeOp{{ID: "20261023-141502-deploy", Result: last}}},
			{Name: "api", Status: "online"},
		}}
	}
	for range 3 { // collected every 30 s: still one alert
		s.storeNodeApps(id, "vm", snap("errored", "success"))
	}
	if k := pendingKinds(s)[KindNodeApp]; k != 1 {
		t.Fatalf("expected one alert, got %d", k)
	}
	s.storeNodeApps(id, "vm", snap("online", "rolled_back")) // another problem: alert again
	h, _ := s.loadHosts("WHERE id=?", id)
	if k := pendingKinds(s)[KindNodeApp]; k != 2 || h[0].NodeApps.Online != 2 || h[0].NodeApps.Failing != 1 {
		t.Fatalf("alerts %d, snapshot %+v", k, h[0].NodeApps)
	}

	// An answer reaches the read of its own host only.
	w := nodeReadWait{host: id, ch: make(chan nodeReadResult, 1)}
	nodeReads.m["r1"] = w
	deliverNodeRead(id+1, &nodeReadResult{ID: "r1", OK: true})
	deliverNodeRead(id, &nodeReadResult{ID: "r1", OK: true, Text: "ok"})
	if r := <-w.ch; r.Text != "ok" {
		t.Fatalf("got %+v", r)
	}
	delete(nodeReads.m, "r1")

	for _, bad := range []string{"", "Site", "-x", "a/b", "a b"} {
		if nodeAppName.MatchString(bad) {
			t.Fatalf("%q accepted", bad)
		}
	}
	if !nodeOpID.MatchString("20261023-141502-auto-deploy") || nodeOpID.MatchString("../x") {
		t.Fatal("operation id rule")
	}
}

func TestNodeCreateAndHostType(t *testing.T) {
	ok := nodeCreate{Name: "site", Source: "git@github.com:moi/site.git", Branch: "main", Port: 3000}
	if p := ok.problem(); p != "" {
		t.Fatal(p)
	}
	for _, bad := range []nodeCreate{
		{Name: "site", Source: "/root"}, // a path on the server: refused
		{Name: "site", Source: "https://x/r.git", Branch: "--upload-pack=x"},
		{Name: "site", Source: "https://x/r.git", Start: "a\nb"},
		{Name: "Site", Source: "https://x/r.git"},
	} {
		if bad.problem() == "" {
			t.Fatalf("%+v accepted", bad)
		}
	}

	for _, c := range []struct {
		manual, declared, virt, want string
		pve                          bool
	}{
		{"", "", "none", "physical", false},
		{"", "", "none", "proxmox", true},
		{"", "", "kvm", "vm", false},
		{"", "vps", "kvm", "vps", false},
		{"physical", "vps", "kvm", "physical", false},
		{"", "bogus", "lxc", "lxc", false},
	} {
		if got := hostType(c.manual, c.declared, c.pve, c.virt); got != c.want {
			t.Fatalf("%+v: got %s", c, got)
		}
	}
	if !reconfigureRe.MatchString("HOST_TYPE=vm SMART=false AUTO_UPDATE=true LXC=keep") ||
		reconfigureRe.MatchString("HOST_TYPE=vm SMART=false AUTO_UPDATE=true LXC=keep TOKEN=enr_x") ||
		reconfigureRe.MatchString("HOST_TYPE=vm REPO=x SMART=false AUTO_UPDATE=true LXC=keep") {
		t.Fatal("reconfigure options")
	}
	if assetKind("vps", "kvm") != "vm" || assetKind("proxmox", "") != "physical" || assetKind("", "lxc") != "lxc" {
		t.Fatal("inventory kind")
	}

	s, _ := newTestServer(t)
	res, _ := s.db.Exec(`INSERT INTO hosts(name,token_hash,created_at,info) VALUES('vm',x'04',0,'{"virtualization":"kvm","host_type":"vps"}')`)
	id, _ := res.LastInsertId()
	if h, _ := s.loadHosts("WHERE id=?", id); h[0].HostType != "vps" || h[0].HostTypeManual {
		t.Fatalf("declared type: %+v", h[0])
	}
	s.db.Exec(`UPDATE hosts SET host_type='physical' WHERE id=?`, id)
	if h, _ := s.loadHosts("WHERE id=?", id); h[0].HostType != "physical" || !h[0].HostTypeManual {
		t.Fatalf("manual type: %+v", h[0])
	}
}
