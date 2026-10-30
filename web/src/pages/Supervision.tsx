/* Supervision: every sensor of the homelab on one screen, in the manner of PRTG's device tree.
   Each machine is a row of coloured sensors (agent, CPU, memory, each disk, temperature,
   updates, Docker, the probes that target it); Proxmox nodes unfold into their VMs and
   containers, and the probes that target no machine are grouped by category. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Maximize, Radar, Search, Tv } from "lucide-react";
import { api, fmtMs, fmtPct, hostStatusLabel, pct, type Host, type Monitor, type Overview } from "../api";
import { Alert, ButtonLink, EmptyState, IconButton, Link, Logo, PageHeader, Skeleton, StatusIcon, cn, inputClass, kindTone, statusKind, usePoll, useTitle, type StatusKind } from "../ui";
import { containerKind } from "./Containers";
import { guestCount, guestId, proxmoxTree } from "./Hosts";
import { hostRole, targetHost } from "./Map";

type Sensor = { id: string; label: string; value: string; kind: StatusKind; href: string; title?: string };

const KINDS: [StatusKind, string][] = [["down", "En panne"], ["warn", "Dégradé"], ["ok", "Opérationnel"], ["pending", "En attente"], ["maintenance", "Maintenance"], ["paused", "En pause"]];
const SEVERITY: StatusKind[] = ["ok", "paused", "pending", "maintenance", "warn", "down"];
const worst = (ks: StatusKind[]) => ks.reduce<StatusKind>((w, k) => (SEVERITY.indexOf(k) > SEVERITY.indexOf(w) ? k : w), "ok");
/** Usage sensor: warning from `warn` %, down from `down` %. */
const level = (v: number | null | undefined, warn: number, down: number): StatusKind => v == null ? "pending" : v >= down ? "down" : v >= warn ? "warn" : "ok";

const ROLE_LABEL = { vps: "VPS", physical: "Serveur physique", vm: "VM", lxc: "CT", unknown: "Hôte" };

function monitorSensor(m: Monitor): Sensor {
  return {
    id: `m${m.id}`, label: m.name, kind: statusKind(m.status, { enabled: m.enabled }), href: `/monitors/${m.id}`,
    value: !m.enabled ? "En pause" : m.latency_ms != null ? fmtMs(m.latency_ms) : m.type.toUpperCase(), title: m.message || m.target,
  };
}

function hostSensors(h: Host, probes: Monitor[]): Sensor[] {
  const l = h.latest;
  const href = `/hosts/${h.id}`;
  const out: Sensor[] = [{ id: "agent", label: "Agent", value: h.connected ? "Connecté" : hostStatusLabel(h), kind: statusKind(h.status), href }];
  if (h.last_seen) {
    out.push({ id: "cpu", label: "CPU", value: fmtPct(l.cpu), kind: level(l.cpu, 85, 95), href });
    const mem = pct(l.mem_used, l.mem_total);
    out.push({ id: "mem", label: "Mémoire", value: fmtPct(mem), kind: level(mem, 90, 97), href });
    for (const d of l.disks ?? []) {
      const v = pct(d.used, d.total);
      out.push({ id: `d${d.mount}`, label: `Disque ${d.mount}`, value: fmtPct(v), kind: level(v, 85, 95), href });
    }
    const t = l.cpu_temp ?? l.temp;
    if (t != null) out.push({ id: "temp", label: "Température", value: `${Math.round(t)} °C`, kind: level(t, 80, 90), href });
  }
  if (h.updates) {
    const u = h.updates;
    out.push({
      id: "upd", label: "Mises à jour", href: "/updates", kind: u.security || u.reboot_required ? "warn" : "ok",
      value: u.reboot_required ? "Redémarrage requis" : u.pending ? `${u.pending} (${u.security} sécu.)` : "À jour",
    });
  }
  const cs = h.docker?.containers ?? [];
  if (cs.length) out.push({ id: "docker", label: "Docker", value: `${h.docker!.running}/${cs.length} actifs`, kind: worst(cs.map(containerKind)), href: "/containers" });
  out.push(...probes.map(monitorSensor));
  // A host in maintenance or never seen does not alarm: its sensors take its state.
  if (h.maintenance) return out.map((s) => ({ ...s, kind: "maintenance" }));
  if (!h.last_seen) return out.map((s) => (s.href === href ? { ...s, kind: "pending" } : s));
  // Values of an agent that stopped reporting are stale.
  if (h.agent_down) return out.map((s) => (s.id !== "agent" && s.href === href ? { ...s, kind: "paused", title: "Valeur figée : agent hors ligne" } : s));
  return out;
}

