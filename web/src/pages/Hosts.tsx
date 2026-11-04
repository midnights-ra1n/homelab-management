import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Download, KeyRound, Pencil, Plus, RefreshCw, Server, Trash2, Users } from "../shared/icons";
import { actionBusy, api, fmtAgo, hostStatusLabel, fmtBytes, fmtDate, fmtPct, pct, hostTypeLabel, type Host, type HostLatest, type HostSeries, type Install } from "../api";
import { DeploymentTypeDialog } from "./DeploymentType";
import {
  Alert, Badge, Button, Card, Chart, CodeBlock, Dialog, EmptyState, Field, Link, inputClass, Meter, PageHeader, SECTIONS, STAT_GRID, SectionTitle, Segmented,
  Skeleton, Stat, StatusBadge, StatusIcon, Switch, Tag, cn, navigate, statusKind, usePoll, useTitle, useToast,
} from "../ui";
import { DiskCard, type HostDisks } from "./Disks";
import { AddHostWizard, InstallInstructions, ParentSelect, UNINSTALL_COMMAND } from "./AddHostWizard";
import { MassDeployDialog } from "./MassDeploy";
import { AgentVersion, useHostAction } from "./AgentVersion";
import { ContainersTable } from "./Containers";
import { ActionStatus, UpgradeDialog } from "./Updates";
import { NodeAppsPanel, Spec } from "./NodeApps";
import { IptablesPanel } from "../shared/iptables";
import { plural } from "../shared/plural";

/** Proxmox ID of a VM or LXC container (from its node, else from install.sh LXC=all). */
export const guestId = (h: Host) => h.vmid || h.info.pve_ctid;

/** Hierarchy from parent_id (see server/guests.go): children sorted by VM / CT ID, then name. */
export function proxmoxTree(hosts: Host[]) {
  const byId = new Map(hosts.map((h) => [h.id, h]));
  const parentOf = new Map<number, Host>();
  const kids = new Map<number, Host[]>();
  for (const h of hosts) {
    const p = h.parent_id != null ? byId.get(h.parent_id) : undefined;
    if (!p || p.id === h.id) continue;
    parentOf.set(h.id, p);
    kids.set(p.id, [...(kids.get(p.id) ?? []), h]);
  }
  for (const k of kids.values()) k.sort((a, b) => (guestId(a) ?? Infinity) - (guestId(b) ?? Infinity) || a.name.localeCompare(b.name));
  return { parentOf, kids };
}

/** "3 CT · 1 VM" for the guests of a node. */
export const guestCount = (ks: Host[]) => {
  const ct = ks.filter((k) => k.info.virtualization === "lxc").length;
  return [ct && `${ct} CT`, ks.length - ct && `${ks.length - ct} VM`].filter(Boolean).join(" · ");
};

