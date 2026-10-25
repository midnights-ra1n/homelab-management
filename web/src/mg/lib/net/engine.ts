/**
 * Moteur réseau (fonctions pures sur un instantané de l'IPAM) :
 * contrôle d'une IP, diagnostic global, simulation d'un paquet.
 */
import { VPN_TYPE_META, type FwProtocol, type FwTarget, type VpnType } from "../constants";
import {
  cidrContains,
  cidrOverlap,
  ipInRange,
  ipToInt,
  isIpv4,
  isNetworkOrBroadcast,
  isPrivateIp,
  parseCidr,
  portMatches,
} from "../ip";

/* --------------------------------------------------------------------------
 * Instantané
 * ------------------------------------------------------------------------ */

export type NetSubnet = {
  id: number;
  name: string;
  cidr: string;
  gateway: string;
  dhcp_start: string;
  dhcp_end: string;
  vlan_id: number | null; // id de ligne VLAN
  vlan_number: number | null;
  vlan_name: string | null;
  used: number;
  reserved: number;
  dhcp: number;
  capacity: number;
};

export type NetIp = {
  id: number;
  address: string;
  subnet_id: number | null;
  asset_id: number | null;
  asset_name: string | null;
  mac: string;
  status: string;
};

export type NetAsset = {
  id: number;
  display_name: string;
  hostname: string;
  kind: string;
  status: string;
  role: string;
  docker_ports: string;
};

export type NetTunnel = {
  id: number;
  name: string;
  type: VpnType;
  status: string;
  endpoint_a_id: number | null;
  endpoint_b_id: number | null;
  endpoint_a_name: string | null;
  endpoint_b_name: string | null;
  endpoint_b_label: string;
  tunnel_cidr: string;
  ip_a: string;
  ip_b: string;
  routes_a: string[];
  routes_b: string[];
};

export type NetRule = {
  id: number;
  position: number;
  name: string;
  enabled: number;
  action: "allow" | "deny";
  src_type: FwTarget;
  src_value: string;
  dst_type: FwTarget;
  dst_value: string;
  protocol: FwProtocol;
  ports: string;
};

export type NetSnapshot = {
  subnets: NetSubnet[];
  ips: NetIp[];
  assets: NetAsset[];
  tunnels: NetTunnel[];
  rules: NetRule[];
  defaultPolicy: "allow" | "deny";
};

export type Issue = {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  href?: string;
};

/** Sous-réseau le plus spécifique contenant l'IP. */
export function subnetOf(snap: NetSnapshot, ip: string): NetSubnet | undefined {
  return snap.subnets
    .filter((s) => cidrContains(s.cidr, ip))
    .sort((a, b) => (parseCidr(b.cidr)?.prefix ?? 0) - (parseCidr(a.cidr)?.prefix ?? 0))[0];
}

/* --------------------------------------------------------------------------
 * Contrôle d'une adresse (formulaires, en direct)
 * ------------------------------------------------------------------------ */

