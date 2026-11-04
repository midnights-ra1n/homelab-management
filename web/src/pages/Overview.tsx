import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Columns2, Eye, EyeOff, LayoutGrid, PackageCheck, RotateCcw, ShieldAlert, Square } from "../shared/icons";
import { api, certDays, fmtPct, hostStatusLabel, fmtMs, pct, statusLabel, type Overview, type Status } from "../api";
import { updateTotals } from "./Updates";
import { incidents } from "./Incidents";
import { BandwidthEmpty } from "./Bandwidth";
import { BandwidthChart, BandwidthFigures } from "../shared/bandwidth";
import { EnergyCard } from "./Energy";
import { AlertBanner } from "../layout";
import { plural } from "../shared/plural";
import {
  Alert, Badge, Button, ButtonLink, Card, CardBody, CardHeader, Chart, EmptyState, IconButton, Link, PageHeader, STAT_GRID, SectionTitle, Skeleton, Stat,
  StatusBadge, StatusIcon, UptimeBars, cn, fmtLatency, formatPct, kindTone, navigate, statusKind, usePoll, useToast,
} from "../ui";

type WidgetId = "kpis" | "problems" | "latency" | "energy" | "updates" | "uptime" | "bandwidth" | "hosts";
interface Widget { id: WidgetId; visible: boolean; full: boolean }

const WIDGETS: Record<WidgetId, string> = {
  kpis: "Indicateurs",
  problems: "Incidents en cours",
  latency: "Latence moyenne (24 h)",
  energy: "Consommation électrique",
  updates: "Mises à jour",
  uptime: "Disponibilité sur 90 jours",
  bandwidth: "Bande passante",
  hosts: "Ressources des hôtes",
};
// One question per page: is everything fine? The other widgets stay available from "Personnaliser".
const DEFAULT_LAYOUT: Widget[] = [
  { id: "kpis", visible: true, full: true },
  { id: "latency", visible: true, full: false },
  { id: "problems", visible: true, full: false },
  { id: "hosts", visible: true, full: true },
  { id: "updates", visible: false, full: false },
  { id: "energy", visible: false, full: false },
  { id: "uptime", visible: false, full: true },
  { id: "bandwidth", visible: false, full: true },
];

