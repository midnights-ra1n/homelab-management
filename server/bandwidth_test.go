package main

import (
	"testing"
	"time"
)

func TestBandwidth(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	add := func(name, mode, iface string) int64 {
		m := Monitor{Name: name, Type: "snmp", Target: "192.168.0.1", Enabled: true, Status: StatusOperational,
			Config: MonitorConfig{SNMPMode: mode, Interface: iface}}
		if msg := m.validate(); msg != "" {
			t.Fatal(msg)
		}
		id, err := s.insertMonitor(&m)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	in, out := add("WAN ↓", "in", "WAN1"), add("WAN ↑", "out", "wan1")
	add("WireGuard", "ifstatus", "wg0")
	other := Monitor{Name: "Uptime", Type: "snmp", Target: "192.168.0.1", Enabled: true, Config: MonitorConfig{OID: "1.3.6.1.2.1.1.3.0"}}
	other.validate()
	s.insertMonitor(&other)
	now := time.Now().UnixMilli()
	// 30 minutes apart: each reading lands in its own 12-minute bucket whatever the time.
	for i, v := range []float64{80, 120, 100} {
		s.db.Exec(`INSERT INTO monitor_results(monitor_id,ts,status,message,value) VALUES(?,?,'operational','',?)`, in, now-int64(3-i)*1_800_000, v)
	}
	s.db.Exec(`INSERT INTO monitor_results(monitor_id,ts,status,message,value) VALUES(?,?,'operational','',12)`, out, now-60_000)

	v, err := s.bandwidth(24*time.Hour, "24h")
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Links) != 2 || len(v.T) == 0 {
		t.Fatalf("links: %+v", v.Links)
	}
	wan := v.Links[0] // sorted: 192.168.0.1|wan1 < 192.168.0.1|wg0
	if wan.In == nil || wan.Out == nil || wan.State != nil || *wan.In.Current != 100 || *wan.In.Avg != 100 || *wan.In.Peak != 120 || *wan.Out.Current != 12 {
		t.Fatalf("wan: %+v in=%+v", wan, wan.In)
	}
	if len(wan.In.Series) != len(v.T) {
		t.Fatal("series not aligned on t")
	}
	// Volume per local day, from the hourly table (3 days ago, and now).
	if len(v.Days) != bandwidthDays || wan.In.Daily[len(v.Days)-1] != 0 {
		t.Fatalf("days: %v %v", v.Days, wan.In.Daily)
	}
	h := time.Now().Unix() / 3600 * 3600
	s.db.Exec(`INSERT INTO traffic_hourly(monitor_id,hour,octets) VALUES(?,?,5000000000),(?,?,1000000000)`, in, h, in, h-3*86400)
	v, _ = s.bandwidth(24*time.Hour, "24h")
	d := v.Links[0].In
	if n := len(d.Daily); d.Today != 5e9 || d.Daily[n-1] != 5e9 || d.Daily[n-4] != 1e9 || d.Month < 5e9 {
		t.Fatalf("volume: today %d month %d daily %v", d.Today, d.Month, d.Daily)
	}
	if wg := v.Links[1]; wg.State == nil || wg.In != nil || wg.Interface != "wg0" {
		t.Fatalf("wireguard: %+v", wg)
	}
	if resp, out := do(t, ts, "GET", "/api/overview", cookie, nil); resp.StatusCode != 200 || out["bandwidth"] == nil {
		t.Fatalf("overview: %d", resp.StatusCode)
	}
}

func TestLiveBandwidth(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	m := Monitor{Name: "WAN ↓", Type: "snmp", Target: "127.0.0.1:1", Enabled: true, Config: MonitorConfig{SNMPMode: "in", Interface: "1"}}
	if msg := m.validate(); msg != "" {
		t.Fatal(msg)
	}
	s.insertMonitor(&m)
	resp, out := do(t, ts, "GET", "/api/bandwidth/live", cookie, nil)
	samples, _ := out["samples"].([]any)
	if resp.StatusCode != 200 || len(samples) != 1 {
		t.Fatalf("live: %d %v", resp.StatusCode, out)
	}
	if sm := samples[0].(map[string]any); sm["mbps"] != nil || sm["error"] == "" || sm["mode"] != "in" {
		t.Fatalf("unreachable device: %v", sm)
	}
	// A second viewer within liveMinGap gets the same reading, without querying the device again.
	if _, again := do(t, ts, "GET", "/api/bandwidth/live", cookie, nil); again["at"] != out["at"] {
		t.Fatalf("reading not shared: %v vs %v", again["at"], out["at"])
	}
}

func TestLiveRate(t *testing.T) {
	t0 := time.Now()
	at := func(s, n int) octetSample { return octetSample{uint64(n), t0.Add(time.Duration(s) * time.Second)} }
	// The router refreshes its counter every 10 s; reads every 2 s must not show 0 in between.
	ref := at(0, 0)
	var rate *float64
	for s := 2; s <= 20; s += 2 {
		rate, ref = liveRate(ref, true, at(s, s/10*125_000_000), 0, rate)
	}
	if rate == nil || *rate != 100 || ref.at != t0.Add(20*time.Second) {
		t.Fatalf("rate %v ref %v", rate, ref)
	}
	if r, _ := liveRate(at(0, 5), true, at(40, 5), 0, rate); r == nil || *r != 0 {
		t.Fatalf("idle link: %v", r)
	}
	if r, keep := liveRate(at(0, 9), true, at(2, 1), 0, rate); r != nil || keep.n != 1 {
		t.Fatal("counter reset")
	}
}
