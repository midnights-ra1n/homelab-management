package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gosnmp/gosnmp"
)

func TestAppsAPI(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	s.setSetting("api_enabled", "true")
	tok := createToken(t, ts, cookie, []string{"status:read", "push:write", "preferences:read", "preferences:write"}, nil)

	if code, _ := apiReq(t, ts, "POST", "/api/v1/devices", tok, `{"token":"zz","name":"iPhone"}`); code != 400 {
		t.Fatalf("bad device token: %d", code)
	}
	dev := strings.Repeat("ab", 32)
	if code, out := apiReq(t, ts, "POST", "/api/v1/devices", tok, `{"token":"`+strings.ToUpper(dev)+`","name":"iPhone","sandbox":true}`); code != 201 || out["token"] != dev {
		t.Fatalf("register: %d %v", code, out)
	}
	_, out := do(t, ts, "GET", "/api/devices", cookie, nil)
	if devs := out["devices"].([]any); len(devs) != 1 || devs[0].(map[string]any)["api_token"] != "gestion" {
		t.Fatalf("devices: %v", out)
	}

	// Preferences merge per key; null removes one.
	for _, body := range []string{`{"theme":"dark"}`, `{"monitors_view":"table"}`, `{"theme":null,"widget":{"kind":"power"}}`} {
		if code, out := apiReq(t, ts, "PUT", "/api/v1/preferences", tok, body); code != 200 {
			t.Fatalf("put %s: %d %v", body, code, out)
		}
	}
	_, prefs := do(t, ts, "GET", "/api/preferences", cookie, nil)
	if _, has := prefs["theme"]; has || prefs["monitors_view"] != "table" || prefs["widget"] == nil {
		t.Fatalf("preferences: %v", prefs)
	}

	m := Monitor{Name: "Baie", Type: "meross", Target: "192.168.1.20", IntervalS: 60, TimeoutS: 10, Enabled: true}
	m.validate()
	id, _ := s.insertMonitor(&m)
	now := time.Now().UnixMilli()
	for i, w := range []float64{100, 140} {
		s.db.Exec(`INSERT INTO monitor_results(monitor_id,ts,status,message,value) VALUES(?,?,'operational','',?)`, id, now-int64(1-i)*60000, w)
	}
	code, wid := apiReq(t, ts, "GET", "/api/v1/widgets", tok, "")
	power, _ := wid["power"].(map[string]any)
	if code != 200 || power["now_w"] != 140.0 || power["avg_24h_w"] != 120.0 || wid["problems"] == nil {
		t.Fatalf("widgets: %d %v", code, wid)
	}

	// Revoking the API token unregisters its devices.
	var tokID int64
	s.db.QueryRow(`SELECT id FROM api_tokens`).Scan(&tokID)
	do(t, ts, "DELETE", "/api/tokens/"+strconv.FormatInt(tokID, 10), cookie, nil)
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM push_devices`).Scan(&n)
	if n != 0 {
		t.Fatalf("device kept after token revocation")
	}
}

func TestAPNsJWT(t *testing.T) {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	a := &apns{key: k, keyID: "KEY123", teamID: "TEAM42"}
	jwt, err := a.token()
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(jwt, ".")
	head, _ := base64.RawURLEncoding.DecodeString(parts[0])
	sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !strings.Contains(string(head), `"kid":"KEY123"`) || len(sig) != 64 ||
		!ecdsa.Verify(&k.PublicKey, sum[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatalf("invalid JWT %s", jwt)
	}
	var p struct {
		Aps struct {
			Alert struct{ Title, Body string }
		}
		Events []map[string]any
	}
	json.Unmarshal(pushPayload([]Event{{Kind: "Hôte", Name: "nas", From: StatusOperational, To: StatusMinor, Message: "Agent injoignable, l'hôte répond au ping", At: time.Now()}}), &p)
	if p.Aps.Alert.Title != "nas : Panne partielle" || !strings.Contains(p.Aps.Alert.Body, "ping") || len(p.Events) != 1 {
		t.Fatalf("payload: %+v", p)
	}
}

func TestSNMPThroughput(t *testing.T) {
	m := Monitor{Name: "WAN", Type: "snmp", Target: "192.168.0.1", Config: MonitorConfig{SNMPMode: "in", Interface: "WAN1"}}
	if msg := m.validate(); msg != "" || m.Config.Unit != "Mbit/s" {
		t.Fatalf("validate: %q %q", msg, m.Config.Unit)
	}
	if msg := (&Monitor{Name: "x", Type: "snmp", Target: "h", Config: MonitorConfig{SNMPMode: "ifstatus"}}).validate(); msg == "" {
		t.Fatal("interface required")
	}
	m.ID = 1
	t0 := time.Now()
	rd := func(n uint64) ifReading { return ifReading{n: n, speed: 1000} }
	if res := throughput(&m, f(1), rd(1_000_000), t0); res.value != nil {
		t.Fatalf("first reading has no rate: %+v", res)
	}
	// Counter not refreshed yet by the router: no 0 Mbit/s, and the reference is kept.
	if res := throughput(&m, f(1), rd(1_000_000), t0.Add(5*time.Second)); res.value != nil || res.octets != 0 {
		t.Fatalf("stale counter: %+v", res)
	}
	res := throughput(&m, f(1), rd(1_000_000+12_500_000), t0.Add(10*time.Second))
	if res.value == nil || *res.value != 10 || res.status != StatusOperational || res.octets != 12_500_000 || !strings.Contains(res.message, "1,0 % du lien") {
		t.Fatalf("rate: %+v", res)
	}
	if res := throughput(&m, f(1), rd(5), t0.Add(20*time.Second)); res.value != nil {
		t.Fatalf("counter reset: %+v", res)
	}
	// 32-bit counter: a wrap within the link speed is traffic, a faster one is a reboot.
	m.Config.MaxPercent = f(50)
	throughput(&m, f(1), ifReading{n: 1<<32 - 1000, wrap: 1 << 32, speed: 1000}, t0.Add(30*time.Second))
	if res := throughput(&m, f(1), ifReading{n: 999_000_000, wrap: 1 << 32, speed: 1000}, t0.Add(40*time.Second)); res.value == nil || *res.value < 799 || res.status != StatusDegraded {
		t.Fatalf("wrap: %+v", res)
	}
	if res := throughput(&m, f(1), ifReading{n: 10, wrap: 1 << 32, speed: 1000}, t0.Add(50*time.Second)); res.value != nil {
		t.Fatalf("32-bit reboot: %+v", res)
	}
	// Another device: the counter starts again instead of comparing two routers.
	m.Target = "192.168.0.2"
	if res := throughput(&m, f(1), rd(50_000_000), t0.Add(60*time.Second)); res.value != nil {
		t.Fatalf("new target: %+v", res)
	}
}

func TestSNMPSecretsEncrypted(t *testing.T) {
	s, _ := newTestServer(t)
	m := Monitor{Name: "WAN", Type: "snmp", Target: "192.168.0.1", Config: MonitorConfig{SNMPMode: "in", Interface: "eth1", SNMPVersion: "3", SNMPUser: "u", AuthProto: "SHA", AuthPass: "Wk!secret"}}
	m.validate()
	id, _ := s.insertMonitor(&m)
	var raw string
	s.db.QueryRow(`SELECT config FROM monitors WHERE id=?`, id).Scan(&raw)
	if strings.Contains(raw, "Wk!secret") {
		t.Fatalf("stored in clear: %s", raw)
	}
	// A config saved in clear by an older version is encrypted at startup.
	s.db.Exec(`UPDATE monitors SET config='{"snmp_mode":"in","interface":"eth1","community":"public"}' WHERE id=?`, id)
	if err := s.sealMonitorSecrets(); err != nil {
		t.Fatal(err)
	}
	s.db.QueryRow(`SELECT config FROM monitors WHERE id=?`, id).Scan(&raw)
	mons, _ := s.loadMonitors(`WHERE id=?`, id)
	if strings.Contains(raw, "public") || mons[0].Config.Community != "public" {
		t.Fatalf("seal: %s / %q", raw, mons[0].Config.Community)
	}
}

func TestIfOIDs(t *testing.T) {
	m := &Monitor{Config: MonitorConfig{SNMPMode: "out", Interface: "default/eth1"}}
	v1, v2 := strings.Join(ifOIDs(m, true, "3"), " "), strings.Join(ifOIDs(m, false, "3"), " ")
	// SNMPv1 fails a whole request on one missing OID: only ifTable columns there.
	if strings.Contains(v1, "1.3.6.1.2.1.31.") || !strings.Contains(v1, oidIfOutOctets+".3") {
		t.Fatalf("v1: %s", v1)
	}
	if !strings.Contains(v2, oidIfHCOut+".3") || !strings.Contains(v2, oidIfName+".3") || !strings.Contains(v2, oidIfHighSpeed+".3") {
		t.Fatalf("v2: %s", v2)
	}
	vals := map[string]gosnmp.SnmpPDU{oidIfDescr + ".3": {Value: []byte("default/eth1")}}
	if !ifNameMatches(vals, "DEFAULT/ETH1", "3") || ifNameMatches(vals, "default/wg1", "3") || !ifNameMatches(nil, "3", "3") {
		t.Fatal("name check")
	}
}