function parseLayout(raw: string): Widget[] {
  try {
    const saved = JSON.parse(raw) as Widget[];
    const known = saved.filter((w) => w.id in WIDGETS);
    // Widgets added in a later version appear at the end.
    return [...known, ...DEFAULT_LAYOUT.filter((d) => !known.some((k) => k.id === d.id))];
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function OverviewPage() {
  const { data, error } = usePoll(() => api.get<Overview>("/api/overview"), 15000, [], ["hosts", "monitors", "metrics"]);
  const [layout, setLayout] = useState<Widget[]>(DEFAULT_LAYOUT);
  const [editing, setEditing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get<{ settings: Record<string, string> }>("/api/settings").then((s) => setLayout(parseLayout(s.settings.dashboard_layout_v2)), () => {});
  }, []);

  const save = async () => {
    await api.put("/api/settings", { dashboard_layout_v2: JSON.stringify(layout) });
    setEditing(false);
    toast("Disposition enregistrée");
  };
  const move = (i: number, d: number) => setLayout((l) => {
    const n = [...l];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const patch = (i: number, p: Partial<Widget>) => setLayout((l) => l.map((w, j) => (j === i ? { ...w, ...p } : w)));

  return (
    <>
      <PageHeader title="Vue d'ensemble" description={data && `État global : ${statusLabel[data.status].toLowerCase()}.`}
        actions={editing ? (
          <>
            <Button variant="secondary" onClick={() => setLayout(DEFAULT_LAYOUT)}>Rétablir par défaut</Button>
            <Button onClick={save}>Enregistrer la disposition</Button>
          </>
        ) : <Button variant="secondary" icon={<LayoutGrid size={16} />} onClick={() => setEditing(true)}>Personnaliser</Button>} />
      {error && <Alert kind="error" title="Impossible de charger les données" className="mb-8">{error}</Alert>}
      {!data && !error && <Skeleton className="h-72" />}
      {data && (
        <div className="grid grid-cols-1 gap-8">
          <AlertBanner list={incidents(data)} />
          <div className="grid gap-x-4 gap-y-8 lg:grid-cols-2">
            {layout.map((w, i) => (!w.visible && !editing ? null : (
              <div key={w.id} className={cn("min-w-0", w.full && "lg:col-span-2", !w.visible && "opacity-50")}>
                {editing && (
                  <div className="mb-2 flex items-center gap-1 rounded-full border border-dashed border-line py-1 pl-4 pr-1">
                    <span className="mm-label-caps flex-1 truncate">{WIDGETS[w.id]}</span>
                    <IconButton label="Monter" icon={<ArrowUp size={15} />} disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton label="Descendre" icon={<ArrowDown size={15} />} disabled={i === layout.length - 1} onClick={() => move(i, 1)} />
                    <IconButton label={w.full ? "Demi-largeur" : "Pleine largeur"} icon={w.full ? <Columns2 size={15} /> : <Square size={15} />} onClick={() => patch(i, { full: !w.full })} />
                    <IconButton label={w.visible ? "Masquer" : "Afficher"} icon={w.visible ? <Eye size={15} /> : <EyeOff size={15} />} onClick={() => patch(i, { visible: !w.visible })} />
                  </div>
                )}
                <WidgetView id={w.id} data={data} />
              </div>
            )))}
          </div>
        </div>
      )}
    </>
  );
}

const details = (to: string, label = "Détails") => <ButtonLink to={to} variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>{label}</ButtonLink>;

function WidgetView({ id, data }: { id: WidgetId; data: Overview }) {
  // 24 h average over every probe's 5-minute buckets, and the same average bucket by bucket.
  const latency = useMemo(() => {
    const v = data.latency.flatMap((s) => s.latency).filter((x): x is number => x != null);
    const buckets = new Map<number, number[]>();
    for (const s of data.latency) s.t.forEach((at, i) => { const x = s.latency[i]; if (x != null) buckets.set(at, [...(buckets.get(at) ?? []), x]); });
    const t = [...buckets.keys()].sort((a, b) => a - b);
    return {
      avg: v.length ? v.reduce((a, x) => a + x, 0) / v.length : null, probes: data.latency.filter((s) => s.latency.some((x) => x != null)).length, t,
      series: [{ label: "Latence", values: t.map((at) => { const b = buckets.get(at)!; return b.reduce((a, x) => a + x, 0) / b.length; }) }],
    };
  }, [data.latency]);

  const isUp = (s: Status) => s === "operational" || s === "degraded" || s === "maintenance";
  switch (id) {
    case "kpis": {
      const hostsUp = data.hosts.filter((h) => isUp(h.status)).length;
      const monUp = data.monitors.filter((m) => isUp(m.status)).length;
      const lat = data.monitors.filter((m) => m.latency_ms != null && m.type !== "ssl");
      const avg = lat.length ? lat.reduce((a, m) => a + (m.latency_ms ?? 0), 0) / lat.length : null;
      const ssl = data.monitors.filter((m) => { const d = certDays(m); return d != null && d < (m.config.warn_days ?? 14); }).length;
      return (
        <div className={STAT_GRID}>
          <Stat href="/hosts" label="Hôtes en ligne" value={`${hostsUp}/${data.hosts.length}`} tone={hostsUp < data.hosts.length ? "red" : undefined} detail={hostsUp < data.hosts.length ? `${data.hosts.length - hostsUp} hors ligne` : "Tous joignables"} />
          <Stat href="/monitors" label="Sondes actives" value={`${monUp}/${data.monitors.length}`} tone={monUp < data.monitors.length ? "red" : undefined} detail={monUp < data.monitors.length ? `${data.monitors.length - monUp} en panne` : "Toutes opérationnelles"} />
          <Stat href="/monitors" label="Latence moyenne" value={fmtMs(avg)} detail={plural(`Sur ${lat.length} sonde(s)`)} />
          <Stat href="/monitors" label="Certificats" value={ssl} tone={ssl ? "yellow" : undefined} detail={ssl ? "À renouveler" : "Aucun à renouveler"} />
        </div>
      );
    }
    case "problems": {
      const items = incidents(data);
      return (
        <Card className="h-full">
          <CardHeader title={items.length ? plural(`${items.length} point(s) d'attention`) : "Tout est au vert"} actions={details("/incidents", "Voir tous")} />
          <CardBody>
            {items.length === 0 ? (
              <p className="text-body">Aucun hôte ni aucune sonde en anomalie.</p>
            ) : (
              <ul className="grid grid-cols-1">
                {items.slice(0, 6).map((it) => (
                  <li key={it.key}>
                    <Link to={it.to} className="-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 no-underline hover:bg-hover">
                      <span className="min-w-0 flex-1 truncate font-semibold text-h1">{it.name}</span>
                      <StatusBadge status={it.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      );
    }
    case "updates": {
      const t = updateTotals(data.hosts);
      const top = data.hosts.filter((h) => h.updates?.pending).sort((a, b) => (b.updates!.security - a.updates!.security) || (b.updates!.pending - a.updates!.pending)).slice(0, 5);
      return (
        <Card className="h-full">
          <CardHeader title={t.reporting ? plural(`${t.pending} paquet(s) en attente`) : "Aucune donnée"} actions={details("/updates")} />
          <CardBody className="grid gap-5">
            <dl className="grid grid-cols-3 gap-3">
              {[
                { label: "Sécurité", value: t.security, icon: ShieldAlert },
                { label: "Redémarrages", value: t.reboot, icon: RotateCcw },
                { label: "À jour", value: `${t.upToDate}/${t.reporting}`, icon: PackageCheck },
              ].map((k) => (
                <div key={k.label}>
                  <dt className="flex items-center gap-1.5 text-xs text-meta"><k.icon size={13} aria-hidden="true" /> {k.label}</dt>
                  <dd className="mt-1 tabular-nums text-xl font-semibold text-h1">{k.value}</dd>
                </div>
              ))}
            </dl>
            {top.length === 0 ? (
              <p className="text-sm text-meta">{t.reporting ? "Tous les hôtes sont à jour." : "Les agents remontent les mises à jour au démarrage puis toutes les 6 heures."}</p>
            ) : (
              <ul className="grid gap-1">
                {top.map((h) => (
                  <li key={h.id}>
                    <Link to="/updates" className="flex items-center gap-3 rounded-lg px-2 py-2 no-underline hover:bg-page">
                      <StatusIcon kind={h.updates!.security ? "down" : "warn"} size={15} />
                      <span className="min-w-0 flex-1 truncate text-sm text-h2">{h.name}</span>
                      {h.updates!.security > 0 && <Badge tone="red">{h.updates!.security} sécu.</Badge>}
                      <span className="w-10 shrink-0 text-right tabular-nums text-sm text-h2">{h.updates!.pending}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      );
    }
    case "energy":
      return <EnergyCard href="/energy" />;
    case "latency":
      return (
        <Card className="h-full" title="Latence sur 24 h" sub={latency.avg == null ? "Aucune mesure" : plural(`${fmtLatency(latency.avg)} en moyenne, ${latency.probes} sonde(s)`)}
          actions={details("/monitors", "Sondes")}>
          <Chart t={latency.t} series={latency.series} format={fmtLatency} height={140} area />
        </Card>
      );
    case "uptime":
      return (
        <section>
          <SectionTitle actions={details("/monitors", "Sondes")}>Disponibilité sur 90 jours</SectionTitle>
          {data.monitors.length === 0 ? <EmptyState title="Aucune sonde">Ajoute une sonde pour suivre sa disponibilité.</EmptyState> : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.monitors.map((m) => {
                const kind = statusKind(m.status, m);
                const days = m.days ?? [];
                const known = days.filter((d) => d.uptime != null);
                const up = known.length ? (known.reduce((a, d) => a + d.uptime!, 0) / known.length) * 100 : null;
                return (
                  <li key={m.id} className={cn("grid gap-3 rounded-xl border border-line-subtle bg-box p-4", !m.enabled && "opacity-60")}
                    style={kind === "down" ? { borderColor: `color-mix(in srgb, ${kindTone("down")} 40%, var(--mm-border))` } : undefined}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <StatusIcon kind={kind} size={18} />
                      <Link to={`/monitors/${m.id}`} className="min-w-0 flex-1 truncate font-medium text-h1 no-underline hover:text-accent-text" title={m.target}>{m.name}</Link>
                      <span className="shrink-0 rounded-full border border-line-subtle px-1.5 font-mono text-xs uppercase text-meta">{m.type}</span>
                      <span className="shrink-0 tabular-nums text-sm font-semibold text-h1">{formatPct(up, 1)}</span>
                    </div>
                    <UptimeBars days={days.slice(-30)} height={16} />
                    <p className={cn("truncate tabular-nums text-xs", kind === "down" ? "text-red" : "text-meta")} title={m.message}>
                      {kind === "down" || kind === "warn" ? m.message || "—" : m.latency_ms != null ? fmtLatency(m.latency_ms) : m.message || "—"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      );
    case "bandwidth":
      return (
        <section>
          <SectionTitle actions={details("/bandwidth", "Bande passante")}>Bande passante (24 h)</SectionTitle>
          {data.bandwidth.links.length === 0 ? <BandwidthEmpty /> : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {data.bandwidth.links.map((l) => (
                <li key={`${l.target}|${l.interface}`} className="grid gap-3 rounded-xl border border-line-subtle bg-box p-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <StatusIcon status={l.status} size={18} />
                    <Link to="/bandwidth" className="min-w-0 flex-1 truncate font-mono font-medium text-h1 no-underline hover:text-accent-text">{l.interface}</Link>
                    <span className="shrink-0 truncate font-mono text-xs text-meta">{l.target}</span>
                  </div>
                  <BandwidthFigures l={l} compact />
                  {(l.in || l.out) && <BandwidthChart t={data.bandwidth.t} l={l} height={120} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    case "hosts": {
      const rank = (st: Status) => (st === "operational" ? 1 : st === "maintenance" ? 2 : 0); // problems first
      const hosts = [...data.hosts].sort((a, b) => rank(a.status) - rank(b.status)).slice(0, 8);
      return (
        <Card flush title="Hôtes" sub={`${hosts.length} sur ${data.hosts.length}`} actions={details("/hosts", "Voir tous les hôtes")}>
          {hosts.length === 0 ? <p className="px-6 py-8 text-center text-body">Installe l'agent depuis la page Hôtes.</p> : (
            <div className="mm-table-wrap">
              <table className="mm-table">
                <thead><tr><th scope="col">Hôte</th><th scope="col">État</th><th scope="col" className="mm-col-num">CPU</th><th scope="col" className="mm-col-num">Mémoire</th><th scope="col" className="mm-col-num">Disque</th></tr></thead>
                <tbody>
                  {hosts.map((h) => {
                    const live = statusKind(h.status) !== "down" && h.last_seen > 0;
                    return (
                      <tr key={h.id} className="cursor-pointer" onClick={() => navigate(`/hosts/${h.id}`)}>
                        <td className="mm-col-strong"><Link to={`/hosts/${h.id}`} className="text-inherit no-underline">{h.name}</Link></td>
                        <td><StatusBadge status={h.status} label={hostStatusLabel(h)} /></td>
                        <td className="mm-col-num">{live ? fmtPct(h.latest.cpu) : "—"}</td>
                        <td className="mm-col-num">{live ? fmtPct(pct(h.latest.mem_used, h.latest.mem_total)) : "—"}</td>
                        <td className="mm-col-num">{live ? fmtPct(pct(h.latest.disk_used, h.latest.disk_total)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      );
    }
  }
}
