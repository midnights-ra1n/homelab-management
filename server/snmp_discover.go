package main

// SNMP discovery: the interfaces of a device with what helps choose the probes (likely role,
// addresses, default route, counters, what "in" and "out" mean there). Used by the probe form
// (POST /api/snmp/discover) and by GET /api(/v1)/snmp/devices.

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gosnmp/gosnmp"
)

const (
	oidSysDescr  = "1.3.6.1.2.1.1.1.0"
	oidSysUpTime = "1.3.6.1.2.1.1.3.0"
	oidSysName   = "1.3.6.1.2.1.1.5.0"
	oidIPAddrIf  = "1.3.6.1.2.1.4.20.1.2"   // ipAdEntIfIndex.<address>
	oidRouteIf   = "1.3.6.1.2.1.4.21.1.2"   // ipRouteIfIndex.<destination>
	oidCidrIf    = "1.3.6.1.2.1.4.24.4.1.5" // ipCidrRouteIfIndex.<dest>.<mask>.<tos>.<next hop>
	oidInetIf    = "1.3.6.1.2.1.4.24.7.1.7" // inetCidrRouteIfIndex.<type>.<len>.<dest>.<prefix>…
)

type snmpIface struct {
	Index        int           `json:"index"`
	Name         string        `json:"name"`  // ifName
	Descr        string        `json:"descr"` // ifDescr, e.g. "default/eth1" on the ER605
	Alias        string        `json:"alias"`
	Status       string        `json:"status"` // ifOperStatus label
	Up           bool          `json:"up"`
	Speed        *float64      `json:"speed_mbps"`
	InOctets     *uint64       `json:"in_octets"` // received since the device started
	OutOctets    *uint64       `json:"out_octets"`
	Addresses    []string      `json:"addresses"`     // IPv4 addresses of the interface
	DefaultRoute bool          `json:"default_route"` // the device's default route goes out there
	Role         string        `json:"role"`          // wan, lan, vpn, loopback, system or "": a guess
	Hint         string        `json:"hint"`          // French: what in / out mean on this interface
	Probes       []snmpIfProbe `json:"probes"`        // probes already reading it
}

type snmpIfProbe struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Mode string `json:"mode"`
}

type snmpDevice struct {
	Target     string      `json:"target"`
	SysName    string      `json:"sys_name"`
	SysDescr   string      `json:"sys_descr"`
	Uptime     int64       `json:"uptime_s"`
	Interfaces []snmpIface `json:"interfaces"`
	Error      string      `json:"error,omitempty"`
}

var ifRoleOrder = map[string]int{"wan": 0, "vpn": 1, "lan": 2, "": 3, "system": 4, "loopback": 5}

var ifRoleHints = map[string]string{
	"wan":      "Entrant = téléchargement (Internet vers le réseau local), Sortant = envoi vers Internet.",
	"lan":      "Sens inversé par rapport au WAN : Entrant = ce que les appareils de ce réseau envoient, Sortant = ce qu'ils reçoivent.",
	"vpn":      "Entrant = reçu du pair par le tunnel, Sortant = envoyé vers lui. Pour la disponibilité : « État d'une interface » avec un délai sans trafic reçu.",
	"system":   "Interface interne du système, sans intérêt à surveiller.",
	"loopback": "Boucle locale du système, sans intérêt à surveiller.",
}

// ifBase strips the namespace prefix some routers add (ER605: "default/eth1" → "eth1").
func ifBase(name string) string {
	return name[strings.LastIndex(name, "/")+1:]
}

// ifNameEq matches an interface name as typed in a probe, with or without the namespace prefix.
func ifNameEq(name, want string) bool {
	name = strings.TrimSpace(name)
	return name != "" && (strings.EqualFold(name, want) || strings.EqualFold(ifBase(name), want))
}

// ifRole guesses the role of an interface from its route and its Linux name (most routers,
// the ER605 included, run Linux: ethN, inf.<vlan>, wgN, ppp…).
func ifRole(f *snmpIface) string {
	base := strings.ToLower(ifBase(f.Descr))
	if f.Name != "" {
		base = strings.ToLower(ifBase(f.Name))
	}
	has := func(p ...string) bool {
		for _, x := range p {
			if strings.HasPrefix(base, x) {
				return true
			}
		}
		return false
	}
	switch {
	case f.DefaultRoute || has("ppp", "wan"):
		return "wan"
	case has("wg", "tun", "l2tp", "ipsec", "ovpn", "vti"):
		return "vpn"
	case base == "lo":
		return "loopback"
	case has("ip6tnl", "sit", "gre", "erspan", "ip_vti", "bond", "dummy", "teql", "ifb"), base == "inf":
		return "system"
	case has("inf.", "br", "lan", "vlan"):
		return "lan"
	}
	return ""
}