export function HostsPage() {
  const { data, error, refresh } = usePoll(() => api.get<Host[]>("/api/hosts"), 15000, [], ["hosts", "metrics"]);
  const [adding, setAdding] = useState(false);
  const [mass, setMass] = useState(false);
  const [updating, setUpdating] = useState(false);
  const toast = useToast();
  const outdated = data?.filter((h) => h.connected && h.agent_outdated).length ?? 0;
  const updateAll = async () => {
    setUpdating(true);
    try {
      const r = await api.post<{ sent: number; busy: number }>("/api/hosts/update-agents");
      toast(r.sent ? plural(`Mise à jour demandée à ${r.sent} agent(s)${r.busy ? `, ${r.busy} occupé(s) par une autre action` : ""}`) : "Tous les agents connectés sont déjà à jour");
      refresh();
    } catch (e) { toast((e as Error).message, "error"); }
    setUpdating(false);
  };
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [nodeOnly, setNodeOnly] = useState(false);
  const online = data?.filter((h) => h.connected).length ?? 0;
  // Proxmox hosts unfold into their LXC containers.
  const { kids, rows } = useMemo(() => {
    const { parentOf, kids } = proxmoxTree(data ?? []);
    const unfold = (h: Host, depth: number, seen: Set<number>): { h: Host; depth: number }[] => seen.has(h.id) ? [] : (seen.add(h.id),
      [{ h, depth }, ...(open.has(h.id) ? (kids.get(h.id) ?? []).flatMap((k) => unfold(k, depth + 1, seen)) : [])]);
    const seen = new Set<number>();
    const rows = (data ?? []).filter((h) => !parentOf.has(h.id)).flatMap((h) => unfold(h, 0, seen));
    return { kids, rows };
  }, [data, open]);
  const nodeHosts = (data ?? []).filter((h) => h.node_apps);
  const shown = nodeOnly ? nodeHosts.map((h) => ({ h, depth: 0 })) : rows;
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const fold = (h: Host) => {
    const ks = kids.get(h.id);
    if (!ks) return null;
    const down = ks.filter((k) => statusKind(k.status) === "down").length;
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <button type="button" aria-expanded={open.has(h.id)} aria-label={`${open.has(h.id) ? "Replier" : "Déplier"} les invités de ${h.name}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(h.id); }}
          className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-normal text-meta hover:bg-box hover:text-h1">
          {open.has(h.id) ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}{guestCount(ks)}
        </button>
        {down > 0 && <Badge tone="red" dot>{down} en panne</Badge>}
      </span>
    );
  };
  return (
    <>
      <PageHeader title="Hôtes" description="Toutes les machines équipées de l'agent."
        actions={<>
          {outdated > 0 && (
            <Button variant="ghost" icon={<RefreshCw size={16} />} loading={updating} onClick={updateAll}
              title="Demande aux agents connectés de se mettre à jour maintenant, sans attendre leur vérification quotidienne">
              {plural(`Mettre à jour ${outdated} agent(s)`)}
            </Button>
          )}
          <Button variant="secondary" icon={<Users size={16} />} aria-label="Déploiement en masse" title="Déploiement en masse" onClick={() => setMass(true)}><span className="max-sm:hidden">Déploiement en masse</span></Button>
          <Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>Ajouter un hôte</Button>
        </>} />
      {error && <Alert kind="error" title="Impossible de charger les hôtes" className="mb-6">{error}</Alert>}
      {!data && !error && <Skeleton className="h-64" />}
      {data && data.length === 0 && (
        <EmptyState icon={<Server size={20} />} title="Aucun hôte supervisé"
          action={<Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>Ajouter un hôte</Button>}>
          Ajoute un hôte pour obtenir la commande d'installation de l'agent.
        </EmptyState>
      )}
      {data && data.length > 0 && (
        <Card flush title={plural(`${shown.length} hôte(s)`)} sub={plural(`${online} agent(s) connecté(s)`)}
          actions={nodeHosts.length > 0 && <Segmented size="sm" label="Filtre" value={nodeOnly ? "node" : "all"} onChange={(v) => setNodeOnly(v === "node")} options={[["all", "Tous"], ["node", `Node.js (${nodeHosts.length})`]]} />}>
          <ul className="mm-list sm:hidden">
            {shown.map(({ h, depth }) => (
              <li key={h.id} className="flex items-center">
                <Link to={`/hosts/${h.id}`} className="mm-list__item min-w-0 flex-1 items-center no-underline" style={depth ? { paddingLeft: `${depth * 2}rem` } : undefined}>
                  <span className="flex min-w-0 items-center gap-3">
                    <StatusIcon status={h.status} size={18} />
                    <span className="min-w-0">
                      <span className="mm-list__title flex items-center gap-2">{guestId(h) && <span className="font-mono text-xs text-meta">{guestId(h)}</span>}<span className="truncate">{h.name}</span></span>
                      <span className="mm-list__meta block truncate tabular-nums">CPU {fmtPct(h.latest.cpu)} · RAM {fmtPct(pct(h.latest.mem_used, h.latest.mem_total))}</span>
                    </span>
                  </span>
                  <StatusBadge status={h.status} label={hostStatusLabel(h)} />
                </Link>
                {fold(h)}
              </li>
            ))}
          </ul>
          <div className="mm-table-wrap hidden sm:block">
            <table className="mm-table min-w-[44rem]">
              <thead><tr><th scope="col">Nom</th><th scope="col">État</th><th scope="col" className="mm-col-num">CPU</th><th scope="col" className="mm-col-num">Mémoire</th><th scope="col" className="mm-col-num">Disque</th><th scope="col">Dernier contact</th></tr></thead>
              <tbody>
                {shown.map(({ h, depth }) => (
                  <tr key={h.id} className="cursor-pointer" onClick={() => navigate(`/hosts/${h.id}`)}>
                    <td className="mm-col-strong">
                      <span className="flex min-w-0 items-center gap-2" style={depth ? { paddingLeft: `${depth * 1.5}rem` } : undefined}>
                        <Link to={`/hosts/${h.id}`} className="min-w-0 truncate text-inherit no-underline hover:text-accent-text" title={[h.info.hostname, h.info.os].filter(Boolean).join(" · ")}>{h.name}</Link>
                        {fold(h)}
                        {h.node_apps && (
                          <Link to={`/hosts/${h.id}#node-title`} onClick={(e) => e.stopPropagation()} className="shrink-0 no-underline" title="Applications Node.js en ligne">
                            <Badge tone={h.node_apps.failing ? "red" : "muted"}>Node.js {h.node_apps.online}/{h.node_apps.apps.length}</Badge>
                          </Link>
                        )}
                      </span>
                    </td>
                    <td><StatusBadge status={h.status} label={hostStatusLabel(h)} /></td>
                    <td className="mm-col-num">{fmtPct(h.latest.cpu)}</td>
                    <td className="mm-col-num">{fmtPct(pct(h.latest.mem_used, h.latest.mem_total))}</td>
                    <td className="mm-col-num">{fmtPct(pct(h.latest.disk_used, h.latest.disk_total))}</td>
                    <td className="mm-col-muted">{fmtAgo(h.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <AddHostWizard open={adding} hosts={data ?? []} onClose={() => { setAdding(false); refresh(); }} />
      <MassDeployDialog open={mass} onClose={() => { setMass(false); refresh(); }} />
    </>
  );
}

type Range = "1h" | "24h" | "7d" | "30d";
type HostTab = "overview" | "apps" | "history" | "hardware" | "network" | "settings";

function SettingRow({ label, action, children, className }: { label: string; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0", className)}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-h1">{label}</p>
        <div className="text-sm text-body">{children}</div>
      </div>
      {action}
    </div>
  );
}

export function HostDetailPage({ id }: { id: number }) {
  const host = usePoll(() => api.get<Host>(`/api/hosts/${id}`), 10000, [id], ["hosts", "metrics"]);
  const [range, setRange] = useState<Range>("24h");
  const [tab, setTab] = useState<HostTab>(location.hash.startsWith("#node") ? "apps" : "overview");
  const [graphs, setGraphs] = useState<"usage" | "io" | "sensors">("usage");
  // The heavy reads follow the tab: a host left on "Aperçu" only polls what it shows.
  const metrics = usePoll(() => tab === "history" ? api.get<HostSeries>(`/api/hosts/${id}/metrics?range=${range}`) : Promise.resolve(undefined), 30000, [id, range, tab], ["metrics"]);
  // Live view: polling asks the agent to stream every 2 s while the page is open.
  const live = usePoll(() => api.get<{ live: boolean; metrics?: HostLatest }>(`/api/hosts/${id}/live`), 2000, [id]);
  const agentAction = useHostAction((updated) => host.setData(updated));
  const disks = usePoll(() => tab === "hardware" ? api.get<HostDisks[]>("/api/disks") : Promise.resolve(undefined), 300000, [id, tab], ["hosts"]);
  const myDisks = disks.data?.find((d) => d.host_id === id);
  const [install, setInstall] = useState<Install>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [upgrade, setUpgrade] = useState<Host>();
  const [lxc, setLxc] = useState(false);
  const [edit, setEdit] = useState<{ name: string; parent: number; was: number }>();
  const [typeDialog, setTypeDialog] = useState(false);
  const all = usePoll(() => api.get<Host[]>("/api/hosts"), 60000, [], ["hosts"]);
  const toast = useToast();
  const h = host.data;
  useTitle(h?.name ?? "Hôtes");
  const m = metrics.data;

  const charts = useMemo(() => m && {
    t: m.t as number[],
    cpu: [{ label: "CPU", values: m.cpu }],
    mem: [{ label: "Mémoire", values: m.mem }, { label: "Swap", values: m.swap }],
    net: [{ label: "Reçu", values: m.net_rx }, { label: "Envoyé", values: m.net_tx }],
    disk: [{ label: "Disque", values: m.disk }],
    temp: m.cpu_temp?.some((v) => v != null)
      ? [{ label: "CPU", values: m.cpu_temp }, { label: "Capteur le plus chaud", values: m.temp }]
      : [{ label: "Capteur le plus chaud", values: m.temp }],
    load: [{ label: "Charge (1 min)", values: m.load1 }],
  }, [m]);

  const update = async (patch: Partial<Host> & { parent?: number }) => {
    try {
      host.setData(await api.patch<Host>(`/api/hosts/${id}`, patch));
      return true;
    } catch (e) { toast((e as Error).message, "error"); return false; }
  };

  if (host.error) return <Alert kind="error" title="Hôte introuvable">{host.error}</Alert>;
  if (!h) return <Skeleton className="h-72" />;
  const isLive = !!live.data?.live && h.connected;
  const l = isLive ? live.data!.metrics! : h.latest;
  const pctFmt = (v: number) => `${Math.round(v)} %`;
  const temp = l.cpu_temp ?? l.temp;
  const parent = all.data?.find((p) => p.id === h.parent_id);

  return (
    <>
      <PageHeader
        crumbs={<><Link to="/hosts" className="text-meta no-underline hover:text-accent-text">Hôtes</Link><ChevronRight size={14} aria-hidden /><span className="text-h2">{h.name}</span></>}
        title={h.name}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={h.status} label={hostStatusLabel(h)} />{parent && <Link to={`/hosts/${parent.id}`} className="no-underline"><Tag>Sous {parent.name}</Tag></Link>}<span className="contents max-sm:hidden">{h.host_type && <Tag>{hostTypeLabel(h.host_type)}</Tag>}{h.info.os && <Tag>{h.info.os}</Tag>}{guestId(h) && <Tag>{h.info.virtualization === "lxc" ? "CT" : "VM"} {guestId(h)}</Tag>}{h.connected ? "Agent connecté" : `Dernier contact ${fmtAgo(h.last_seen)}`}</span></span>}
        desktopActions
        actions={<>
          <Switch label="Maintenance" checked={h.maintenance} onChange={(v) => update({ maintenance: v })} />
          <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => { const p = h.parent_manual ? (h.parent_id ?? 0) : -1; setEdit({ name: h.name, parent: p, was: p }); }}>Modifier</Button>
        </>} />

      <div className={SECTIONS}>
        {h.agent_down && !h.maintenance && (
          <Alert kind={h.reachable ? "warning" : "error"} title={h.reachable ? "Agent hors ligne, l'hôte répond au ping" : h.reachable === false ? "Agent hors ligne, l'hôte ne répond pas au ping" : "Agent hors ligne"}>
            Aucune mesure depuis {fmtAgo(h.last_seen)}. {h.reachable ? "La machine tourne mais le service est arrêté ou bloqué : " : "Vérifie la machine puis le service : "}
            <code className="font-mono">systemctl status hlm-agent</code>
          </Alert>
        )}
        {!!h.node_apps?.failing && tab !== "apps" && (
          <Alert kind="error" title={plural(`${h.node_apps.failing} application(s) Node.js en erreur`)}
            action={<Button size="sm" variant="secondary" onClick={() => setTab("apps")}>Voir les applications</Button>} />
        )}
        <Segmented label="Sections de l'hôte" value={tab} onChange={setTab} options={[
          ["overview", "Aperçu"],
          ...(h.docker || h.node_apps ? [["apps", "Applications"] as [HostTab, string]] : []),
          ["history", "Historique"], ["hardware", "Disques"], ["network", "Réseau"], ["settings", "Réglages"],
        ]} />

        {tab === "overview" && (
          <>
            <div className={STAT_GRID}>
              <Stat label="CPU" value={fmtPct(l.cpu)} tone={(l.cpu ?? 0) >= 90 ? "red" : undefined} detail={h.info.cpu_cores ? `${h.info.cpu_cores} cœurs · charge ${l.load1?.toFixed(2).replace(".", ",") ?? "—"}` : undefined} />
              <Stat label="Mémoire" value={fmtPct(pct(l.mem_used, l.mem_total))} detail={`${fmtBytes(l.mem_used)} / ${fmtBytes(l.mem_total)}`} />
              <Stat label="Disque" value={fmtPct(pct(l.disk_used, l.disk_total))} detail={`${fmtBytes(l.disk_used)} / ${fmtBytes(l.disk_total)}`} />
              <Stat label="Température" value={temp != null ? `${Math.round(temp)} °C` : "—"} tone={temp != null && temp > 80 ? "red" : undefined} detail={`Réseau ↓ ${fmtBytes(l.net_rx, true)} · ↑ ${fmtBytes(l.net_tx, true)}`} />
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="xl:col-span-2" title="Utilisation" sub={isLive ? "En direct" : `Mesure ${fmtAgo(h.last_seen)}`}>
                <div className="grid gap-4">
                  <Meter label="CPU" value={l.cpu ?? null} />
                  <Meter label="Mémoire" value={pct(l.mem_used, l.mem_total)} detail={`${fmtBytes(l.mem_used)} / ${fmtBytes(l.mem_total)}`} />
                  {!!l.swap_total && <Meter label="Swap" value={pct(l.swap_used, l.swap_total)} detail={`${fmtBytes(l.swap_used)} / ${fmtBytes(l.swap_total)}`} />}
                  {l.disks?.map((d) => (
                    <Meter key={d.mount} label={`Disque ${d.mount}`} value={pct(d.used, d.total)} detail={`${fmtBytes(d.used)} / ${fmtBytes(d.total)}`} />
                  ))}
                </div>
              </Card>
              <Card title="Machine" sub={h.info.hostname || h.name}>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Spec label="Système">{h.info.os}</Spec>
                  <Spec label="Architecture">{h.info.arch}</Spec>
                  <Spec label="Noyau"><span className="font-mono" title={h.info.kernel}>{h.info.kernel}</span></Spec>
                  <Spec label="Démarré le">{h.info.boot_time ? fmtDate(h.info.boot_time) : ""}</Spec>
                  <Spec label="Mises à jour">{!h.updates ? "" : h.updates.pending ? `${h.updates.pending} en attente` : "À jour"}</Spec>
                  <Spec label="Déploiement">{hostTypeLabel(h.host_type)}</Spec>
                  <div className="col-span-2"><Spec label="Processeur"><span title={h.info.cpu_model}>{h.info.cpu_model}</span></Spec></div>
                </dl>
              </Card>
            </div>
          </>
        )}

        {tab === "apps" && (
          <>
            {h.node_apps && (
              <section aria-labelledby="node-title">
                <SectionTitle id="node-title">Applications Node.js</SectionTitle>
                <NodeAppsPanel h={h} onChanged={host.refresh} />
              </section>
            )}
            {h.docker && (
              <section aria-labelledby="docker-title">
                <SectionTitle id="docker-title">Conteneurs Docker</SectionTitle>
                <Card flush title={`${h.docker.running}/${h.docker.containers.length} en cours`} sub={`Relevé ${fmtAgo(h.docker.collected_at)}`}>
                  <ContainersTable h={h} onChanged={host.refresh} />
                </Card>
              </section>
            )}
          </>
        )}

        {tab === "history" && (
          <section className="grid gap-4" aria-label="Historique">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Segmented size="sm" label="Mesures" value={graphs} onChange={setGraphs} options={[["usage", "CPU et mémoire"], ["io", "Disque et réseau"], ["sensors", "Température et charge"]]} />
              <Segmented size="sm" label="Période" value={range} onChange={setRange} options={[["1h", "1 h"], ["24h", "24 h"], ["7d", "7 j"], ["30d", "30 j"]]} />
            </div>
            {charts ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {graphs === "usage" && <>
                  <Card title="CPU"><Chart t={charts.t} series={charts.cpu} format={pctFmt} max={100} /></Card>
                  <Card title="Mémoire"><Chart t={charts.t} series={charts.mem} format={pctFmt} max={100} /></Card>
                </>}
                {graphs === "io" && <>
                  <Card title="Disque"><Chart t={charts.t} series={charts.disk} format={pctFmt} max={100} /></Card>
                  <Card title="Bande passante"><Chart t={charts.t} series={charts.net} format={(v) => fmtBytes(v, true)} /></Card>
                </>}
                {graphs === "sensors" && <>
                  <Card title="Température"><Chart t={charts.t} series={charts.temp} format={(v) => `${Math.round(v)} °C`} /></Card>
                  <Card title="Charge système"><Chart t={charts.t} series={charts.load} format={(v) => v.toFixed(1).replace(".", ",")} /></Card>
                </>}
              </div>
            ) : <Skeleton className="h-64" />}
          </section>
        )}

        {tab === "hardware" && (
          <>
            {!disks.data && !disks.error ? <Skeleton className="h-64" /> : myDisks && (
              <section aria-labelledby="disks-title">
                <SectionTitle id="disks-title">Santé des disques</SectionTitle>
                {myDisks.error && <Alert kind="info" title={myDisks.error} className="mb-4" />}
                {myDisks.disks.length === 0 && !myDisks.error && <p className="text-sm text-meta">Aucun disque compatible SMART (machine virtuelle ?).</p>}
                <div className="grid gap-4 lg:grid-cols-2">{myDisks.disks.map((d) => <DiskCard key={d.name + d.serial} d={d} />)}</div>
              </section>
            )}
            <Card flush title="Capteurs de température" sub={plural(`${l.temps?.length ?? 0} capteur(s)`)}>
              {l.temps?.length ? (
                <div className="mm-table-wrap">
                  <table className="mm-table">
                    <thead><tr><th scope="col">Capteur</th><th scope="col" className="mm-col-num">Température</th></tr></thead>
                    <tbody>{l.temps.map((t, i) => <tr key={i}><td>{t.label}</td><td className={cn("mm-col-num", t.c > 80 && "text-red")}>{Math.round(t.c)} °C</td></tr>)}</tbody>
                  </table>
                </div>
              ) : <p className="px-6 py-8 text-center text-sm text-meta">Aucun capteur exposé par cette machine.</p>}
            </Card>
          </>
        )}

        {tab === "network" && (
          <>
            <Card flush title="Interfaces réseau" sub={plural(`${l.ifaces?.length ?? 0} interface(s)`)}>
              <div className="mm-table-wrap">
                <table className="mm-table">
                  <thead><tr><th scope="col">Interface</th><th scope="col" className="mm-col-num">Reçu</th><th scope="col" className="mm-col-num">Envoyé</th></tr></thead>
                  <tbody>{l.ifaces?.map((i) => <tr key={i.name}><td className="mm-col-strong font-mono">{i.name}</td><td className="mm-col-num">{fmtBytes(i.rx, true)}</td><td className="mm-col-num">{fmtBytes(i.tx, true)}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>
            {h.connected && (
              <section aria-labelledby="fw-title">
                <SectionTitle id="fw-title">Pare-feu (iptables)</SectionTitle>
                <IptablesPanel base={`/api/hosts/${h.id}`} />
              </section>
            )}
          </>
        )}

        {tab === "settings" && (
          <Card title="Réglages de l'hôte">
            {/* On a phone, the header's actions live here. */}
            <SettingRow className="sm:hidden" label="Maintenance" action={<Switch label={<span className="sr-only">Maintenance</span>} checked={h.maintenance} onChange={(v) => update({ maintenance: v })} />}>
              Suspend les alertes de l'hôte.
            </SettingRow>
            <SettingRow className="sm:hidden" label="Nom et hôte parent"
              action={<Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => { const p = h.parent_manual ? (h.parent_id ?? 0) : -1; setEdit({ name: h.name, parent: p, was: p }); }}>Modifier</Button>} />
            <SettingRow label="Agent">
              <AgentVersion h={h} onUpdate={() => agentAction.run(h, "update_agent")} updating={agentAction.busy === `${h.id}:update_agent`} />
              {h.action?.action === "update_agent" && h.action.state === "failed" && <p className="mt-1 text-red">{h.action.message}</p>}
            </SettingRow>
            <SettingRow label="Mises à jour système"
              action={<Button size="sm" variant="secondary" icon={<Download size={14} />} disabled={!h.connected || actionBusy(h) || !h.updates?.pending}
                loading={agentAction.busy === `${h.id}:apply_updates`} onClick={() => setUpgrade(h)}>Mettre à jour l'hôte</Button>}>
              {!h.updates ? "Pas encore de relevé" : h.updates.pending ? `${h.updates.pending} en attente${h.updates.security ? `, dont ${h.updates.security} de sécurité` : ""}` : "À jour"}
              <ActionStatus h={h} />
            </SettingRow>
            <SettingRow label="Type de déploiement"
              action={<Button size="sm" variant="secondary" icon={<Pencil size={14} />} loading={agentAction.busy === `${h.id}:reconfigure_agent` || (h.action?.action === "reconfigure_agent" && actionBusy(h))} onClick={() => setTypeDialog(true)}>Changer</Button>}>
              {hostTypeLabel(h.host_type)}{!h.host_type_manual && (h.info.host_type ? " (installation)" : " (détecté)")}
              {h.action?.action === "reconfigure_agent" && !actionBusy(h) && (
                <details className="mt-1" open={h.action.state === "failed"}>
                  <summary className={h.action.state === "failed" ? "cursor-pointer text-red" : "cursor-pointer text-meta"}>Réinstallation {h.action.state === "failed" ? "en échec" : "terminée"} {fmtAgo(h.action.at)}</summary>
                  {h.action.message && <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-line bg-field p-3 font-mono text-xs whitespace-pre-wrap text-h2">{h.action.message}</pre>}
                </details>
              )}
            </SettingRow>
            {h.proxmox && (
              <SettingRow label="Conteneurs LXC"
                action={<Button size="sm" variant="secondary" icon={<Server size={14} />} disabled={!h.connected || actionBusy(h)}
                  loading={agentAction.busy === `${h.id}:enable_lxc`} onClick={() => setLxc(true)}>{h.lxc_sync ? "Rééquiper les conteneurs" : "Passer en serveur Proxmox"}</Button>}>
                {h.lxc_sync ? "Agent installé automatiquement" : "Non équipés"}
              </SettingRow>
            )}
            <SettingRow label="Jeton de l'agent"
              action={<Button size="sm" variant="secondary" icon={<KeyRound size={14} />} onClick={() => api.post<{ install: Install }>(`/api/hosts/${id}/token`).then((r) => setInstall(r.install))}>Régénérer le jeton</Button>}>
              Révoque l'ancien jeton et déconnecte l'agent.
            </SettingRow>
            <SettingRow label="Supprimer l'hôte"
              action={<Button size="sm" variant="danger-ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>Supprimer</Button>}>
              Retire cette machine du monitoring.
            </SettingRow>
          </Card>
        )}
      </div>

      <Dialog open={!!install} onClose={() => setInstall(undefined)} size="lg" title="Nouveau jeton" description="L'ancien jeton est révoqué et l'agent a été déconnecté."
        footer={<Button onClick={() => setInstall(undefined)}>Terminer</Button>}>
        {install && <InstallInstructions install={install} name={h.name} />}
      </Dialog>
      <Dialog open={edit != null} onClose={() => setEdit(undefined)} size="sm" title={`Modifier ${h.name}`}
        description="Le nom et l'hôte parent sont repris par l'inventaire de la gestion à la prochaine synchronisation."
        footer={<><Button variant="secondary" onClick={() => setEdit(undefined)}>Annuler</Button>
          <Button type="submit" form="edit-form">Enregistrer</Button></>}>
        {edit && (
          <form id="edit-form" className="grid gap-5" onSubmit={async (e) => { e.preventDefault(); if (await update({ name: edit.name, ...(edit.parent !== edit.was && { parent: edit.parent }) })) { setEdit(undefined); all.refresh(); } }}>
            <Field label="Nom" htmlFor="h-name"><input id="h-name" className={inputClass} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Hôte parent" htmlFor="h-parent" hint="Automatique : le Proxmox qui voit cette machine sur ses bridges. Un choix manuel n'est jamais modifié.">
              <ParentSelect id="h-parent" hosts={all.data ?? []} self={h.id} value={edit.parent} onChange={(parent) => setEdit({ ...edit, parent })} />
            </Field>
          </form>
        )}
      </Dialog>
      {typeDialog && <DeploymentTypeDialog h={h} open onClose={() => setTypeDialog(false)} onDone={(x) => { host.setData(x); all.refresh(); }} />}
      <UpgradeDialog host={upgrade} onClose={() => setUpgrade(undefined)} onConfirm={(x) => agentAction.run(x, "apply_updates")} />
      <Dialog open={lxc} onClose={() => setLxc(false)} size="sm" title={h.lxc_sync ? "Rééquiper les conteneurs LXC" : "Passer en serveur Proxmox"}
        footer={<><Button variant="secondary" onClick={() => setLxc(false)}>Annuler</Button>
          <Button icon={<Server size={16} />} onClick={() => { setLxc(false); agentAction.run(h, "enable_lxc"); }}>Installer dans les conteneurs</Button></>}>
        <p className="text-sm leading-relaxed text-body">
          Sans rien réinstaller à la main : l'assistant root de l'agent relance <code className="font-mono text-xs text-h2">install.sh</code> avec <code className="font-mono text-xs text-h2">LXC=all</code>.
          L'agent du Proxmox redémarre quelques secondes, garde sa configuration et active SMART ; il s'installe ensuite dans chaque conteneur Debian démarré, sans les arrêter, puis dans les nouveaux toutes les 2 minutes.
          Chaque conteneur reçoit son propre jeton du hub : aucun jeton commun. Les conteneurs étiquetés <code className="font-mono text-xs text-h2">no-hlm</code> sont ignorés.
        </p>
      </Dialog>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} size="sm" title={`Supprimer ${h.name}`}
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Annuler</Button>
          <Button variant="danger" onClick={() => api.del(`/api/hosts/${id}`).then(() => { toast("Hôte supprimé"); navigate("/hosts"); })}>Supprimer l'hôte</Button></>}>
        <div className="grid gap-4">
          <p className="text-sm leading-relaxed text-body">L'hôte et tout son historique de métriques seront supprimés définitivement. L'agent ne pourra plus se connecter ; pour le retirer aussi de la machine (sur un Proxmox, aussi de ses conteneurs LXC) :</p>
          <CodeBlock text={UNINSTALL_COMMAND} />
        </div>
      </Dialog>
    </>
  );
}
