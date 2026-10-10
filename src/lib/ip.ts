/** Utilitaires IPv4 pour l'IPAM. */

export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function isIpv4(ip: string) {
  return ipToInt(ip) !== null;
}

export type Cidr = { network: number; prefix: number; size: number; first: number; last: number };

export function parseCidr(cidr: string): Cidr | null {
  const [addr, prefixStr] = cidr.trim().split("/");
  const prefix = Number(prefixStr);
  const base = ipToInt(addr ?? "");
  if (base === null || !Number.isInteger(prefix) || prefix < 8 || prefix > 32) return null;
  const size = 2 ** (32 - prefix);
  const network = Math.floor(base / size) * size;
  // /31 et /32 : toutes les adresses sont utilisables
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? network + size - 1 : network + size - 2;
  return { network, prefix, size, first, last };
}

export function normalizeCidr(cidr: string): string | null {
  const c = parseCidr(cidr);
  return c ? `${intToIp(c.network)}/${c.prefix}` : null;
}

export function cidrContains(cidr: string, ip: string) {
  const c = parseCidr(cidr);
  const n = ipToInt(ip);
  return !!c && n !== null && n >= c.network && n < c.network + c.size;
}

export function usableHosts(cidr: string) {
  const c = parseCidr(cidr);
  return c ? c.last - c.first + 1 : 0;
}

export function compareIp(a: string, b: string) {
  return (ipToInt(a) ?? 0) - (ipToInt(b) ?? 0);
}

/** Les deux CIDR se recouvrent-ils ? */
export function cidrOverlap(a: string, b: string) {
  const x = parseCidr(a);
  const y = parseCidr(b);
  if (!x || !y) return false;
  return x.network < y.network + y.size && y.network < x.network + x.size;
}

export function isNetworkOrBroadcast(cidr: string, ip: string) {
  const c = parseCidr(cidr);
  const n = ipToInt(ip);
  if (!c || n === null || c.prefix >= 31) return null;
  if (n === c.network) return "network" as const;
  if (n === c.network + c.size - 1) return "broadcast" as const;
  return null;
}

/** Plages privées / spéciales (RFC 1918, CGNAT Tailscale, loopback, link-local). */
export function isPrivateIp(ip: string) {
  return ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16"].some((c) =>
    cidrContains(c, ip),
  );
}

export function ipInRange(ip: string, start: string, end: string) {
  const n = ipToInt(ip);
  const s = ipToInt(start);
  const e = ipToInt(end);
  return n !== null && s !== null && e !== null && n >= s && n <= e;
}

/** « 22,80,443,8000-8100 » → vrai si le port est couvert (liste vide = tous les ports). */
export function portMatches(spec: string, port: number | null) {
  const parts = spec
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return true;
  if (port === null) return false;
  return parts.some((p) => {
    const [a, b] = p.split("-").map(Number);
    return b === undefined || Number.isNaN(b) ? a === port : port >= a && port <= b;
  });
}

export function isValidPortSpec(spec: string) {
  if (!spec.trim()) return true;
  return spec.split(",").every((p) => {
    const m = p.trim().match(/^(\d{1,5})(?:-(\d{1,5}))?$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    return a >= 1 && b <= 65535 && a <= b;
  });
}
