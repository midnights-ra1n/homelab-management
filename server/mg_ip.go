package main

// IPv4 helpers for the IPAM (port of homelab-management's lib/ip.ts; the web UI keeps its own copy).

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

func ipToInt(ip string) (uint32, bool) {
	parts := strings.Split(strings.TrimSpace(ip), ".")
	if len(parts) != 4 {
		return 0, false
	}
	var n uint32
	for _, p := range parts {
		if len(p) == 0 || len(p) > 3 || strings.Trim(p, "0123456789") != "" {
			return 0, false
		}
		v, _ := strconv.Atoi(p)
		if v > 255 {
			return 0, false
		}
		n = n<<8 | uint32(v)
	}
	return n, true
}

func intToIP(n uint32) string {
	return fmt.Sprintf("%d.%d.%d.%d", n>>24, n>>16&255, n>>8&255, n&255)
}

func isIPv4(ip string) bool { _, ok := ipToInt(ip); return ok }

type cidr struct {
	network, size uint64
	prefix        int
	first, last   uint64
}

// parseCidr accepts prefixes /8 to /32; /31 and /32 have every address usable.
func parseCidr(s string) (cidr, bool) {
	addr, pfx, ok := strings.Cut(strings.TrimSpace(s), "/")
	base, ok2 := ipToInt(addr)
	prefix, err := strconv.Atoi(pfx)
	if !ok || !ok2 || err != nil || prefix < 8 || prefix > 32 {
		return cidr{}, false
	}
	size := uint64(1) << (32 - prefix)
	network := uint64(base) / size * size
	c := cidr{network: network, size: size, prefix: prefix, first: network + 1, last: network + size - 2}
	if prefix >= 31 {
		c.first, c.last = network, network+size-1
	}
	return c, true
}

func normalizeCidr(s string) (string, bool) {
	c, ok := parseCidr(s)
	if !ok {
		return "", false
	}
	return fmt.Sprintf("%s/%d", intToIP(uint32(c.network)), c.prefix), true
}

func cidrContains(s, ip string) bool {
	c, ok := parseCidr(s)
	n, ok2 := ipToInt(ip)
	return ok && ok2 && uint64(n) >= c.network && uint64(n) < c.network+c.size
}

func cidrOverlap(a, b string) bool {
	x, ok1 := parseCidr(a)
	y, ok2 := parseCidr(b)
	return ok1 && ok2 && x.network < y.network+y.size && y.network < x.network+x.size
}

func usableHosts(s string) int64 {
	c, ok := parseCidr(s)
	if !ok {
		return 0
	}
	return int64(c.last - c.first + 1)
}

var portSpecRe = regexp.MustCompile(`^(\d{1,5})(?:-(\d{1,5}))?$`)

// validPortSpec accepts "22,80,443,8000-8100" (empty means every port).
func validPortSpec(spec string) bool {
	if strings.TrimSpace(spec) == "" {
		return true
	}
	for _, p := range strings.Split(spec, ",") {
		m := portSpecRe.FindStringSubmatch(strings.TrimSpace(p))
		if m == nil {
			return false
		}
		a, _ := strconv.Atoi(m[1])
		b := a
		if m[2] != "" {
			b, _ = strconv.Atoi(m[2])
		}
		if a < 1 || b > 65535 || a > b {
			return false
		}
	}
	return true
}

// findSubnetFor returns the most specific subnet containing the address, or nil.
func (s *Server) findSubnetFor(q execer, address string) any {
	n, ok := ipToInt(address)
	if !ok {
		return nil
	}
	rows, err := q.Query(`SELECT id, cidr FROM subnets`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var best any
	bestPrefix := -1
	for rows.Next() {
		var id int64
		var c string
		if rows.Scan(&id, &c) != nil {
			continue
		}
		if p, ok := parseCidr(c); ok && uint64(n) >= p.network && uint64(n) < p.network+p.size && p.prefix > bestPrefix {
			best, bestPrefix = id, p.prefix
		}
	}
	return best
}
