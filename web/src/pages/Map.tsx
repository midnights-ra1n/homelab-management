/* Monitoring map: the hub, the SNMP devices, the hosts (VPS, physical servers, VMs) with their
   containers and the probes that target them, and the WireGuard tunnels between hosts, live. Columns are dragged as a whole; their place is kept in the
   preferences shared with the apps (key "map_positions"). */
import "@xyflow/react/dist/style.css";
import {
  Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, Handle, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider,
  useNodesState, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity, ArrowUpRight, Box, Boxes, Cable, Cloud, Container, Database, Globe, LayoutTemplate, Maximize, Plug, Radar, Router, Search, Server, ShieldCheck, Signpost, Waypoints, X,
} from "lucide-react";
import { api, fmtBytes, fmtMbps, fmtMs, fmtPct, hostStatusLabel, pct, savePrefs, statusLabel, type Host, type Monitor, type MonitorType, type Overview, type Preferences } from "../api";
import { containerKind } from "./Containers";
import { Alert, Badge, ButtonLink, EmptyState, IconButton, Link, Logo, Meter, PageHeader, Skeleton, StatusIcon, cn, inputClass, kindTone, statusKind, usePoll, type StatusKind, type Tone } from "../ui";

type Variant = "hub" | "host" | "device" | "group" | "container" | "monitor";
type MapData = {
  variant: Variant; kind: StatusKind; title: string; sub?: string; tag?: string; icon: ReactNode; href?: string;
  meters?: { label: string; value: number | null }[];
  rows?: { label: string; value: string; kind: StatusKind }[];
  info?: [string, string][];
  dim?: boolean;
};
type MapNode = Node<MapData, "map">;
type Pos = Record<string, { x: number; y: number }>;

const COL_W = 290;
const HEAD_Y = 230;
const KID_X = 34;
const KID_DY = 62;
const HEAD_H: Record<Variant, number> = { hub: 80, host: 165, device: 70, group: 70, container: 50, monitor: 50 };
const KIND_LABEL: Record<StatusKind, string> = { ok: "Opérationnel", warn: "Dégradé", down: "En panne", pending: "En attente", paused: "En pause", maintenance: "Maintenance" };
const KIND_TONE: Record<StatusKind, Tone> = { ok: "green", warn: "yellow", down: "red", pending: "blue", paused: "muted", maintenance: "blue" };
const SEVERITY: StatusKind[] = ["ok", "paused", "pending", "maintenance", "warn", "down"];
const worst = (kinds: StatusKind[]) => kinds.reduce<StatusKind>((w, k) => (SEVERITY.indexOf(k) > SEVERITY.indexOf(w) ? k : w), "ok");

const MONITOR_ICON: Record<MonitorType, typeof Globe> = {
  http: Globe, tcp: Cable, udp: Cable, ping: Activity, dns: Signpost, ssl: ShieldCheck, snmp: Router, meross: Plug, truenas: Database,
};

/** Host part of a probe target ("https://nas.lan:8443/x" → "nas.lan"). */
export function targetHost(t: string) {
  const s = t.trim().toLowerCase();
  try { return new URL(s.includes("://") ? s : `tcp://${s}`).hostname.replace(/^\[|\]$/g, ""); } catch { return s; }
}

/** RFC 1918, CGNAT (Tailscale), loopback, link-local and IPv6 ULA / link-local. */
const isPrivate = (ip: string) =>
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|f[cd]|fe80|::1$)/i.test(ip);
const HYPERVISORS = ["kvm", "vmware", "microsoft", "xen", "oracle"];
type Role = "vps" | "physical" | "vm" | "lxc" | "unknown";
const ROLE: Record<Role, { label: string; Icon: typeof Server }> = {
  vps: { label: "VPS", Icon: Cloud }, physical: { label: "Serveur physique", Icon: Server }, vm: { label: "Machine virtuelle", Icon: Box },
  lxc: { label: "Conteneur système", Icon: Boxes }, unknown: { label: "Hôte", Icon: Server },
};
const ROLE_ORDER: Role[] = ["vps", "physical", "vm", "lxc", "unknown"];

