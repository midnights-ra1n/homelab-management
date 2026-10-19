package main

import (
	"context"
	"fmt"
	"net"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gosnmp/gosnmp"
)

var oidRe = regexp.MustCompile(`^\.?[0-9]+(\.[0-9]+)+$`)

var snmpAuth = map[string]gosnmp.SnmpV3AuthProtocol{"MD5": gosnmp.MD5, "SHA": gosnmp.SHA, "SHA256": gosnmp.SHA256, "SHA512": gosnmp.SHA512}
var snmpPriv = map[string]gosnmp.SnmpV3PrivProtocol{"DES": gosnmp.DES, "AES": gosnmp.AES, "AES256": gosnmp.AES256}

func validateSNMP(m *Monitor) string {
	c := &m.Config
	if _, _, err := snmpAddr(m.Target); err != nil {
		return "La cible doit être un hôte, avec un port facultatif (161 par défaut)"
	}
	switch c.SNMPMode {
	case "":
		if !oidRe.MatchString(c.OID) {
			return "L'OID doit être numérique, par exemple 1.3.6.1.2.1.1.3.0"
		}
	case "in", "out", "ifstatus":
		c.Interface = strings.TrimSpace(c.Interface)
		if c.Interface == "" || len(c.Interface) > 64 {
			return "Indiquez le nom de l'interface (64 caractères au plus) ou son numéro ifIndex"
		}
		if p := c.MaxPercent; p != nil && (*p <= 0 || *p > 100 || c.SNMPMode == "ifstatus") {
			return "Le seuil d'utilisation du lien doit être entre 0 et 100 %, pour un débit"
		}
		if c.IdleMinutes < 0 || c.IdleMinutes > 1440 || (c.IdleMinutes > 0 && c.SNMPMode != "ifstatus") {
			return "Le délai sans trafic doit être entre 1 et 1440 minutes, pour l'état d'une interface"
		}
		c.Unit = map[string]string{"in": "Mbit/s", "out": "Mbit/s"}[c.SNMPMode]
	default:
		return "La mesure SNMP doit être un OID, le débit entrant, le débit sortant ou l'état d'une interface"
	}
	if len(c.Unit) > 16 {
		return "L'unité doit contenir au plus 16 caractères"
	}
	switch c.SNMPVersion {
	case "":
		c.SNMPVersion = "2c"
		fallthrough
	case "1", "2c":
		if c.Community == "" {
			c.Community = "public"
		}
	case "3":
		if c.SNMPUser == "" {
			return "SNMPv3 nécessite un nom d'utilisateur"
		}
		if _, ok := snmpAuth[c.AuthProto]; c.AuthProto != "" && !ok {
			return "L'authentification SNMPv3 doit être MD5, SHA, SHA256 ou SHA512"
		}
		if _, ok := snmpPriv[c.PrivProto]; c.PrivProto != "" && !ok {
			return "Le chiffrement SNMPv3 doit être DES, AES ou AES256"
		}
		if c.PrivProto != "" && c.AuthProto == "" {
			return "Le chiffrement SNMPv3 nécessite aussi l'authentification"
		}
	default:
		return "La version SNMP doit être 1, 2c ou 3"
	}
	return ""
}

func snmpAddr(target string) (string, uint16, error) {
	if h, p, err := net.SplitHostPort(target); err == nil {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1 || n > 65535 || h == "" {
			return "", 0, fmt.Errorf("port invalide")
		}
		return h, uint16(n), nil
	}
	if target == "" || strings.ContainsAny(target, " /:@") {
		return "", 0, fmt.Errorf("hôte invalide")
	}
	return target, 161, nil
}

// snmpClient prepares (without connecting) a session for the probe's device and credentials.
func snmpClient(ctx context.Context, m *Monitor, timeout time.Duration) *gosnmp.GoSNMP {
	c := &m.Config
	host, port, _ := snmpAddr(m.Target)
	g := &gosnmp.GoSNMP{Target: host, Port: port, Context: ctx, Timeout: timeout, Retries: 1, Community: c.Community}
	switch c.SNMPVersion {
	case "1":
		g.Version = gosnmp.Version1
	case "3":
		g.Version, g.SecurityModel, g.Community = gosnmp.Version3, gosnmp.UserSecurityModel, ""
		usm := &gosnmp.UsmSecurityParameters{UserName: c.SNMPUser}
		g.MsgFlags = gosnmp.NoAuthNoPriv
		if c.AuthProto != "" {
			g.MsgFlags = gosnmp.AuthNoPriv
			usm.AuthenticationProtocol, usm.AuthenticationPassphrase = snmpAuth[c.AuthProto], c.AuthPass
		}
		if c.PrivProto != "" {
			g.MsgFlags = gosnmp.AuthPriv
			usm.PrivacyProtocol, usm.PrivacyPassphrase = snmpPriv[c.PrivProto], c.PrivPass
		}
		g.SecurityParameters = usm
	default:
		g.Version = gosnmp.Version2c
	}
	return g
}

