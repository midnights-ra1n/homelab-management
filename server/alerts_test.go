package main

import (
	"strings"
	"testing"
	"time"
)

func pendingKinds(s *Server) map[string]int {
	s.notifier.mu.Lock()
	defer s.notifier.mu.Unlock()
	out := map[string]int{}
	for _, e := range s.notifier.pending {
		out[e.Kind]++
	}
	return out
}

func TestUpdateAlertsAreSentOnce(t *testing.T) {
	s, _ := newTestServer(t)
	s.setSetting("notify_window_s", "3600")
	res, _ := s.db.Exec(`INSERT INTO hosts(name,token_hash,created_at) VALUES('pve',x'02',0)`)
	id, _ := res.LastInsertId()
	ssl := agentPackage{Name: "libssl3", Current: "1", Candidate: "2", Security: true}
	tz := agentPackage{Name: "tzdata", Current: "a", Candidate: "b"}
	for i := 0; i < 3; i++ { // the agent rescans every 6 hours: still one alert
		s.storeUpdates(id, "pve", &agentUpdates{Packages: []agentPackage{ssl, tz}, RebootRequired: true})
	}
	if k := pendingKinds(s); k[KindUpdates] != 1 || k[KindReboot] != 1 {
		t.Fatalf("expected one security and one reboot alert, got %v", k)
	}
	ssh := agentPackage{Name: "openssh-server", Current: "1", Candidate: "2", Security: true}
	s.storeUpdates(id, "pve", &agentUpdates{Packages: []agentPackage{ssl, ssh}, RebootRequired: true})
	if k := pendingKinds(s); k[KindUpdates] != 2 || k[KindReboot] != 1 {
		t.Fatalf("a new security update must alert again (only it), got %v", k)
	}
	s.notifier.mu.Lock()
	last := s.notifier.pending[len(s.notifier.pending)-1]
	s.notifier.mu.Unlock()
	if last.Message != "1 nouvelle(s) mise(s) à jour de sécurité : openssh-server" {
		t.Fatalf("message %q", last.Message)
	}

	// Docker image updates: off by default, then once per container.
	snap := func() *dockerSnapshot {
		return &dockerSnapshot{Containers: []dockerContainer{{Name: "app", Image: "nginx:1", Update: "available"}}}
	}
	s.storeDocker(id, "pve", snap())
	if pendingKinds(s)[KindImage] != 0 {
		t.Fatal("Docker image alerts must be off by default")
	}
	s.setSetting("notify_docker_updates", "true")
	s.db.Exec(`UPDATE host_live SET docker='{}' WHERE host_id=?`, id)
	s.storeDocker(id, "pve", snap())
	s.storeDocker(id, "pve", snap())
	if pendingKinds(s)[KindImage] != 1 {
		t.Fatalf("expected one image alert, got %v", pendingKinds(s))
	}

	// SMART threshold: "watch" also reports a disk that only needs watching.
	s.setSetting("notify_smart_level", DiskWatch)
	yes := true
	s.storeSmart(id, "pve", &smartReport{Disks: []smartDisk{{Name: "/dev/sda", Serial: "Z", Kind: "hdd", SmartPassed: &yes, PowerOnHours: f(10), Reallocated: f(2)}}})
	if pendingKinds(s)[KindDisk] != 1 {
		t.Fatalf("watch level must alert, got %v", pendingKinds(s))
	}
	// Disk space: once when crossing the threshold, again only after falling 5 points under it.
	full := []agentDisk{{Mount: "/", Used: 95, Total: 100}}
	s.checkDiskSpace(id, "pve", full)
	s.checkDiskSpace(id, "pve", full)
	s.checkDiskSpace(id, "pve", []agentDisk{{Mount: "/", Used: 88, Total: 100}})
	s.checkDiskSpace(id, "pve", full)
	if pendingKinds(s)[KindSpace] != 1 {
		t.Fatalf("expected one disk space alert, got %v", pendingKinds(s))
	}
	s.notifier.mu.Lock()
	s.notifier.timer.Stop()
	evs := s.notifier.pending
	s.notifier.mu.Unlock()
	subj, _, err := renderEmail(defaultSubject, defaultEmailHTML, buildEmailData("Lab", "", evs))
	if err != nil || subj != "[Avertissement] 6 avertissement(s)" {
		t.Fatalf("grouped subject %q (%v)", subj, err)
	}
}

func TestMonthlyReportEmailRenders(t *testing.T) {
	s, _ := newTestServer(t)
	res, _ := s.db.Exec(`INSERT INTO hosts(name,token_hash,created_at) VALUES('nas',x'03',0)`)
	id, _ := res.LastInsertId()
	s.storeUpdates(id, "nas", &agentUpdates{Packages: []agentPackage{{Name: "libssl3", Candidate: "2", Security: true}}, RebootRequired: true})
	yes := true
	s.storeSmart(id, "nas", &smartReport{Disks: []smartDisk{{Name: "/dev/sda", Model: "WD Red", Kind: "hdd", SmartPassed: &yes, PowerOnHours: f(100), Pending: f(2)}}})
	start, _ := parseMonth("")
	rep, err := s.monthlyReport(start)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Updates) != 1 || !rep.Updates[0].RebootRequired || len(rep.DisksAttention) != 1 {
		t.Fatalf("report %+v", rep)
	}
	var b strings.Builder
	if err := reportTpl.Execute(&b, map[string]any{"R": rep, "Label": "septembre 2026", "Title": "Lab", "URL": ""}); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Mises à jour", "nas", "Requis", "Santé des disques", "WD Red"} {
		if !strings.Contains(b.String(), want) {
			t.Fatalf("report e-mail lacks %q", want)
		}
	}
}

func TestWeekStart(t *testing.T) {
	// Monday 2026-10-12 to Sunday 2026-10-18: the report covers the week before, from Monday 10-05.
	for _, day := range []int{12, 14, 18} {
		got := weekStart(time.Date(2026, 10, day, 9, 0, 0, 0, time.UTC))
		if got != time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC) {
			t.Fatalf("day %d: %v", day, got)
		}
	}
}