/** From what the agent detects: no hypervisor → physical; a VM with a public address → VPS. */
export function hostRole(info: Host["info"]): Role {
  const v = info.virtualization;
  if (!v) return "unknown";
  if (v === "none") return "physical";
  if (!HYPERVISORS.includes(v)) return "lxc";
  return info.ips?.some((a) => !a.iface.startsWith("wg") && !isPrivate(a.address)) ? "vps" : "vm";
}

const ip4 = (a: string) => a.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const ip4str = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

type Tunnel = { id: string; source: string; target: string; label: string; rate: string; kind: StatusKind };

/** WireGuard: hosts with a wg* address in the same network are peers; the lowest address
    (usually the .1 server) is drawn as the centre of the tunnel. */
export function wireguardTunnels(hosts: Host[]): Tunnel[] {
  const nets = new Map<string, { h: Host; iface: string; n: number }[]>();
  for (const h of hosts) for (const a of h.info.ips ?? []) {
    if (!/^wg/.test(a.iface) || !/^\d+\.\d+\.\d+\.\d+$/.test(a.address)) continue;
    // shortcut: a peer carrying a /32 is assumed to sit in the /24 around it; read the peers' AllowedIPs if this misplaces tunnels.
    const p = a.prefix && a.prefix <= 24 ? a.prefix : 24;
    const n = ip4(a.address), size = 2 ** (32 - p);
    const net = `${ip4str(Math.floor(n / size) * size)}/${p}`;
    nets.set(net, [...(nets.get(net) ?? []), { h, iface: a.iface, n }]);
  }
  return [...nets].flatMap(([net, peers]) => {
    const [center, ...rest] = peers.sort((a, b) => a.n - b.n);
    return rest.filter((p) => p.h.id !== center.h.id).map((p) => {
      const io = p.h.latest.ifaces?.find((i) => i.name === p.iface);
      return {
        id: `wg:${net}:${p.h.id}`, source: `h${center.h.id}`, target: `h${p.h.id}`, label: `${p.iface} · ${net}`,
        rate: io ? `↓ ${fmtBytes(io.rx, true)} ↑ ${fmtBytes(io.tx, true)}` : "",
        kind: worst([statusKind(center.h.status), statusKind(p.h.status)]),
      };
    });
  });
}

type Column = { head: MapNode; kids: MapNode[] };

