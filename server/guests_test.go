package main

import "testing"

func TestLinkAndPruneGuests(t *testing.T) {
	s, _ := newTestServer(t)
	add := func(name, info string) int64 {
		res, err := s.db.Exec(`INSERT INTO hosts(name,token_hash,created_at,info) VALUES(?,?,0,?)`, name, []byte(name), info)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	pve := add("pve", `{"hostname":"pve.lan","virtualization":"none"}`)
	ct := add("web", `{"hostname":"web","virtualization":"lxc","nics":[{"name":"eth0","mac":"BC:24:11:00:00:01"}]}`)
	vm := add("db", `{"hostname":"db","virtualization":"kvm","ips":[{"iface":"ens18","address":"10.0.0.5","prefix":24,"mac":"bc:24:11:00:00:02"}]}`)
	old := add("old", `{"hostname":"old","virtualization":"lxc","pve_node":"pve","pve_ctid":120}`)
	other := add("other", `{"hostname":"other","virtualization":"kvm"}`)
	if _, err := s.db.Exec(`UPDATE hosts SET pve=? WHERE id=?`,
		`{"guests":[{"id":101,"kind":"ct","macs":["bc:24:11:00:00:01"]},{"id":200,"kind":"vm","macs":["bc:24:11:00:00:02"]}]}`, pve); err != nil {
		t.Fatal(err)
	}
	// A parent chosen by hand stays.
	if _, err := s.db.Exec(`UPDATE hosts SET parent_id=?, parent_manual=1 WHERE id=?`, vm, other); err != nil {
		t.Fatal(err)
	}
	if err := s.linkGuests(); err != nil {
		t.Fatal(err)
	}
	want := map[int64][2]int64{ct: {pve, 101}, vm: {pve, 200}, old: {pve, 120}, other: {vm, 0}, pve: {0, 0}}
	for id, w := range want {
		var parent, vmid int64
		s.db.QueryRow(`SELECT COALESCE(parent_id,0), vmid FROM hosts WHERE id=?`, id).Scan(&parent, &vmid)
		if parent != w[0] || vmid != w[1] {
			t.Errorf("host %d: parent %d vmid %d, want %v", id, parent, vmid, w)
		}
	}
	if _, _, msg := s.parentFromRequest(pve, vm); msg == "" {
		t.Error("a node placed under its own guest must be refused")
	}

	// CT 120 was deleted from the cluster; 101 still exists; the VM is never pruned.
	s.pruneCTs(pve, "pve", nil)
	s.pruneCTs(pve, "pve", []int{101})
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM hosts`).Scan(&n)
	if n != 4 {
		t.Fatalf("%d hosts left, want 4", n)
	}
	if s.db.QueryRow(`SELECT COUNT(*) FROM hosts WHERE id=?`, old).Scan(&n); n != 0 {
		t.Error("the deleted CT's host is still there")
	}
}