/** Link into the dashboard, plain text on the wall screen (no session there). */
function Go({ wall, to, className, title, style, children }: { wall: boolean; to: string; className?: string; title?: string; style?: CSSProperties; children: ReactNode }) {
  return wall ? <span className={className} title={title} style={style}>{children}</span> : <Link to={to} className={className} title={title} style={style}>{children}</Link>;
}

function SensorTile({ s, wall }: { s: Sensor; wall: boolean }) {
  const tone = kindTone(s.kind);
  return (
    <Go wall={wall} to={s.href} title={s.title ? `${s.label} · ${s.title}` : s.label}
      className={cn("flex min-w-0 flex-col gap-0.5 rounded-lg border-l-4 px-2.5 py-1.5 text-inherit no-underline transition-[filter] hover:brightness-110", wall ? "w-44" : "w-36")}
      style={{ borderColor: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
      <span className={cn("truncate text-meta", wall ? "text-sm" : "text-xs")}>{s.label}</span>
      <span className={cn("flex min-w-0 items-center gap-1.5 font-medium text-h1", wall ? "text-base" : "text-sm")}>
        <StatusIcon kind={s.kind} size={wall ? 15 : 13} /><span className="truncate tabular-nums">{s.value}</span>
      </span>
    </Go>
  );
}

type Device = { key: string; title: string; tag: string; sub?: string; href: string; status: StatusKind; sensors: Sensor[]; kids: Device[] };

function DeviceBlock({ d, depth, open, toggle, visible, wall }: { d: Device; depth: number; open: Set<string>; toggle: (k: string) => void; visible: (s: Sensor) => boolean; wall: boolean }) {
  const shown = d.sensors.filter(visible);
  const kids = d.kids.filter((k) => hasVisible(k, visible));
  const isOpen = !open.has(d.key); // unfolded by default, the set holds the folded ones
  const all = [d.status, ...d.sensors.map((s) => s.kind)];
  return (
    <li className={cn(depth > 0 && "border-l-2 border-line-subtle pl-4", wall && depth === 0 && "mb-3 break-inside-avoid rounded-xl border border-line-subtle bg-box px-3")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <button type="button" onClick={() => toggle(d.key)} aria-expanded={isOpen} aria-label={`${isOpen ? "Replier" : "Déplier"} ${d.title}`}
          className="grid size-6 place-items-center rounded-full text-meta hover:bg-box hover:text-h1">
          {isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        </button>
        <StatusIcon kind={worst(all)} size={18} />
        <Go wall={wall} to={d.href} className={cn("font-medium text-h1 no-underline hover:text-accent-text", wall && "text-lg")}>{d.title}</Go>
        <span className="text-xs text-meta">{d.tag}</span>
        {d.sub && <span className="font-mono text-xs text-meta">{d.sub}</span>}
        <span className="ml-auto flex gap-1.5 text-xs tabular-nums" aria-label="Capteurs par état">
          {KINDS.map(([k, label]) => {
            const n = d.sensors.filter((s) => s.kind === k).length;
            return n > 0 && k !== "ok" ? <span key={k} title={label} className="rounded-full px-1.5" style={{ color: kindTone(k), background: `color-mix(in srgb, ${kindTone(k)} 14%, transparent)` }}>{n}</span> : null;
          })}
          <span className="text-meta">{d.sensors.length} capteur(s)</span>
        </span>
      </div>
      {isOpen && (
        <>
          {shown.length > 0 && <div className="flex flex-wrap gap-1.5 pb-2 pl-9">{shown.map((s) => <SensorTile key={s.id} s={s} wall={wall} />)}</div>}
          {kids.length > 0 && <ul className="ml-3">{kids.map((k) => <DeviceBlock key={k.key} d={k} depth={depth + 1} open={open} toggle={toggle} visible={visible} wall={wall} />)}</ul>}
        </>
      )}
    </li>
  );
}

const hasVisible = (d: Device, visible: (s: Sensor) => boolean): boolean => d.sensors.some(visible) || d.kids.some((k) => hasVisible(k, visible));

type Data = Pick<Overview, "hosts" | "monitors">;

function buildTree(o: Data): Device[] {
  // Probes hang under the host they target (name, hostname or address), the others under their category.
  const byKey = new Map<string, number>();
  for (const h of o.hosts) {
    for (const k of [h.name, h.info.hostname, h.info.hostname?.split(".")[0], ...(h.info.ips ?? []).map((a) => a.address)]) if (k) byKey.set(k.toLowerCase(), h.id);
  }
  const probes = new Map<number, Monitor[]>();
  const groups = new Map<string, Monitor[]>();
  for (const m of o.monitors) {
    const id = byKey.get(targetHost(m.target));
    if (id != null) probes.set(id, [...(probes.get(id) ?? []), m]);
    else { const c = m.category || "Sans catégorie"; groups.set(c, [...(groups.get(c) ?? []), m]); }
  }
  const { parentOf, kids } = proxmoxTree(o.hosts);
  const device = (h: Host, seen: Set<number>): Device => {
    seen.add(h.id);
    const ks = (kids.get(h.id) ?? []).filter((k) => !seen.has(k.id));
    const ip = (h.info.ips ?? []).find((a) => !a.address.includes(":") && !a.address.startsWith("127.") && !a.iface.startsWith("wg"))?.address;
    const id = guestId(h);
    const role = ROLE_LABEL[hostRole(h.info)];
    return {
      key: `h${h.id}`, title: h.name, href: `/hosts/${h.id}`, status: statusKind(h.status), sub: ip,
      tag: ks.length ? `Proxmox VE · ${guestCount(ks)}` : id ? `${role} ${id}` : role,
      sensors: hostSensors(h, probes.get(h.id) ?? []), kids: ks.map((k) => device(k, seen)),
    };
  };
  const seen = new Set<number>();
  const roots = o.hosts.filter((h) => !parentOf.has(h.id)).map((h) => device(h, seen));
  const cats = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([c, ms]): Device => ({
    key: `g:${c}`, title: c, tag: "Sondes", href: "/monitors", status: "ok", sensors: ms.map(monitorSensor), kids: [],
  }));
  return [...roots, ...cats];
}

export default function SupervisionPage() {
  useTitle("Supervision");
  const { data, error } = usePoll(() => api.get<Overview>("/api/overview"), 15000, [], ["hosts", "monitors", "metrics"]);
  return (
    <>
      <PageHeader title="Supervision" description="Tous les capteurs du homelab sur un écran : chaque machine avec ses mesures et les sondes qui la visent, les Proxmox dépliés sur leurs VM et conteneurs."
        actions={<ButtonLink variant="secondary" to="/status-page" icon={<Tv size={16} />}>Écran mural</ButtonLink>} />
      {error && <Alert kind="error" title="Impossible de charger la supervision" className="mb-6">{error}</Alert>}
      {!data && !error && <Skeleton className="h-96" />}
      {data && <Board data={data} />}
    </>
  );
}

/** Wall screen (/wall#key), for a TV: no session, the key comes from the link (see server/statuspage.go). */
export function WallPage() {
  const key = decodeURIComponent(location.hash.slice(1));
  const { data, error } = usePoll(async () => {
    const r = await fetch("/api/public/wall", { headers: { "X-Wall-Key": key } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
    return body as Data & { title: string };
  }, 15000, [key]);
  const [now, setNow] = useState(() => new Date());
  const [seen, setSeen] = useState<Date>();
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (data) setSeen(new Date()); }, [data]);
  useTitle(data ? `Supervision · ${data.title}` : "Supervision");
  const time = (d: Date) => d.toLocaleTimeString("fr-FR");
  if (!key) return <div className="p-8"><Alert kind="error" title="Lien incomplet">Ouvre le lien complet créé dans Page de statut → Écran mural.</Alert></div>;
  return (
    <div className="min-h-dvh p-4 lg:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Logo />
        <h1 className="text-2xl font-semibold text-h1">{data?.title ?? "Supervision"}</h1>
        <span className="ml-auto font-mono text-2xl tabular-nums text-h1">{time(now)}</span>
        <span className="text-sm text-meta">{seen ? `Mis à jour à ${time(seen)}` : "Chargement…"}</span>
        <IconButton label="Plein écran" icon={<Maximize size={18} />} onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} />
      </header>
      {error && <Alert kind="error" title={data ? "Connexion au monitoring perdue, dernières valeurs affichées" : "Écran indisponible"} className="mb-4">{error}</Alert>}
      {!data && !error && <Skeleton className="h-96" />}
      {data && <Board data={data} wall />}
    </div>
  );
}

function Board({ data, wall = false }: { data: Data; wall?: boolean }) {
  const [filter, setFilter] = useState<StatusKind | "problems" | null>(null);
  const [q, setQ] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(data), [data]);
  const all = useMemo(() => {
    const out: Sensor[] = [];
    const walk = (d: Device) => { out.push(...d.sensors); d.kids.forEach(walk); };
    tree.forEach(walk);
    return out;
  }, [tree]);
  const toggle = (k: string) => setFolded((s) => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n; });
  const needle = q.trim().toLowerCase();
  const visible = (s: Sensor) => (filter == null || (filter === "problems" ? s.kind === "down" || s.kind === "warn" : s.kind === filter));
  // Searching a machine name shows the whole machine; otherwise the sensors whose name matches.
  const shownTree = useMemo(() => {
    if (!needle) return tree;
    const keep = (d: Device): Device | null => {
      if (d.title.toLowerCase().includes(needle) || d.sub?.includes(needle)) return d;
      const kids = d.kids.map(keep).filter((k): k is Device => !!k);
      const sensors = d.sensors.filter((s) => s.label.toLowerCase().includes(needle));
      return kids.length || sensors.length ? { ...d, sensors, kids } : null;
    };
    return tree.map(keep).filter((d): d is Device => !!d);
  }, [tree, needle]);

  if (tree.length === 0) return <EmptyState icon={<Radar size={20} />} title="Rien à superviser">Ajoute un hôte ou une sonde pour voir ses capteurs ici.</EmptyState>;
  return (
        <div className="mm-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle p-3">
            <div role="group" aria-label="Filtrer par état" className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)}
                className={cn("rounded-full border px-3 py-1 text-sm tabular-nums", filter === null ? "border-accent text-h1" : "border-line-subtle text-meta hover:text-h1")}>
                Tous · {all.length}
              </button>
              <button type="button" aria-pressed={filter === "problems"} onClick={() => setFilter(filter === "problems" ? null : "problems")}
                className={cn("rounded-full border px-3 py-1 text-sm", filter === "problems" ? "border-accent text-h1" : "border-line-subtle text-meta hover:text-h1")}>
                Problèmes seulement
              </button>
              {KINDS.map(([k, label]) => {
                const n = all.filter((s) => s.kind === k).length;
                return n > 0 && (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(filter === k ? null : k)}
                    className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm tabular-nums", filter === k ? "border-accent" : "border-transparent")}
                    style={{ color: kindTone(k), background: `color-mix(in srgb, ${kindTone(k)} 14%, transparent)` }}>
                    <StatusIcon kind={k} size={14} />{n} {label.toLowerCase()}
                  </button>
                );
              })}
            </div>
            {!wall && <label className="relative ml-auto w-full sm:w-64">
              <span className="sr-only">Rechercher une machine ou un capteur</span>
              <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-meta" />
              <input type="search" className={cn(inputClass, "pl-8")} placeholder="Machine, capteur, adresse…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>}
          </div>
          <ul className={wall ? "columns-[30rem] gap-3 p-3" : "grid gap-1 p-3"}>
            {shownTree.filter((d) => hasVisible(d, visible)).map((d) => <DeviceBlock key={d.key} d={d} depth={0} open={folded} toggle={toggle} visible={visible} wall={wall} />)}
          </ul>
          {shownTree.every((d) => !hasVisible(d, visible)) && <p className="p-6 text-center text-sm text-meta">Aucun capteur ne correspond.</p>}
        </div>
  );
}