/** Overview → columns (head + children) and the hub. */
function buildGraph(o: Overview, show: { containers: boolean; monitors: boolean }) {
  const node = (id: string, data: MapData): MapNode => ({ id, type: "map", position: { x: 0, y: 0 }, data });

  // SNMP devices: interfaces grouped by target; their probes are shown as rows, not as nodes.
  const devices = new Map<string, Column>();
  const inLinks = new Set<number>();
  const byTarget = new Map<string, typeof o.bandwidth.links>();
  for (const l of o.bandwidth?.links ?? []) {
    byTarget.set(targetHost(l.target), [...(byTarget.get(targetHost(l.target)) ?? []), l]);
    for (const s of [l.in, l.out, l.state]) if (s) inLinks.add(s.monitor_id);
  }
  for (const [target, links] of byTarget) {
    const rows = links.map((l) => ({
      label: l.interface, kind: statusKind(l.status),
      value: l.in || l.out ? `↓ ${fmtMbps(l.in?.current_mbps)} ↑ ${fmtMbps(l.out?.current_mbps)}` : statusLabel[l.status],
    }));
    devices.set(target, {
      head: node(`d:${target}`, {
        variant: "device", kind: worst(rows.map((r) => r.kind)), title: links[0].target, sub: `${links.length} interface(s) SNMP`,
        icon: <Router size={17} />, href: "/bandwidth", rows: rows.slice(0, 5),
        info: rows.length > 5 ? [["Autres interfaces", String(rows.length - 5)]] : undefined,
      }),
      kids: [],
    });
  }

  const hosts = new Map<number, Column>();
  const hostByName = new Map<string, number>();
  const roleOf = new Map(o.hosts.map((h) => [h.id, hostRole(h.info)]));
  const sorted = [...o.hosts].sort((a, b) => ROLE_ORDER.indexOf(roleOf.get(a.id)!) - ROLE_ORDER.indexOf(roleOf.get(b.id)!) || a.name.localeCompare(b.name));
  for (const h of sorted) {
    const l = h.latest;
    const role = ROLE[roleOf.get(h.id)!];
    const ips = (h.info.ips ?? []).filter((a) => !a.address.includes(":") && !a.address.startsWith("127."));
    const hw = [h.info.manufacturer, h.info.model].filter(Boolean).join(" ");
    for (const k of [h.name, h.info.hostname, h.info.hostname?.split(".")[0]]) if (k) hostByName.set(k.toLowerCase(), h.id);
    const cs = h.docker?.containers ?? [];
    hosts.set(h.id, {
      head: node(`h${h.id}`, {
        variant: "host", kind: statusKind(h.status), title: h.name, tag: role.label, icon: <role.Icon size={17} />, href: `/hosts/${h.id}`,
        sub: (roleOf.get(h.id) === "physical" && hw) || ips.find((a) => !a.iface.startsWith("wg"))?.address || h.info.os || h.info.hostname,
        meters: h.connected || l.cpu != null ? [
          { label: "CPU", value: l.cpu ?? null }, { label: "RAM", value: pct(l.mem_used, l.mem_total) }, { label: "Disque", value: pct(l.disk_used, l.disk_total) },
        ] : undefined,
        info: [
          ["État", hostStatusLabel(h)],
          ["Type", hw ? `${role.label} · ${hw}` : role.label],
          ...(ips.length ? [["Adresses", ips.map((a) => `${a.iface} ${a.address}`).join(", ")] as [string, string]] : []),
          ["Charge", l.load1 != null ? l.load1.toFixed(2) : "—"],
          ["Mémoire", `${fmtBytes(l.mem_used)} / ${fmtBytes(l.mem_total)}`],
          ...(cs.length ? [["Conteneurs", `${h.docker!.running}/${cs.length} actifs`] as [string, string]] : []),
          ...(h.updates?.pending ? [["Mises à jour", `${h.updates.pending} (${h.updates.security} sécurité)`] as [string, string]] : []),
        ],
      }),
      kids: !show.containers ? [] : cs.map((c) => node(`c${h.id}:${c.name}`, {
        variant: "container", kind: containerKind(c), title: c.name, sub: c.state === "running" ? `CPU ${fmtPct(c.cpu_pct)} · ${fmtBytes(c.mem_used)}` : c.state,
        icon: <Container size={15} />, href: `/hosts/${h.id}`,
        info: [["Image", c.image], ["État", c.health ? `${c.state} · ${c.health}` : c.state], ...(c.compose_project ? [["Compose", c.compose_project] as [string, string]] : [])],
      })),
    });
  }

  // Probes hang under the host or device they target, the others under their category.
  const groups = new Map<string, Column>();
  const monitorNode = (m: Monitor) => {
    const Icon = MONITOR_ICON[m.type] ?? Radar;
    return node(`m${m.id}`, {
      variant: "monitor", kind: statusKind(m.status, { enabled: m.enabled }), title: m.name,
      sub: m.enabled ? (m.latency_ms != null ? `${m.type.toUpperCase()} · ${fmtMs(m.latency_ms)}` : m.type.toUpperCase()) : "En pause",
      icon: <Icon size={15} />, href: `/monitors/${m.id}`,
      info: [["Cible", m.target], ...(m.message ? [["Message", m.message] as [string, string]] : [])],
    });
  };
  if (show.monitors) for (const m of o.monitors) {
    if (inLinks.has(m.id)) continue;
    const t = targetHost(m.target);
    const hostId = hostByName.get(t);
    const col = hostId != null ? hosts.get(hostId) : devices.get(t);
    if (col) { col.kids.push(monitorNode(m)); continue; }
    const cat = m.category || "Sans catégorie";
    if (!groups.has(cat)) groups.set(cat, { head: node(`g:${cat}`, { variant: "group", kind: "ok", title: cat, icon: <Radar size={17} />, href: "/monitors" }), kids: [] });
    groups.get(cat)!.kids.push(monitorNode(m));
  }
  for (const g of groups.values()) {
    g.head.data.kind = worst(g.kids.map((k) => k.data.kind));
    g.head.data.sub = `${g.kids.length} sonde(s)`;
  }

  const columns = [...devices.values(), ...hosts.values(), ...[...groups.values()].sort((a, b) => a.head.data.title.localeCompare(b.head.data.title))];
  const all = columns.flatMap((c) => [c.head, ...c.kids]);
  const hub = node("hub", {
    variant: "hub", kind: statusKind(o.status), title: "Monitoring", sub: `${o.hosts.length} hôte(s) · ${o.monitors.length} sonde(s)`, icon: null,
    info: [["En panne", String(all.filter((n) => n.data.kind === "down").length)], ["Dégradés", String(all.filter((n) => n.data.kind === "warn").length)]],
  });
  return { hub, columns, tunnels: wireguardTunnels(o.hosts) };
}