func checkSNMP(ctx context.Context, m *Monitor) checkResult {
	c := &m.Config
	deadline, _ := ctx.Deadline()
	g := snmpClient(ctx, m, time.Until(deadline)/2)
	start := time.Now()
	if err := g.Connect(); err != nil {
		return checkResult{StatusMajor, nil, "Connexion SNMP impossible : " + err.Error(), nil, nil, 0}
	}
	defer g.Conn.Close()
	if c.SNMPMode != "" {
		return checkInterface(g, m, start)
	}
	pkt, err := g.Get([]string{c.OID})
	if err != nil {
		return checkResult{StatusMajor, nil, "Requête SNMP échouée : " + err.Error(), nil, nil, 0}
	}
	lat := ms(time.Since(start))
	if pkt.Error != gosnmp.NoError || len(pkt.Variables) == 0 {
		return checkResult{StatusMinor, lat, "Erreur SNMP : " + pkt.Error.String(), nil, nil, 0}
	}
	v := pkt.Variables[0]
	switch v.Type {
	case gosnmp.NoSuchObject, gosnmp.NoSuchInstance, gosnmp.EndOfMibView, gosnmp.Null:
		return checkResult{StatusMinor, lat, "OID introuvable sur l'équipement", nil, nil, 0}
	case gosnmp.OctetString:
		str := strings.TrimSpace(string(v.Value.([]byte)))
		if f, err := strconv.ParseFloat(str, 64); err == nil {
			return valueResult(c, lat, f, c.Unit)
		}
		if c.Expected != "" && !strings.Contains(str, c.Expected) {
			return checkResult{StatusMinor, lat, "Valeur inattendue : " + str, nil, nil, 0}
		}
		return slowOrOK(c, lat, str)
	}
	f, _ := gosnmp.ToBigInt(v.Value).Float64()
	return valueResult(c, lat, f, c.Unit)
}

// valueResult checks a reading against the optional min/max thresholds.
func valueResult(c *MonitorConfig, lat *float64, v float64, unit string) checkResult {
	txt := strings.TrimSpace(frNum(v, 1) + " " + unit)
	res := slowOrOK(c, lat, txt)
	if c.MaxValue != nil && v > *c.MaxValue {
		res = checkResult{StatusDegraded, lat, fmt.Sprintf("%s au-dessus du seuil de %s %s", txt, frNum(*c.MaxValue, 1), unit), nil, nil, 0}
	} else if c.MinValue != nil && v < *c.MinValue {
		res = checkResult{StatusDegraded, lat, fmt.Sprintf("%s sous le seuil de %s %s", txt, frNum(*c.MinValue, 1), unit), nil, nil, 0}
	}
	res.value = &v
	return res
}

// IF-MIB columns, suffixed with the ifIndex.
const (
	oidIfDescr      = "1.3.6.1.2.1.2.2.1.2"
	oidIfSpeed      = "1.3.6.1.2.1.2.2.1.5" // bit/s, saturates at 4.29 Gbit/s
	oidIfOperStatus = "1.3.6.1.2.1.2.2.1.8"
	oidIfInOctets   = "1.3.6.1.2.1.2.2.1.10"
	oidIfOutOctets  = "1.3.6.1.2.1.2.2.1.16"
	oidIfName       = "1.3.6.1.2.1.31.1.1.1.1"
	oidIfHCIn       = "1.3.6.1.2.1.31.1.1.1.6"
	oidIfHCOut      = "1.3.6.1.2.1.31.1.1.1.10"
	oidIfHighSpeed  = "1.3.6.1.2.1.31.1.1.1.15" // Mbit/s
	oidIfAlias      = "1.3.6.1.2.1.31.1.1.1.18"
)