func snmpDiscover(ctx context.Context, m *Monitor) *snmpDevice {
	d := &snmpDevice{Target: m.Target, Interfaces: []snmpIface{}}
	g := snmpClient(ctx, m, 3*time.Second)
	if err := g.Connect(); err != nil {
		d.Error = "Connexion SNMP impossible : " + err.Error()
		return d
	}
	defer g.Conn.Close()
	pkt, err := g.Get([]string{oidSysName, oidSysDescr, oidSysUpTime})
	if err == nil && pkt.Error != gosnmp.NoError {
		err = errors.New(pkt.Error.String())
	}
	if err != nil {
		d.Error = "Requête SNMP échouée : " + err.Error()
		return d
	}
	for _, v := range pkt.Variables {
		switch strings.TrimPrefix(v.Name, ".") {
		case oidSysName:
			d.SysName = pduString(v)
		case oidSysDescr:
			d.SysDescr = pduString(v)
		case oidSysUpTime:
			d.Uptime = gosnmp.ToBigInt(v.Value).Int64() / 100
		}
	}
	walk := g.BulkWalkAll
	if g.Version == gosnmp.Version1 {
		walk = g.WalkAll
	}
	// col reads a table column, keyed by the index suffix; a column the device lacks is empty.
	col := func(oid string) map[string]gosnmp.SnmpPDU {
		out := map[string]gosnmp.SnmpPDU{}
		pdus, _ := walk(oid)
		for _, p := range pdus {
			if n := strings.TrimPrefix(p.Name, "."); strings.HasPrefix(n, oid+".") {
				out[n[len(oid)+1:]] = p
			}
		}
		return out
	}
	descr := col(oidIfDescr)
	if len(descr) == 0 {
		d.Error = "L'équipement ne publie pas la table des interfaces (IF-MIB) : vérifiez la vue SNMP autorisée"
		return d
	}
	name, alias, oper := col(oidIfName), col(oidIfAlias), col(oidIfOperStatus)
	speed, high := col(oidIfSpeed), col(oidIfHighSpeed)
	in32, out32, in64, out64 := col(oidIfInOctets), col(oidIfOutOctets), col(oidIfHCIn), col(oidIfHCOut)
	addrs := map[int][]string{}
	for ip, p := range col(oidIPAddrIf) {
		i := int(gosnmp.ToBigInt(p.Value).Int64())
		addrs[i] = append(addrs[i], ip)
	}
	routes := map[int]bool{}
	for _, c := range []map[string]gosnmp.SnmpPDU{col(oidCidrIf + ".0.0.0.0.0.0.0.0"), col(oidInetIf + ".1.4.0.0.0.0.0")} {
		for _, p := range c {
			routes[int(gosnmp.ToBigInt(p.Value).Int64())] = true
		}
	}
	// ipRouteIfIndex.0.0.0.0 is a single instance, read directly.
	if p, err := g.Get([]string{oidRouteIf + ".0.0.0.0"}); err == nil && len(p.Variables) == 1 && pduOK(p.Variables[0]) {
		routes[int(gosnmp.ToBigInt(p.Variables[0].Value).Int64())] = true
	}
	counter := func(hc, c32 map[string]gosnmp.SnmpPDU, k string) *uint64 {
		for _, c := range []map[string]gosnmp.SnmpPDU{hc, c32} {
			if p, ok := c[k]; ok && pduOK(p) {
				n := gosnmp.ToBigInt(p.Value).Uint64()
				return &n
			}
		}
		return nil
	}
	for k, p := range descr {
		i, err := strconv.Atoi(k)
		if err != nil {
			continue
		}
		f := snmpIface{Index: i, Descr: pduString(p), Name: pduString(name[k]), Alias: pduString(alias[k]),
			InOctets: counter(in64, in32, k), OutOctets: counter(out64, out32, k), Addresses: addrs[i], DefaultRoute: routes[i], Probes: []snmpIfProbe{}}
		if f.Addresses == nil {
			f.Addresses = []string{}
		}
		sort.Strings(f.Addresses)
		st := int(gosnmp.ToBigInt(oper[k].Value).Int64())
		f.Up, f.Status = st == 1, ifOperStatus[st]
		if hs := gosnmp.ToBigInt(high[k].Value).Int64(); pduOK(high[k]) && hs > 0 {
			v := float64(hs)
			f.Speed = &v
		} else if sp := gosnmp.ToBigInt(speed[k].Value).Int64(); pduOK(speed[k]) && sp > 0 {
			v := float64(sp) / 1e6
			f.Speed = &v
		}
		f.Role = ifRole(&f)
		f.Hint = ifRoleHints[f.Role]
		d.Interfaces = append(d.Interfaces, f)
	}
	sort.Slice(d.Interfaces, func(a, b int) bool {
		x, y := d.Interfaces[a], d.Interfaces[b]
		if ifRoleOrder[x.Role] != ifRoleOrder[y.Role] {
			return ifRoleOrder[x.Role] < ifRoleOrder[y.Role]
		}
		return x.Index < y.Index
	})
	return d
}

