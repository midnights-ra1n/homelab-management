package main

import "testing"

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