export function checkIp(
  snap: NetSnapshot,
  address: string,
  ctx: { subnetId?: number | null; assetId?: number | null; ipId?: number | null } = {},
): Issue[] {
  const issues: Issue[] = [];
  const ip = address.trim();
  if (!ip) return issues;
  if (!isIpv4(ip)) return [{ level: "error", code: "invalid", message: "Adresse IPv4 invalide" }];

  const existing = snap.ips.find((i) => i.address === ip && i.id !== ctx.ipId);
  if (existing && (!ctx.assetId || existing.asset_id !== ctx.assetId)) {
    if (existing.asset_id) {
      issues.push({
        level: "error",
        code: "duplicate",
        message: `Déjà attribuée à « ${existing.asset_name} »`,
        href: `/inventaire/${existing.asset_id}`,
      });
    } else if (existing.status === "reserved") {
      issues.push({ level: "warning", code: "reserved", message: "Adresse réservée dans l'IPAM (elle sera reprise)" });
    } else {
      issues.push({ level: "warning", code: "known", message: `Déjà présente dans l'IPAM (${existing.status})` });
    }
  }

  const chosen = ctx.subnetId ? snap.subnets.find((s) => s.id === ctx.subnetId) : undefined;
  if (chosen && !cidrContains(chosen.cidr, ip)) {
    issues.push({ level: "error", code: "outside", message: `Hors du sous-réseau choisi (${chosen.cidr})` });
    return issues;
  }
  const subnet = chosen ?? subnetOf(snap, ip);
  if (!subnet) {
    issues.push({
      level: isPrivateIp(ip) ? "warning" : "info",
      code: "no-subnet",
      message: isPrivateIp(ip) ? "Aucun sous-réseau déclaré ne contient cette adresse" : "Adresse publique (hors IPAM)",
    });
    return issues;
  }
  const edge = isNetworkOrBroadcast(subnet.cidr, ip);
  if (edge) {
    issues.push({
      level: "error",
      code: edge,
      message: edge === "network" ? `Adresse réseau de ${subnet.cidr}` : `Adresse de broadcast de ${subnet.cidr}`,
    });
  }
  if (subnet.gateway && subnet.gateway === ip) {
    issues.push({ level: "warning", code: "gateway", message: `C'est la passerelle de « ${subnet.name} »` });
  }
  if (!issues.length) {
    issues.push({
      level: "info",
      code: "ok",
      message: `Libre · ${subnet.name}${subnet.vlan_number ? ` · VLAN ${subnet.vlan_number}` : ""}`,
    });
  }
  return issues;
}

/* --------------------------------------------------------------------------
 * Diagnostic global
 * ------------------------------------------------------------------------ */