var ifOperStatus = map[int]string{1: "active", 2: "inactive", 3: "en test", 4: "inconnue", 5: "en veille", 6: "absente", 7: "couche inférieure inactive"}

// snmpCounters keeps the previous counter of each interface probe, to compute a rate (in/out)
// or to know since when nothing was received (ifstatus with idle_minutes).
// shortcut: in memory, so the first check after a restart only records the counter.
var snmpCounters sync.Map

type octetSample struct {
	n  uint64
	at time.Time
}

// counterKey includes the device, so a probe moved to another device starts from a new counter.
func counterKey(m *Monitor) string {
	return fmt.Sprintf("%d/%s/%s/%s", m.ID, m.Config.SNMPMode, strings.ToLower(m.Target), m.Config.Interface)
}

// counterDelta is the increase of a counter, across one wrap of a 32-bit counter (wrap = 2³²);
// ok is false after a reset (device reboot) or for a 64-bit counter going backwards.
func counterDelta(prev, n, wrap uint64) (delta uint64, wrapped, ok bool) {
	if n >= prev {
		return n - prev, false, true
	}
	if wrap > 0 && prev < wrap {
		return n + wrap - prev, true, true
	}
	return 0, false, false
}

// ifIndex finds an interface by ifIndex, ifName, ifDescr or ifAlias (case-insensitive, with or
// without a namespace prefix: "eth1" finds the ER605's "default/eth1").
// On a miss it returns the names it saw, so the message helps pick the right one.
func ifIndex(g *gosnmp.GoSNMP, want string) (string, []string, error) {
	if _, err := strconv.Atoi(want); err == nil {
		return want, nil, nil
	}
	walk := g.BulkWalkAll
	if g.Version == gosnmp.Version1 {
		walk = g.WalkAll
	}
	var seen []string
	for _, col := range []string{oidIfName, oidIfDescr, oidIfAlias} {
		pdus, err := walk(col)
		if err != nil {
			return "", nil, err
		}
		for _, p := range pdus {
			b, ok := p.Value.([]byte)
			if !ok {
				continue
			}
			name := strings.TrimSpace(string(b))
			if ifNameEq(name, want) {
				return p.Name[strings.LastIndex(p.Name, ".")+1:], nil, nil
			}
			if name != "" && col != oidIfAlias && !slices.Contains(seen, name) {
				seen = append(seen, name)
			}
		}
	}
	return "", seen, nil
}

// checkInterface reads the status or the throughput of one interface (IF-MIB), for routers
// like the TP-Link Omada ER605 whose WAN and VPN interfaces are listed in ifTable.
func checkInterface(g *gosnmp.GoSNMP, m *Monitor, start time.Time) checkResult {
	c := &m.Config
	r := readInterfaces(g, []*Monitor{m})[0]
	lat := ms(time.Since(start))
	if r.fail != nil {
		if r.fail.status == StatusMinor {
			r.fail.latency = lat
		}
		return *r.fail
	}
	if c.SNMPMode != "ifstatus" {
		return throughput(m, lat, r, time.Now())
	}
	label := ifOperStatus[int(r.n)]
	if label == "" {
		label = "état " + strconv.FormatUint(r.n, 10)
	}
	if r.n != 1 {
		return checkResult{StatusMajor, lat, "Interface " + c.Interface + " " + label, nil, nil, 0}
	}
	if c.IdleMinutes > 0 {
		// An up WireGuard interface says nothing about the tunnel; its received bytes do (keepalives).
		key, now := counterKey(m), time.Now()
		v, seen := snmpCounters.Load(key)
		if a, _ := v.(octetSample); !seen || a.n != r.in {
			snmpCounters.Store(key, octetSample{r.in, now})
		} else if idle := now.Sub(a.at); idle >= time.Duration(c.IdleMinutes)*time.Minute {
			return checkResult{StatusMajor, lat, fmt.Sprintf("Interface %s active mais rien reçu depuis %d min", c.Interface, int(idle.Minutes())), nil, nil, 0}
		}
	}
	return slowOrOK(c, lat, "Interface "+c.Interface+" active")
}

// ifIndexes caches the ifIndex of each device interface, so frequent reads (live view) do not
// walk the interface table every time. Every read checks the interface name with the value,
// so a renumbering (router reboot, tunnel recreated) is noticed at once.
var ifIndexes sync.Map