func pduOK(p gosnmp.SnmpPDU) bool {
	switch p.Type {
	case gosnmp.NoSuchObject, gosnmp.NoSuchInstance, gosnmp.EndOfMibView, gosnmp.Null, 0:
		return false
	}
	return true
}

func pduString(p gosnmp.SnmpPDU) string {
	b, _ := p.Value.([]byte)
	return strings.TrimSpace(string(b))
}

// attachProbes lists, on each interface, the probes of the device that read it.
func attachProbes(d *snmpDevice, mons []Monitor) {
	for _, m := range mons {
		if m.Type != "snmp" || m.Config.SNMPMode == "" || !strings.EqualFold(m.Target, d.Target) {
			continue
		}
		for i := range d.Interfaces {
			f := &d.Interfaces[i]
			if strconv.Itoa(f.Index) == m.Config.Interface || ifNameEq(f.Name, m.Config.Interface) || ifNameEq(f.Descr, m.Config.Interface) || ifNameEq(f.Alias, m.Config.Interface) {
				f.Probes = append(f.Probes, snmpIfProbe{m.ID, m.Name, m.Config.SNMPMode})
				break
			}
		}
	}
}

// snmpDeviceKey groups the probes that reach one device with the same credentials.
func snmpDeviceKey(m *Monitor) string {
	c := &m.Config
	return strings.Join([]string{strings.ToLower(m.Target), c.SNMPVersion, c.Community, c.SNMPUser, c.AuthProto, c.AuthPass, c.PrivProto, c.PrivPass}, "\x00")
}

// handleSNMPDevices discovers every device read by an SNMP probe (?target= for one), with the
// saved credentials of its probes.
func (s *Server) handleSNMPDevices(w http.ResponseWriter, r *http.Request) {
	mons, err := s.loadMonitors(`WHERE type='snmp'`)
	if err != nil {
		serverErr(w, err)
		return
	}
	want := strings.ToLower(r.URL.Query().Get("target"))
	var firsts []*Monitor
	seen := map[string]bool{}
	for i := range mons {
		m := &mons[i]
		if k := snmpDeviceKey(m); !seen[k] && (want == "" || strings.ToLower(m.Target) == want) {
			seen[k] = true
			firsts = append(firsts, m)
		}
	}
	devices := make([]*snmpDevice, len(firsts))
	var wg sync.WaitGroup
	for i, m := range firsts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
			defer cancel()
			devices[i] = snmpDiscover(ctx, m)
			attachProbes(devices[i], mons)
		}()
	}
	wg.Wait()
	writeJSON(w, 200, map[string]any{"devices": devices})
}

// handleSNMPDiscover reads a device from the probe form, before the probe exists. With "id",
// the secrets left empty in an edit form are the saved ones.
func (s *Server) handleSNMPDiscover(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID     int64         `json:"id"`
		Target string        `json:"target"`
		Config MonitorConfig `json:"config"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	m := Monitor{Type: "snmp", Target: strings.TrimSpace(in.Target), Config: in.Config}
	if in.ID > 0 {
		if old, err := s.loadMonitors(`WHERE id=?`, in.ID); err == nil && len(old) == 1 {
			m.Config.keepSecrets(old[0].Config)
		}
	}
	// Validate the device and credentials only: the measure is chosen after the discovery.
	m.Config.SNMPMode, m.Config.Interface, m.Config.MaxPercent, m.Config.IdleMinutes = "ifstatus", "découverte", nil, 0
	if msg := validateSNMP(&m); msg != "" {
		writeErr(w, 400, msg)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	d := snmpDiscover(ctx, &m)
	if d.Error != "" {
		writeErr(w, 502, d.Error)
		return
	}
	if mons, err := s.loadMonitors(`WHERE type='snmp'`); err == nil {
		attachProbes(d, mons)
	}
	writeJSON(w, 200, d)
}
