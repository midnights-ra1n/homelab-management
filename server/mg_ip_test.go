package main

import "testing"

func TestCidrHelpers(t *testing.T) {
	if n, ok := normalizeCidr("192.168.10.77/24"); !ok || n != "192.168.10.0/24" {
		t.Fatalf("normalize: %q %v", n, ok)
	}
	if !cidrContains("10.0.0.0/8", "10.20.30.40") || cidrContains("10.0.0.0/8", "11.0.0.1") {
		t.Fatal("contains")
	}
	if !cidrOverlap("192.168.0.0/16", "192.168.10.0/24") || cidrOverlap("192.168.1.0/24", "192.168.2.0/24") {
		t.Fatal("overlap")
	}
	if usableHosts("192.168.1.0/24") != 254 || usableHosts("10.0.0.0/31") != 2 || usableHosts("bad") != 0 {
		t.Fatal("usable")
	}
	for spec, want := range map[string]bool{"": true, "22,80,8000-8100": true, "0": false, "90-80": false, "70000": false, "a": false} {
		if validPortSpec(spec) != want {
			t.Fatalf("port spec %q", spec)
		}
	}
	if isIPv4("256.1.1.1") || isIPv4("1.2.3") || !isIPv4("1.2.3.4") {
		t.Fatal("ipv4")
	}
}