// ifReading is what readInterfaces got for one probe.
type ifReading struct {
	n     uint64  // ifOperStatus, or the octet counter
	wrap  uint64  // 2³² when n is a 32-bit counter
	in    uint64  // ifstatus: inbound octets, for idle_minutes
	speed float64 // link speed in Mbit/s, 0 when unknown
	fail  *checkResult
}

// readInterfaces reads the interfaces of several probes of one device in a single request.
func readInterfaces(g *gosnmp.GoSNMP, ms []*Monitor) []ifReading {
	return readInterfacesOnce(g, ms, true)
}

func readInterfacesOnce(g *gosnmp.GoSNMP, ms []*Monitor, retry bool) []ifReading {
	out := make([]ifReading, len(ms))
	idx := make([]string, len(ms))
	var oids []string
	v1 := g.Version == gosnmp.Version1
	for i, m := range ms {
		key := strings.ToLower(m.Target + "|" + m.Config.Interface)
		if v, ok := ifIndexes.Load(key); ok {
			idx[i] = v.(string)
		} else {
			found, seen, err := ifIndex(g, m.Config.Interface)
			if err != nil {
				out[i].fail = &checkResult{StatusMajor, nil, "Requête SNMP échouée : " + err.Error(), nil, nil, 0}
				continue
			}
			if found == "" {
				msg := "Interface « " + m.Config.Interface + " » introuvable"
				if len(seen) > 0 {
					msg += ". Interfaces vues : " + strings.Join(capped(seen, 15), ", ")
				}
				out[i].fail = &checkResult{StatusMinor, nil, msg, nil, nil, 0}
				continue
			}
			ifIndexes.Store(key, found)
			idx[i] = found
		}
		oids = append(oids, ifOIDs(m, v1, idx[i])...)
	}
	vals := map[string]gosnmp.SnmpPDU{}
	for len(oids) > 0 {
		n := min(len(oids), max(g.MaxOids, 1))
		pkt, err := g.Get(oids[:n])
		if err == nil && pkt.Error != gosnmp.NoError {
			err = fmt.Errorf("%s", pkt.Error)
		}
		if err != nil {
			for i := range out {
				if out[i].fail == nil {
					out[i].fail = &checkResult{StatusMajor, nil, "Requête SNMP échouée : " + err.Error(), nil, nil, 0}
				}
			}
			return out
		}
		for _, v := range pkt.Variables {
			vals[strings.TrimPrefix(v.Name, ".")] = v
		}
		oids = oids[n:]
	}
	num := func(oid, i string) (uint64, bool) {
		v, ok := vals[oid+"."+i]
		switch v.Type {
		case gosnmp.NoSuchObject, gosnmp.NoSuchInstance, gosnmp.EndOfMibView, gosnmp.Null:
			return 0, false
		}
		return gosnmp.ToBigInt(v.Value).Uint64(), ok
	}
	var again []int
	for i, m := range ms {
		if out[i].fail != nil {
			continue
		}
		c, r, x := &m.Config, &out[i], idx[i]
		key := strings.ToLower(m.Target + "|" + c.Interface)
		if !v1 && !ifNameMatches(vals, c.Interface, x) {
			ifIndexes.Delete(key) // renumbered: the cached ifIndex is another interface now
			if retry {
				again = append(again, i)
			} else {
				r.fail = &checkResult{StatusMinor, nil, "Interface " + c.Interface + " renumérotée, nouvelle lecture au prochain contrôle", nil, nil, 0}
			}
			continue
		}
		var ok bool
		switch {
		case c.SNMPMode == "ifstatus":
			r.n, ok = num(oidIfOperStatus, x)
			if r.in, _ = num(oidIfHCIn, x); v1 || r.in == 0 {
				r.in, _ = num(oidIfInOctets, x)
			}
		case !v1:
			if r.n, ok = num(map[string]string{"in": oidIfHCIn, "out": oidIfHCOut}[c.SNMPMode], x); ok {
				break
			}
			fallthrough // no 64-bit counters on this device
		default:
			r.n, ok = num(map[string]string{"in": oidIfInOctets, "out": oidIfOutOctets}[c.SNMPMode], x)
			r.wrap = 1 << 32
		}
		if !ok {
			ifIndexes.Delete(key) // interface gone (router reboot): resolve it again next time
			r.fail = &checkResult{StatusMinor, nil, "Compteur absent pour l'interface " + c.Interface, nil, nil, 0}
			continue
		}
		if hs, _ := num(oidIfHighSpeed, x); hs > 0 && !v1 {
			r.speed = float64(hs)
		} else if sp, _ := num(oidIfSpeed, x); sp > 0 {
			r.speed = float64(sp) / 1e6
		}
		if r.speed > 0 {
			ifSpeeds.Store(key, r.speed)
		}
	}
	if len(again) > 0 {
		sub := make([]*Monitor, len(again))
		for j, i := range again {
			sub[j] = ms[i]
		}
		for j, r := range readInterfacesOnce(g, sub, false) {
			out[again[j]] = r
		}
	}
	return out
}

