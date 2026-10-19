package main

import (
	"strings"
	"testing"
)

// The interfaces of a TP-Link Omada ER605 v2 (firmware 2.4.5), as its ifDescr lists them.
func TestER605Interfaces(t *testing.T) {
	want := map[string]string{
		"default/lo": "loopback", "default/eth0": "", "default/eth1": "wan", "default/ip6tnl0": "system", "default/sit0": "system",
		"default/gre0": "system", "default/gretap0": "system", "default/bond0": "system", "default/inf": "system",
		"default/inf.1": "lan", "default/inf.30": "lan", "default/wg1": "vpn",
	}
	for descr, role := range want {
		f := snmpIface{Descr: descr, DefaultRoute: descr == "default/eth1"}
		if got := ifRole(&f); got != role {
			t.Errorf("%s: %q, want %q", descr, got, role)
		}
	}
	if !ifNameEq("default/eth1", "eth1") || !ifNameEq("default/eth1", "DEFAULT/ETH1") || ifNameEq("default/eth1", "eth0") || ifNameEq("", "") {
		t.Fatal("name match")
	}
	d := &snmpDevice{Target: "192.168.50.1", Interfaces: []snmpIface{{Index: 3, Descr: "default/eth1"}, {Index: 22, Descr: "default/wg1"}}}
	attachProbes(d, []Monitor{
		{ID: 1, Name: "WAN ↓", Type: "snmp", Target: "192.168.50.1", Config: MonitorConfig{SNMPMode: "in", Interface: "eth1"}},
		{ID: 2, Name: "VPN", Type: "snmp", Target: "192.168.50.1", Config: MonitorConfig{SNMPMode: "ifstatus", Interface: "22"}},
		{ID: 3, Name: "Autre", Type: "snmp", Target: "10.0.0.1", Config: MonitorConfig{SNMPMode: "in", Interface: "eth1"}},
	})
	if len(d.Interfaces[0].Probes) != 1 || d.Interfaces[0].Probes[0].ID != 1 || len(d.Interfaces[1].Probes) != 1 || d.Interfaces[1].Probes[0].Mode != "ifstatus" {
		t.Fatalf("probes: %+v", d.Interfaces)
	}
}

func TestSNMPDiscoverRoute(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	if resp, out := do(t, ts, "POST", "/api/snmp/discover", cookie, map[string]any{"target": "bad host"}); resp.StatusCode != 400 {
		t.Fatalf("invalid target: %d %v", resp.StatusCode, out)
	}
	resp, out := do(t, ts, "POST", "/api/snmp/discover", cookie, map[string]any{"target": "127.0.0.1:1", "config": map[string]any{"snmp_version": "2c"}})
	if msg, _ := out["error"].(string); resp.StatusCode != 502 || !strings.Contains(msg, "SNMP") {
		t.Fatalf("unreachable: %d %v", resp.StatusCode, out)
	}
	if resp, out := do(t, ts, "GET", "/api/snmp/devices", cookie, nil); resp.StatusCode != 200 || out["devices"] == nil {
		t.Fatalf("devices: %d %v", resp.StatusCode, out)
	}
}