/** Default places: the hub on top, one column per device, host and probe category. */
function autoLayout(columns: Column[]): Pos {
  const pos: Pos = {};
  columns.forEach((c, i) => (pos[c.head.id] = { x: i * COL_W, y: HEAD_Y }));
  pos.hub = { x: Math.max(0, (columns.length * COL_W - COL_W) / 2), y: 0 };
  return pos;
}

/* ---------- Nodes ---------- */

const MapNodeView = memo(function MapNodeView({ data, selected }: NodeProps<MapNode>) {
  const tone = kindTone(data.kind);
  const small = data.variant === "container" || data.variant === "monitor";
  const alarm = data.kind === "down" || data.kind === "warn";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 border bg-box transition-[opacity,box-shadow,border-color] duration-200",
        small ? "w-[220px] rounded-xl px-2.5 py-1.5" : "w-[244px] rounded-2xl px-3 py-2.5",
        data.variant === "hub" && "w-[244px] border-line-accent",
        selected ? "border-accent shadow-[0_0_24px_4px_var(--mm-accent-soft)]" : "border-line",
        data.dim && "opacity-25",
      )}
      style={alarm && !selected ? { borderColor: `color-mix(in srgb, ${tone} 60%, var(--mm-border))`, boxShadow: `0 0 18px -4px ${tone}` } : undefined}
    >
      {data.variant !== "hub" && <Handle type="target" position={small ? Position.Left : Position.Top} isConnectable={false} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-transparent" />}
      <div className="flex items-center gap-2.5">
        <span className={cn("flex shrink-0 items-center justify-center", small ? "size-7 rounded-lg" : "size-9 rounded-xl")}
          style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
          {data.variant === "hub" ? <span className="flex size-6 [&_svg]:h-6"><Logo compact /></span> : data.icon}
        </span>
        <span className="min-w-0 flex-1">
          {data.tag && <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-meta">{data.tag}</span>}
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2 shrink-0 rounded-full", data.kind === "down" && "animate-pulse")} style={{ background: tone }} title={KIND_LABEL[data.kind]} />
            <span className={cn("truncate font-medium text-h1", small ? "text-[13px]" : "text-sm")}>{data.title}</span>
          </span>
          {data.sub && <span className="block truncate font-mono text-[0.68rem] text-meta">{data.sub}</span>}
        </span>
      </div>
      {data.meters && (
        <div className="grid gap-1.5">
          {data.meters.map((m) => (
            <div key={m.label} className="grid grid-cols-[3.2rem_1fr_2.6rem] items-center gap-2 text-[0.68rem]">
              <span className="text-meta">{m.label}</span>
              <Meter value={m.value} size="sm" />
              <span className="text-right font-mono text-body tabular-nums">{m.value == null ? "—" : `${Math.round(m.value)} %`}</span>
            </div>
          ))}
        </div>
      )}
      {data.rows && (
        <ul className="grid gap-1">
          {data.rows.map((r) => (
            <li key={r.label} className="flex items-center gap-1.5 text-[0.68rem]">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: kindTone(r.kind) }} />
              <span className="min-w-0 flex-1 truncate text-body">{r.label}</span>
              <span className="shrink-0 font-mono text-meta tabular-nums">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
      {!small && <Handle type="source" position={Position.Bottom} isConnectable={false} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-transparent" />}
      {!small && data.variant !== "hub" && (
        <Handle id="kids" type="source" position={Position.Bottom} isConnectable={false} style={{ left: 18 }} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-transparent" />
      )}
      {data.variant === "host" && ["source", "target"].map((t) => (
        <Handle key={t} id={`wg-${t}`} type={t as "source" | "target"} position={Position.Top} isConnectable={false} style={{ left: "82%" }} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-transparent" />
      ))}
    </div>
  );
});
const nodeTypes = { map: MapNodeView };

/** WireGuard tunnel: an arc above the hosts, so it does not cross the columns. */
function TunnelEdge({ id, sourceX, sourceY, targetX, targetY, style, data }: EdgeProps<Edge<{ label: string; rate: string }>>) {
  const top = Math.min(sourceY, targetY) - 46 - Math.abs(targetX - sourceX) * 0.18;
  const path = `M${sourceX},${sourceY} C${sourceX},${top} ${targetX},${top} ${targetX},${targetY}`;
  const x = (sourceX + targetX) / 2, y = (sourceY + targetY + 6 * top) / 8; // the curve's midpoint
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      <EdgeLabelRenderer>
        <div className="nodrag nopan pointer-events-none absolute rounded-full border px-2 py-0.5 text-center font-mono text-[0.62rem] leading-tight backdrop-blur"
          style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)`, opacity: style?.opacity, color: style?.stroke,
            borderColor: `color-mix(in srgb, ${style?.stroke} 45%, transparent)`, background: "color-mix(in srgb, var(--mm-overlay) 88%, transparent)" }}>
          <span className="flex items-center gap-1"><Waypoints size={10} aria-hidden="true" />{data?.label}</span>
          {data?.rate && <span className="block text-meta">{data.rate}</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { tunnel: TunnelEdge };

/* ---------- Page ---------- */

export default function MapPage() {
  const { data, error } = usePoll(() => api.get<Overview>("/api/overview"), 15000, [], ["hosts", "monitors", "metrics"]);
  const [saved, setSaved] = useState<Pos>();
  useEffect(() => {
    api.get<Preferences>("/api/preferences").then((p) => setSaved((p.map_positions as Pos) ?? {}), () => setSaved({}));
  }, []);

  return (
    <div className="grid gap-6">
      <PageHeader title="Carte" description="Vue d'ensemble de l'infrastructure surveillée, en direct. Glissez un hôte pour le déplacer avec ses conteneurs et ses sondes." />
      {error && !data && <Alert kind="error" title="Impossible de charger la carte">{error}</Alert>}
      {(!data || !saved) && !error && <Skeleton className="h-[calc(100dvh-14rem)] min-h-[32rem] rounded-3xl" />}
      {data && saved && (data.hosts.length || data.monitors.length ? (
        <ReactFlowProvider><Flow o={data} saved={saved} /></ReactFlowProvider>
      ) : (
        <EmptyState icon={<Server size={20} />} title="Rien à afficher" action={<ButtonLink to="/hosts">Ajouter un hôte</ButtonLink>}>
          Ajoutez un hôte ou une sonde pour les voir apparaître sur la carte.
        </EmptyState>
      ))}
    </div>
  );
}

function Flow({ o, saved: initial }: { o: Overview; saved: Pos }) {
  const saved = useRef(initial).current; // edited in place: drags and resets must not rebuild the graph
  const { fitView } = useReactFlow();
  const [show, setShow] = useState({ containers: true, monitors: true, tunnels: true, problems: false });
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string>();

  const { hub, columns, tunnels } = useMemo(() => buildGraph(o, show), [o, show.containers, show.monitors]); // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useMemo(() => autoLayout(columns), [columns]);

  // Children are placed relative to their head so a column moves as a whole.
  const built = useMemo(() => {
    const query = q.trim().toLowerCase();
    const hidden = (n: MapNode) => (!!query && !`${n.data.title} ${n.data.sub ?? ""}`.toLowerCase().includes(query)) || (show.problems && n.data.kind === "ok");
    const out: MapNode[] = [{ ...hub, position: saved.hub ?? layout.hub, data: { ...hub.data, dim: !!query && hidden(hub) } }];
    for (const c of columns) {
      const kidsDim = c.kids.map(hidden);
      out.push({ ...c.head, position: saved[c.head.id] ?? layout[c.head.id], data: { ...c.head.data, dim: hidden(c.head) && kidsDim.every(Boolean) } });
      const top = HEAD_H[c.head.data.variant] + (c.head.data.rows?.length ?? 0) * 20 + 28;
      c.kids.forEach((k, i) => out.push({ ...k, parentId: c.head.id, draggable: false, position: { x: KID_X, y: top + i * KID_DY }, data: { ...k.data, dim: kidsDim[i] } }));
    }
    return out;
  }, [hub, columns, layout, saved, q, show.problems]);

  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>(built);
  // New data: keep where the user put things and what is selected.
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return built.map((n) => {
        const p = old.get(n.id);
        return p ? { ...n, position: n.parentId ? n.position : p.position, selected: p.selected, measured: p.measured } : n;
      });
    });
  }, [built, setNodes]);

  const dimOf = new Map(nodes.map((n) => [n.id, n.data.dim]));
  const links: { source: string; target: MapNode; kids?: boolean }[] = columns.flatMap((c) => [
    { source: "hub", target: c.head }, ...c.kids.map((k) => ({ source: c.head.id, target: k, kids: true })),
  ]);
  const edges: Edge[] = links.map(({ source, target: { id: target, data: { kind } }, kids }) => ({
      id: `e-${target}`,
      source, target, sourceHandle: kids ? "kids" : undefined, type: "smoothstep", selectable: false,
      animated: !kids && kind === "ok",
      style: {
        stroke: kind === "ok" || kind === "paused" ? "var(--mm-border-strong)" : kindTone(kind),
        strokeWidth: kids ? 1.25 : 1.75,
        strokeDasharray: kind === "down" ? "5 4" : undefined,
        opacity: dimOf.get(source) || dimOf.get(target) ? 0.15 : 1,
      },
    }));
  if (show.tunnels) for (const t of tunnels) edges.push({
    id: t.id, source: t.source, target: t.target, sourceHandle: "wg-source", targetHandle: "wg-target", type: "tunnel", selectable: false,
    animated: t.kind !== "down", data: { label: t.label, rate: t.rate },
    style: { stroke: t.kind === "down" ? kindTone("down") : "var(--mm-purple)", strokeWidth: 2, strokeDasharray: "6 4", opacity: dimOf.get(t.source) || dimOf.get(t.target) ? 0.15 : 1 },
  });

  const counts = SEVERITY.map((k) => [k, nodes.filter((n) => n.id !== "hub" && n.data.kind === k).length] as const).filter(([, n]) => n);
  const fit = (ids?: string[]) => fitView({ nodes: ids?.map((id) => ({ id })), padding: 0.2, maxZoom: ids ? 1.2 : 1, duration: 500 });
  const sel = nodes.find((n) => n.id === selected);

  return (
    <div className="relative h-[calc(100dvh-14rem)] min-h-[32rem] overflow-hidden rounded-3xl border border-line-subtle bg-crust">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
        onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(undefined)}
        onNodeDragStop={(_, __, dragged) => {
          const next = { ...saved };
          for (const n of nodes) if (!n.parentId) next[n.id] = n.position;
          for (const n of dragged) next[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
          Object.assign(saved, next);
          savePrefs({ map_positions: next });
        }}
        nodesConnectable={false} deleteKeyCode={null} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--mm-border)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" className="hidden md:block"
          nodeColor={(n) => kindTone((n.data as MapData).kind)} nodeStrokeWidth={0} />

        <Panel position="top-left" className="!m-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2">
          <label className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-meta" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher sur la carte"
              onKeyDown={(e) => e.key === "Enter" && fit(nodes.filter((n) => !n.data.dim).map((n) => n.id))}
              className={cn(inputClass, "w-44 bg-page/90 pl-8 backdrop-blur")} />
          </label>
          <div className="flex items-center gap-1 rounded-full border border-line bg-page/90 p-1 backdrop-blur">
            {([["containers", "Conteneurs", Container], ["monitors", "Sondes", Radar], ["tunnels", "WireGuard", Waypoints], ["problems", "Problèmes", Activity]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
                className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs transition-colors",
                  show[k] ? (k === "problems" ? "bg-accent-soft text-accent-text" : "text-h2 hover:bg-box") : k === "problems" ? "text-meta hover:bg-box" : "text-meta line-through")}>
                <Icon size={13} aria-hidden="true" /><span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          <div className="hidden items-center gap-3 rounded-full border border-line bg-page/90 px-3 py-1.5 text-xs backdrop-blur lg:flex" aria-label="Répartition des états">
            {counts.map(([k, n]) => (
              <span key={k} className="flex items-center gap-1.5 text-body" title={KIND_LABEL[k]}>
                <span className="size-2 rounded-full" style={{ background: kindTone(k) }} />{n} <span className="text-meta">{KIND_LABEL[k].toLowerCase()}</span>
              </span>
            ))}
          </div>
        </Panel>

        <Panel position="top-right" className="!m-3 flex items-center gap-2">
          <IconButton label="Ajuster à l'écran" variant="secondary" size="icon" className="bg-page/90 backdrop-blur" icon={<Maximize size={15} />} onClick={() => fit()} />
          <IconButton label="Disposition automatique" variant="secondary" size="icon" className="bg-page/90 backdrop-blur" icon={<LayoutTemplate size={15} />}
            onClick={() => {
              for (const k of Object.keys(saved)) delete saved[k];
              savePrefs({ map_positions: null });
              setNodes((ns) => ns.map((n) => (n.parentId ? n : { ...n, position: layout[n.id] ?? n.position })));
              setTimeout(() => fit(), 50);
            }} />
        </Panel>

        {sel && (
          <Panel position="bottom-center" className="!mb-4 w-[min(26rem,calc(100%-2rem))]">
            <div className="rounded-2xl border border-line bg-elevated p-4 shadow-[var(--mm-shadow-md)]">
              <div className="flex items-start gap-3">
                <StatusIcon kind={sel.data.kind} size={18} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-h1">{sel.data.title}</p>
                  {sel.data.sub && <p className="truncate font-mono text-xs text-meta">{sel.data.sub}</p>}
                </div>
                <Badge tone={KIND_TONE[sel.data.kind]} dot>{KIND_LABEL[sel.data.kind]}</Badge>
                {sel.data.href && (
                  <Link to={sel.data.href} aria-label="Ouvrir la fiche" title="Ouvrir la fiche"
                    className="flex size-8 items-center justify-center rounded-full text-accent-text hover:bg-accent-soft">
                    <ArrowUpRight size={16} />
                  </Link>
                )}
                <IconButton label="Fermer" icon={<X size={15} />} onClick={() => setSelected(undefined)} />
              </div>
              {sel.data.meters && <div className="mt-3 grid grid-cols-3 gap-3">{sel.data.meters.map((m) => <Meter key={m.label} label={m.label} value={m.value} size="sm" />)}</div>}
              {sel.data.info && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  {sel.data.info.map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-meta">{k}</dt><dd className="truncate text-right font-mono text-body" title={v}>{v}</dd></div>
                  ))}
                </dl>
              )}
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