export function diagnose(snap: NetSnapshot): Issue[] {
  const out: Issue[] = [];
  const net = (id: number | null) => (id ? `/reseau?subnet=${id}` : "/reseau");

  // Sous-réseaux qui se chevauchent
  for (let i = 0; i < snap.subnets.length; i++) {
    for (let j = i + 1; j < snap.subnets.length; j++) {
      const a = snap.subnets[i];
      const b = snap.subnets[j];
      if (cidrOverlap(a.cidr, b.cidr)) {
        out.push({ level: "error", code: "overlap", message: `${a.cidr} (${a.name}) chevauche ${b.cidr} (${b.name})`, href: net(a.id) });
      }
    }
  }

  for (const s of snap.subnets) {
    if (!s.gateway) out.push({ level: "info", code: "no-gateway", message: `« ${s.name} » n'a pas de passerelle : pas de routage possible`, href: net(s.id) });
    if (s.dhcp_start && s.dhcp_end && (ipToInt(s.dhcp_start) ?? 0) > (ipToInt(s.dhcp_end) ?? 0)) {
      out.push({ level: "error", code: "dhcp-order", message: `Plage DHCP inversée sur « ${s.name} »`, href: net(s.id) });
    }
    if (s.gateway && s.dhcp_start && s.dhcp_end && ipInRange(s.gateway, s.dhcp_start, s.dhcp_end)) {
      out.push({ level: "warning", code: "gw-dhcp", message: `La passerelle de « ${s.name} » est dans sa plage DHCP`, href: net(s.id) });
    }
    const fill = s.capacity ? (s.used + s.reserved + s.dhcp) / s.capacity : 0;
    if (fill >= 0.9) out.push({ level: "warning", code: "full", message: `« ${s.name} » est rempli à ${Math.round(fill * 100)} %`, href: net(s.id) });
  }

  // Adresses
  const macs = new Map<string, NetIp[]>();
  for (const ip of snap.ips) {
    const s = ip.subnet_id ? snap.subnets.find((x) => x.id === ip.subnet_id) : undefined;
    const who = ip.asset_name ? ` (${ip.asset_name})` : "";
    if (s && !cidrContains(s.cidr, ip.address)) {
      out.push({ level: "error", code: "ip-outside", message: `${ip.address}${who} est hors de son sous-réseau ${s.cidr}`, href: net(s.id) });
    }
    if (s) {
      const edge = isNetworkOrBroadcast(s.cidr, ip.address);
      if (edge) out.push({ level: "error", code: "ip-edge", message: `${ip.address}${who} est l'adresse ${edge === "network" ? "réseau" : "de broadcast"}`, href: net(s.id) });
      if (s.gateway === ip.address && ip.asset_id) {
        const a = snap.assets.find((x) => x.id === ip.asset_id);
        if (a && a.kind !== "network") {
          out.push({ level: "info", code: "ip-gw", message: `${ip.address} (passerelle) est attribuée à « ${a.display_name} » (${a.kind})`, href: `/inventaire/${a.id}` });
        }
      }
    } else if (isPrivateIp(ip.address)) {
      out.push({ level: "warning", code: "ip-orphan", message: `${ip.address}${who} n'appartient à aucun sous-réseau déclaré`, href: "/reseau" });
    }
    if (ip.mac) macs.set(ip.mac, [...(macs.get(ip.mac) ?? []), ip]);
  }
  for (const [mac, list] of macs) {
    const owners = new Set(list.map((l) => l.asset_id ?? `ip${l.id}`));
    if (owners.size > 1) out.push({ level: "warning", code: "mac-dup", message: `MAC ${mac} utilisée par ${list.map((l) => l.address).join(", ")}` });
  }

  // Noms d'hôte en double
  const hosts = new Map<string, NetAsset[]>();
  for (const a of snap.assets) if (a.hostname && a.status !== "decommissioned") hosts.set(a.hostname, [...(hosts.get(a.hostname) ?? []), a]);
  for (const [h, list] of hosts) {
    if (list.length > 1) out.push({ level: "warning", code: "host-dup", message: `Nom d'hôte « ${h} » utilisé ${list.length} fois`, href: `/inventaire?q=${encodeURIComponent(h)}` });
  }

  // VPN
  for (const t of snap.tunnels) {
    if (t.tunnel_cidr) {
      for (const s of snap.subnets) {
        if (cidrOverlap(t.tunnel_cidr, s.cidr)) {
          out.push({ level: "error", code: "vpn-overlap", message: `Le réseau du tunnel « ${t.name} » (${t.tunnel_cidr}) chevauche ${s.cidr}`, href: "/reseau?onglet=vpn" });
        }
      }
      for (const [side, ip] of [["A", t.ip_a], ["B", t.ip_b]] as const) {
        if (ip && !cidrContains(t.tunnel_cidr, ip)) out.push({ level: "error", code: "vpn-ip", message: `IP ${side} du tunnel « ${t.name} » hors de ${t.tunnel_cidr}`, href: "/reseau?onglet=vpn" });
      }
    }
    if (!t.endpoint_a_id) out.push({ level: "warning", code: "vpn-endpoint", message: `Tunnel « ${t.name} » sans extrémité A dans l'inventaire`, href: "/reseau?onglet=vpn" });
    for (const r of t.routes_a) for (const q of t.routes_b) {
      if (cidrOverlap(r, q)) out.push({ level: "warning", code: "vpn-routes", message: `Tunnel « ${t.name} » : ${r} et ${q} annoncés des deux côtés`, href: "/reseau?onglet=vpn" });
    }
  }

  // Pare-feu : règles pointant vers des objets supprimés
  for (const r of snap.rules) {
    for (const [type, value] of [[r.src_type, r.src_value], [r.dst_type, r.dst_value]] as const) {
      const missing =
        (type === "vlan" && !snap.subnets.some((s) => String(s.vlan_id) === value)) ||
        (type === "subnet" && !snap.subnets.some((s) => String(s.id) === value)) ||
        (type === "asset" && !snap.assets.some((a) => String(a.id) === value)) ||
        (type === "vpn" && !snap.tunnels.some((t) => String(t.id) === value));
      if (missing) out.push({ level: "warning", code: "rule-orphan", message: `Règle « ${r.name || "#" + r.id} » : la cible ${type} n'existe plus (ou n'a aucun sous-réseau)`, href: "/reseau?onglet=pare-feu" });
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/* --------------------------------------------------------------------------
 * Simulation de paquet
 * ------------------------------------------------------------------------ */

export type SimEndpoint = { kind: "asset"; id: number } | { kind: "ip"; ip: string };

export type SimInput = {
  src: SimEndpoint;
  dst: SimEndpoint;
  protocol: Exclude<FwProtocol, "any">;
  port: number | null;
};

export type HopKind = "host" | "switch" | "router" | "firewall" | "vpn" | "internet";

export type Hop = {
  kind: HopKind;
  label: string;
  sub?: string;
  status: "ok" | "fail" | "warn";
  detail: string;
};

export type SimResult = {
  ok: boolean;
  summary: string;
  srcIp: string | null;
  dstIp: string | null;
  hops: Hop[];
  rule?: { id: number | null; name: string; action: "allow" | "deny" };
  warnings: string[];
};

function primaryIp(snap: NetSnapshot, assetId: number) {
  return snap.ips.find((i) => i.asset_id === assetId)?.address ?? null;
}

function assetByIp(snap: NetSnapshot, ip: string) {
  const rec = snap.ips.find((i) => i.address === ip && i.asset_id);
  return rec ? snap.assets.find((a) => a.id === rec.asset_id) : undefined;
}

/** Réseaux joignables de chaque côté d'un tunnel. */
function tunnelSides(snap: NetSnapshot, t: NetTunnel) {
  const side = (assetId: number | null, routes: string[], tunnelIp: string) => {
    const nets = [...routes];
    const ip = assetId ? primaryIp(snap, assetId) : null;
    const s = ip ? subnetOf(snap, ip) : undefined;
    if (s) nets.push(s.cidr);
    return { nets, ip, tunnelIp };
  };
  return { a: side(t.endpoint_a_id, t.routes_a, t.ip_a), b: side(t.endpoint_b_id, t.routes_b, t.ip_b) };
}

function inNets(nets: string[], ip: string) {
  return nets.some((c) => cidrContains(c, ip));
}

/** L'IP appartient-elle à la cible d'une règle ? */
function targetMatches(snap: NetSnapshot, type: FwTarget, value: string, ip: string, via: NetTunnel | null) {
  switch (type) {
    case "any":
      return true;
    case "internet":
      return !isPrivateIp(ip) && !subnetOf(snap, ip);
    case "cidr":
      return !!value && cidrContains(value, ip);
    case "subnet": {
      const s = snap.subnets.find((x) => String(x.id) === value);
      return !!s && cidrContains(s.cidr, ip);
    }
    case "vlan":
      return snap.subnets.some((s) => String(s.vlan_id) === value && cidrContains(s.cidr, ip));
    case "asset":
      return snap.ips.some((i) => String(i.asset_id) === value && i.address === ip);
    case "vpn": {
      const t = snap.tunnels.find((x) => String(x.id) === value);
      if (!t) return false;
      if (via?.id === t.id) return true;
      return (!!t.tunnel_cidr && cidrContains(t.tunnel_cidr, ip)) || t.ip_a === ip || t.ip_b === ip;
    }
  }
}

function evaluateRules(snap: NetSnapshot, src: string, dst: string, protocol: SimInput["protocol"], port: number | null, via: NetTunnel | null) {
  for (const r of [...snap.rules].sort((a, b) => a.position - b.position || a.id - b.id)) {
    if (!r.enabled) continue;
    if (r.protocol !== "any" && r.protocol !== protocol) continue;
    if (protocol !== "icmp" && !portMatches(r.ports, port)) continue;
    if (protocol === "icmp" && r.ports) continue;
    if (!targetMatches(snap, r.src_type, r.src_value, src, via)) continue;
    if (!targetMatches(snap, r.dst_type, r.dst_value, dst, via)) continue;
    return { id: r.id, name: r.name || `Règle #${r.position + 1}`, action: r.action };
  }
  return { id: null, name: "Politique par défaut", action: snap.defaultPolicy };
}

function segment(s: NetSubnet | undefined) {
  if (!s) return "Réseau inconnu";
  return s.vlan_number ? `VLAN ${s.vlan_number} · ${s.vlan_name}` : `${s.name} (non tagué)`;
}

function hostHop(snap: NetSnapshot, ip: string, label: string, assetId?: number): Hop {
  const asset = assetId ? snap.assets.find((a) => a.id === assetId) : assetByIp(snap, ip);
  if (!asset) {
    const known = snap.ips.some((i) => i.address === ip && i.status !== "free");
    return known
      ? { kind: "host", label, sub: ip, status: "warn", detail: "Adresse connue de l'IPAM mais sans élément d'inventaire associé" }
      : { kind: "host", label, sub: ip, status: "fail", detail: "Aucun hôte n'a cette adresse : la requête ARP reste sans réponse" };
  }
  if (asset.status === "offline" || asset.status === "decommissioned") {
    return { kind: "host", label: asset.display_name, sub: ip, status: "fail", detail: `Hôte ${asset.status === "offline" ? "hors ligne" : "retiré"}` };
  }
  if (asset.status === "planned") {
    return { kind: "host", label: asset.display_name, sub: ip, status: "warn", detail: "Hôte encore planifié (pas encore déployé)" };
  }
  return { kind: "host", label: asset.display_name, sub: ip, status: "ok", detail: asset.status === "maintenance" ? "En maintenance" : "Reçu" };
}

function routerHop(snap: NetSnapshot, s: NetSubnet): Hop {
  const router = assetByIp(snap, s.gateway);
  return {
    kind: "router",
    label: router?.display_name ?? "Passerelle",
    sub: s.gateway,
    status: "ok",
    detail: `Passerelle de ${s.name} : routage vers un autre réseau`,
  };
}

export function simulate(snap: NetSnapshot, input: SimInput): SimResult {
  const warnings: string[] = [];
  const hops: Hop[] = [];
  const fail = (summary: string, srcIp: string | null, dstIp: string | null, rule?: SimResult["rule"]): SimResult => ({
    ok: false,
    summary,
    srcIp,
    dstIp,
    hops,
    rule,
    warnings,
  });

  // 1. Résolution des extrémités
  const srcIp = input.src.kind === "asset" ? primaryIp(snap, input.src.id) : input.src.ip.trim();
  const dstIp = input.dst.kind === "asset" ? primaryIp(snap, input.dst.id) : input.dst.ip.trim();
  if (!srcIp || !isIpv4(srcIp)) return fail("La source n'a pas d'adresse IP", srcIp, dstIp);
  if (!dstIp || !isIpv4(dstIp)) return fail("La destination n'a pas d'adresse IP", srcIp, dstIp);
  if (srcIp === dstIp) return fail("Source et destination identiques", srcIp, dstIp);

  const src = input.src;
  const srcAsset = src.kind === "asset" ? snap.assets.find((a) => a.id === src.id) : assetByIp(snap, srcIp);
  const srcNet = subnetOf(snap, srcIp);
  const dstNet = subnetOf(snap, dstIp);
  const proto = input.protocol.toUpperCase() + (input.protocol !== "icmp" && input.port ? `/${input.port}` : "");

  const srcHop: Hop = {
    kind: "host",
    label: srcAsset?.display_name ?? "Source",
    sub: srcIp,
    status: srcAsset && (srcAsset.status === "offline" || srcAsset.status === "decommissioned") ? "fail" : "ok",
    detail: `Émet un paquet ${proto} vers ${dstIp}`,
  };
  hops.push(srcHop);
  if (srcHop.status === "fail") return fail("La source est hors ligne", srcIp, dstIp);
  if (!srcNet) {
    hops.push({ kind: "switch", label: "Réseau inconnu", status: "fail", detail: "La source n'appartient à aucun sous-réseau déclaré" });
    return fail("Source hors IPAM : impossible de déterminer sa passerelle", srcIp, dstIp);
  }

  // 2. Même sous-réseau : commutation L2, pas de pare-feu
  if (dstNet && dstNet.id === srcNet.id) {
    hops.push({ kind: "switch", label: "Commutateur", sub: segment(srcNet), status: "ok", detail: "Même sous-réseau : livraison directe (couche 2), sans routage ni pare-feu" });
    const h = hostHop(snap, dstIp, "Destination", input.dst.kind === "asset" ? input.dst.id : undefined);
    hops.push(h);
    portWarning(snap, dstIp, input, warnings);
    return { ok: h.status !== "fail", summary: h.status === "fail" ? h.detail : "Le paquet arrive à destination", srcIp, dstIp, hops, warnings };
  }

  // 3. Sortie du sous-réseau : passerelle obligatoire
  hops.push({ kind: "switch", label: "Commutateur", sub: segment(srcNet), status: "ok", detail: "Destination hors du sous-réseau : envoi à la passerelle" });
  if (!srcNet.gateway) {
    hops.push({ kind: "router", label: "Passerelle", status: "fail", detail: `« ${srcNet.name} » n'a pas de passerelle déclarée` });
    return fail("Pas de passerelle sur le sous-réseau source", srcIp, dstIp);
  }
  hops.push(routerHop(snap, srcNet));

  // 4. Route : LAN, VPN ou Internet ?
  let via: NetTunnel | null = null;
  let viaSide: "ab" | "ba" = "ab";
  for (const t of snap.tunnels) {
    const sides = tunnelSides(snap, t);
    const inA = (ip: string) => inNets(sides.a.nets, ip) || ip === t.ip_a;
    const inB = (ip: string) => inNets(sides.b.nets, ip) || ip === t.ip_b || (!!t.tunnel_cidr && cidrContains(t.tunnel_cidr, ip) && ip !== t.ip_a);
    if (inA(srcIp) && inB(dstIp) && !inA(dstIp)) {
      via = t;
      viaSide = "ab";
      break;
    }
    if (inB(srcIp) && inA(dstIp) && !inB(dstIp)) {
      via = t;
      viaSide = "ba";
      break;
    }
  }

  if (!dstNet && !via && isPrivateIp(dstIp)) {
    hops.push({ kind: "router", label: "Table de routage", status: "fail", detail: `Aucune route vers ${dstIp} (ni sous-réseau déclaré, ni tunnel VPN)` });
    return fail("Destination injoignable : aucune route", srcIp, dstIp);
  }

  // 5. Pare-feu
  const rule = evaluateRules(snap, srcIp, dstIp, input.protocol, input.port, via);
  hops.push({
    kind: "firewall",
    label: "Pare-feu",
    sub: rule.name,
    status: rule.action === "allow" ? "ok" : "fail",
    detail: rule.action === "allow" ? `Autorisé par « ${rule.name} »` : `Bloqué par « ${rule.name} »`,
  });
  if (rule.action === "deny") return fail(`Bloqué par le pare-feu (${rule.name})`, srcIp, dstIp, rule);

  // 6. Tunnel VPN
  if (via) {
    const meta = VPN_TYPE_META[via.type];
    const [from, to] =
      viaSide === "ab"
        ? [via.endpoint_a_name ?? "Extrémité A", via.endpoint_b_name ?? (via.endpoint_b_label || "Extrémité B")]
        : [via.endpoint_b_name ?? (via.endpoint_b_label || "Extrémité B"), via.endpoint_a_name ?? "Extrémité A"];
    const up = via.status === "up";
    hops.push({
      kind: "vpn",
      label: `${meta.label} · ${via.name}`,
      sub: `${from} → ${to}`,
      status: up ? "ok" : "fail",
      detail: up ? `Encapsulé dans le tunnel${via.tunnel_cidr ? ` (${via.tunnel_cidr})` : ""}` : `Tunnel ${via.status === "planned" ? "pas encore déployé" : "coupé"}`,
    });
    if (!up) return fail(`Tunnel « ${via.name} » indisponible`, srcIp, dstIp, rule);
    const isTunnelIp = dstIp === via.ip_a || dstIp === via.ip_b;
    if (!isTunnelIp && dstNet) hops.push({ kind: "switch", label: "Commutateur", sub: segment(dstNet), status: "ok", detail: "Livraison sur le réseau distant" });
    const h = isTunnelIp
      ? { kind: "host" as const, label: dstIp === via.ip_a ? from : to, sub: dstIp, status: "ok" as const, detail: "Adresse de tunnel atteinte" }
      : dstNet
        ? hostHop(snap, dstIp, "Destination", input.dst.kind === "asset" ? input.dst.id : undefined)
        : { kind: "host" as const, label: "Destination distante", sub: dstIp, status: "warn" as const, detail: "Réseau annoncé par le tunnel mais non décrit dans l'IPAM" };
    hops.push(h);
    portWarning(snap, dstIp, input, warnings);
    return { ok: h.status !== "fail", summary: h.status === "fail" ? h.detail : "Le paquet traverse le tunnel et arrive à destination", srcIp, dstIp, hops, rule, warnings };
  }

  // 7. Internet
  if (!dstNet) {
    hops.push({ kind: "internet", label: "Internet", sub: dstIp, status: "ok", detail: "Sortie vers Internet (NAT via la passerelle)" });
    warnings.push("La joignabilité réelle sur Internet n'est pas vérifiable hors ligne.");
    return { ok: true, summary: "Le paquet sort vers Internet", srcIp, dstIp, hops, rule, warnings };
  }

  // 8. Autre sous-réseau local
  if (!dstNet.gateway) warnings.push(`« ${dstNet.name} » n'a pas de passerelle : la réponse ne pourra pas revenir.`);
  hops.push({ kind: "switch", label: "Commutateur", sub: segment(dstNet), status: "ok", detail: `Routé vers ${dstNet.name}` });
  const h = hostHop(snap, dstIp, "Destination", input.dst.kind === "asset" ? input.dst.id : undefined);
  hops.push(h);
  portWarning(snap, dstIp, input, warnings);
  const back = evaluateRules(snap, dstIp, srcIp, input.protocol, null, null);
  if (back.action === "deny") warnings.push(`Le trafic retour initié par la destination est bloqué (${back.name}) : normal si le pare-feu est à états.`);
  return { ok: h.status !== "fail", summary: h.status === "fail" ? h.detail : "Le paquet arrive à destination", srcIp, dstIp, hops, rule, warnings };
}

function portWarning(snap: NetSnapshot, dstIp: string, input: SimInput, warnings: string[]) {
  if (input.protocol === "icmp" || !input.port) return;
  const a = assetByIp(snap, dstIp);
  if (!a?.docker_ports) return;
  const exposed = a.docker_ports
    .split(/[,\s]+/)
    .map((p) => Number(p.split(":")[0].split("/")[0]))
    .filter((n) => n > 0);
  if (exposed.length && !exposed.includes(input.port)) {
    warnings.push(`Le port ${input.port} n'est pas dans les ports exposés de « ${a.display_name} » (${a.docker_ports}).`);
  }
}
