package main

import "testing"

func TestTrueNASVerdict(t *testing.T) {
	ok := truenasPool{Name: "tank", Status: "ONLINE", Healthy: true, Size: 100, Allocated: 50}
	if r := truenasVerdict([]truenasPool{ok}, nil, 90); r.status != StatusOperational || *r.value != 50 {
		t.Fatalf("healthy pool: %+v", r)
	}
	full := ok
	full.Allocated = 95
	if r := truenasVerdict([]truenasPool{ok, full}, nil, 90); r.status != StatusDegraded || *r.value != 95 {
		t.Fatalf("full pool: %+v", r)
	}
	deg := truenasPool{Name: "backup", Status: "DEGRADED", Size: 100, Allocated: 10}
	if r := truenasVerdict([]truenasPool{full, deg}, nil, 90); r.status != StatusMinor {
		t.Fatalf("degraded pool must win over a full one: %+v", r)
	}
	crit := []truenasAlert{{Level: "CRITICAL", Formatted: "Disk sda is FAULTED"}, {Level: "CRITICAL", Dismissed: true}}
	if r := truenasVerdict([]truenasPool{ok}, crit, 90); r.status != StatusDegraded || r.message != "Disk sda is FAULTED" {
		t.Fatalf("critical alert: %+v", r)
	}
}