// ifOIDs lists what one probe needs, all in the same request: value, speed and, unless the
// interface is given by number, its names to check that the ifIndex still points to it.
func ifOIDs(m *Monitor, v1 bool, idx string) []string {
	cols := []string{oidIfSpeed}
	switch m.Config.SNMPMode {
	case "ifstatus":
		cols = append(cols, oidIfOperStatus, oidIfInOctets)
	case "in":
		cols = append(cols, oidIfInOctets)
	case "out":
		cols = append(cols, oidIfOutOctets)
	}
	if !v1 { // SNMPv1 fails the whole request when one OID is missing: only ifTable there
		cols = append(cols, oidIfHighSpeed)
		switch m.Config.SNMPMode {
		case "ifstatus", "in":
			cols = append(cols, oidIfHCIn)
		case "out":
			cols = append(cols, oidIfHCOut)
		}
		if _, err := strconv.Atoi(m.Config.Interface); err != nil {
			cols = append(cols, oidIfName, oidIfDescr, oidIfAlias)
		}
	}
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = c + "." + idx
	}
	return out
}

func ifNameMatches(vals map[string]gosnmp.SnmpPDU, want, idx string) bool {
	if _, err := strconv.Atoi(want); err == nil {
		return true
	}
	for _, col := range []string{oidIfName, oidIfDescr, oidIfAlias} {
		if b, ok := vals[col+"."+idx].Value.([]byte); ok && ifNameEq(string(b), want) {
			return true
		}
	}
	return false
}

// throughput turns two successive octet counters into Mbit/s, plus the bytes for the volume.
func throughput(m *Monitor, lat *float64, r ifReading, now time.Time) checkResult {
	c, key := &m.Config, counterKey(m)
	prev, ok := snmpCounters.Load(key)
	p, _ := prev.(octetSample)
	delta, wrapped, valid := counterDelta(p.n, r.n, r.wrap)
	dt := now.Sub(p.at)
	if ok && valid && delta == 0 && dt < liveStale && dt > 0 {
		// Routers like the ER605 refresh their counters every few seconds: keep the reference, so
		// the next rate covers the real period instead of showing 0 now and a burst later.
		return checkResult{StatusOperational, lat, "Compteur pas encore rafraîchi par l'équipement", nil, nil, 0}
	}
	snmpCounters.Store(key, octetSample{r.n, now})
	mbps := float64(delta) * 8 / dt.Seconds() / 1e6
	// A "wrap" faster than the link is a reboot of a device with 32-bit counters.
	if !ok || !valid || dt <= 0 || (wrapped && (r.speed == 0 || mbps > r.speed*1.1)) {
		return checkResult{StatusOperational, lat, "Premier relevé, débit au prochain contrôle", nil, nil, 0}
	}
	res := valueResult(c, lat, mbps, c.Unit)
	if r.speed > 0 {
		pct := mbps / r.speed * 100
		res.message += fmt.Sprintf(" · %s %% du lien (%s Mbit/s)", frNum(pct, 1), frNum(r.speed, 0))
		if c.MaxPercent != nil && pct > *c.MaxPercent && statusRank(res.status) < statusRank(StatusDegraded) {
			res.status, res.message = StatusDegraded, fmt.Sprintf("%s Mbit/s, %s %% du lien : au-dessus du seuil de %s %%", frNum(mbps, 1), frNum(pct, 1), frNum(*c.MaxPercent, 0))
		}
	}
	res.octets = delta
	return res
}

// ifSpeeds keeps the last link speed seen per device interface, for the bandwidth view.
var ifSpeeds sync.Map
