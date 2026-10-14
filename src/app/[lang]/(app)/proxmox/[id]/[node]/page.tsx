import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink, Play, Power, RefreshCw, RotateCw, Square } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getIntegration, type Integration } from "@/lib/data/integrations";
import {
  TIMEFRAMES,
  nodeDisks,
  nodeNetwork,
  nodeRrd,
  nodeServices,
  nodeStatus,
  nodeStorages,
  nodeSyslog,
  nodeTaskList,
  nodeUpdates,
  proxmoxOverview,
  storageContent,
  type Timeframe,
} from "@/lib/integrations/proxmox";
import { aptRefreshAction, nodePowerAction, serviceActionAction } from "@/actions/proxmox";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Meter } from "@/components/ui/meter";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkTabs } from "@/components/ui/tabs";
import { GuestTable } from "@/features/proxmox/guest-table";
import { nodeHref, toGuestRow } from "@/features/proxmox/console-href";
import { ApiError, InfoList, PveTable, RrdGrid, TaskTable, TimeframeTabs, attempt } from "@/features/proxmox/pve-ui";
import { cn, dateFormat, formatBytes, formatUptime, pct } from "@/lib/utils";
import { getT } from "@/i18n/server";
import type { Translate } from "@/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Nœud Proxmox") };
}

type Props = PageProps<"/[lang]/proxmox/[id]/[node]">;

const TABS = [
  ["resume", "Résumé"],
  ["invites", "Invités"],
  ["reseau", "Réseau"],
  ["disques", "Disques"],
  ["stockage", "Stockage"],
  ["services", "Services"],
  ["mises-a-jour", "Mises à jour"],
  ["taches", "Tâches"],
  ["journal", "Journal"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function NodePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-[36rem] rounded-2xl" />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: Props) {
  const tr = await getT();
  await requireUser();
  const { id, node: rawNode } = await params;
  const sp = await searchParams;
  const node = decodeURIComponent(rawNode);
  const i = getIntegration(Number(id));
  if (!i || i.type !== "proxmox") notFound();
  const tab: Tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : "resume";
  const tf: Timeframe = TIMEFRAMES.includes(sp.tf as Timeframe) ? (sp.tf as Timeframe) : "hour";
  const base = nodeHref(i.id, node);

  return (
    <>
      <PageHeader
        title={node}
        description={`${i.name} · ${i.url}`}
        actions={
          <>
            <ButtonLink href="/proxmox" variant="secondary" icon={<ArrowLeft size={16} />}>
              {tr("Proxmox")}</ButtonLink>
            <ButtonLink href={i.url} target="_blank" rel="noreferrer" variant="secondary" icon={<ExternalLink size={16} />}>
              {tr("Web UI")}</ButtonLink>
            <ConfirmButton
              action={nodePowerAction.bind(null, i.id, node, "reboot")}
              variant="secondary"
              size="md"
              icon={<RotateCw size={16} />}
              label="Redémarrer le nœud"
              title="Redémarrer le nœud ?"
              confirmLabel="Redémarrer le nœud"
              pendingLabel="Envoi…"
              message={tr("Le nœud {node} va redémarrer. Les invités sans démarrage automatique resteront arrêtés.", { node })}
            >
              {tr("Redémarrer")}</ConfirmButton>
            <ConfirmButton
              action={nodePowerAction.bind(null, i.id, node, "shutdown")}
              variant="secondary"
              size="md"
              icon={<Power size={16} />}
              label="Éteindre le nœud"
              title="Éteindre le nœud ?"
              confirmLabel="Éteindre le nœud"
              pendingLabel="Envoi…"
              message={tr("Le nœud {node} va s'éteindre. Il faudra le rallumer physiquement ou par Wake-on-LAN / IPMI.", { node })}
            >
              {tr("Éteindre")}</ConfirmButton>
          </>
        }
      />
      <LinkTabs label={tr("Sections du nœud")} active={tab} className="mb-8" items={TABS.map(([v, l]) => ({ value: v, label: tr(l), href: `${base}?tab=${v}` }))} />
      <Suspense key={`${tab}-${tf}-${sp.storage ?? ""}`} fallback={<Skeleton className="h-96 rounded-2xl" />}>
        {tab === "resume" && <Summary i={i} node={node} tf={tf} base={base} tr={tr} />}
        {tab === "invites" && <Guests i={i} node={node} tr={tr} />}
        {tab === "reseau" && <Network i={i} node={node} tr={tr} />}
        {tab === "disques" && <Disks i={i} node={node} tr={tr} />}
        {tab === "stockage" && <Storage i={i} node={node} tr={tr} base={base} selected={typeof sp.storage === "string" ? sp.storage : undefined} />}
        {tab === "services" && <Services i={i} node={node} tr={tr} />}
        {tab === "mises-a-jour" && <Updates i={i} node={node} tr={tr} />}
        {tab === "taches" && <Tasks i={i} node={node} tr={tr} />}
        {tab === "journal" && <Syslog i={i} node={node} tr={tr} />}
      </Suspense>
    </>
  );
}

type TabProps = { i: Integration; node: string; tr: Translate };

async function Summary({ i, node, tf, base, tr }: TabProps & { tf: Timeframe; base: string }) {
  const [status, rrd] = await Promise.all([attempt(nodeStatus(i, node)), attempt(nodeRrd(i, node, tf))]);
  if (!status.ok) return <ApiError error={status.error} />;
  const d = status.data;
  return (
    <div className="grid gap-10">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="grid content-start gap-4 p-5">
          <Meter label="CPU" value={d.cpu * 100} detail={`${(d.cpu * 100).toFixed(1)} % · ${d.cpuinfo.cpus} threads`} />
          <Meter label={tr("Mémoire")} value={pct(d.memory.used, d.memory.total)} detail={`${formatBytes(d.memory.used, tr.locale)} / ${formatBytes(d.memory.total, tr.locale)}`} />
          {d.swap && d.swap.total > 0 && <Meter label="Swap" value={pct(d.swap.used, d.swap.total)} detail={`${formatBytes(d.swap.used, tr.locale)} / ${formatBytes(d.swap.total, tr.locale)}`} />}
          <Meter label={tr("Disque racine")} value={pct(d.rootfs.used, d.rootfs.total)} detail={`${formatBytes(d.rootfs.used, tr.locale)} / ${formatBytes(d.rootfs.total, tr.locale)}`} />
        </Card>
        <Card className="p-5 lg:col-span-2">
          <InfoList
            items={[
              [tr("Uptime"), <span key="u" className="font-mono">{formatUptime(d.uptime, tr.locale)}</span>],
              [tr("Charge (1, 5, 15 min)"), <span key="l" className="font-mono">{d.loadavg?.join(" · ")}</span>],
              [tr("Processeur"), d.cpuinfo.model],
              [tr("Topologie"), `${d.cpuinfo.sockets} socket(s) · ${d.cpuinfo.cores} cœurs · ${d.cpuinfo.cpus} threads`],
              [tr("Fréquence"), `${Math.round(Number(d.cpuinfo.mhz))} MHz`],
              [tr("Noyau"), <span key="k" className="font-mono">{d["current-kernel"]?.release ?? d.kversion.split(" ")[2]}</span>],
              [tr("Version PVE"), <span key="v" className="font-mono">{d.pveversion}</span>],
            ]}
          />
        </Card>
      </div>
      <section>
        <SectionTitle actions={<TimeframeTabs base={`${base}?tab=resume`} active={tf} tr={tr} />}>{tr("Historique")}</SectionTitle>
        {!rrd.ok ? (
          <ApiError error={rrd.error} />
        ) : (
          <RrdGrid
            points={rrd.data}
            series={[
              { title: tr("Utilisation CPU"), key: "cpu", format: "pct", max: 1 },
              { title: tr("Charge système"), key: "loadavg", format: "num" },
              { title: tr("Mémoire utilisée"), key: "memused", format: "bytes", max: (p) => p.find((x) => x.memtotal)?.memtotal },
              { title: tr("Attente E/S (IO delay)"), key: "iowait", format: "pct" },
              { title: tr("Réseau entrant"), key: "netin", format: "rate" },
              { title: tr("Réseau sortant"), key: "netout", format: "rate" },
            ]}
          />
        )}
      </section>
    </div>
  );
}

async function Guests({ i, node, tr }: TabProps) {
  const o = await attempt(proxmoxOverview(i));
  if (!o.ok) return <ApiError error={o.error} />;
  const guests = o.data.guests.filter((g) => g.node === node).map((g) => toGuestRow(i, g));
  if (!guests.length) return <p className="text-sm text-meta">{tr("Aucune VM ni aucun conteneur sur ce nœud.")}</p>;
  return <GuestTable guests={guests} integrations={[{ id: i.id, name: i.name }]} />;
}

async function Network({ i, node, tr }: TabProps) {
  const r = await attempt(nodeNetwork(i, node));
  if (!r.ok) return <ApiError error={r.error} />;
  return (
    <PveTable
      head={[tr("Interface"), tr("Type"), tr("Active"), tr("Démarrage auto"), tr("Ports / esclaves"), "CIDR", tr("Passerelle"), tr("VLAN aware"), tr("Commentaire")]}
      empty={tr("Aucune interface.")}
      rows={[...r.data]
        .sort((a, b) => a.iface.localeCompare(b.iface))
        .map((n) => [
          <span key="i" className="font-mono font-medium text-h1">{n.iface}</span>,
          <span key="t" className="font-mono text-xs">{n.type}</span>,
          <YesNo key="a" v={n.active} tr={tr} />,
          <YesNo key="s" v={n.autostart} tr={tr} />,
          <span key="p" className="font-mono text-xs">{n.bridge_ports || "—"}</span>,
          <span key="c" className="font-mono text-xs">{n.cidr ?? n.address ?? "—"}</span>,
          <span key="g" className="font-mono text-xs">{n.gateway ?? "—"}</span>,
          <YesNo key="v" v={n["bridge-vlan-aware"]} tr={tr} />,
          <span key="m" className="text-xs text-body">{n.comments?.trim() || "—"}</span>,
        ])}
    />
  );
}

function YesNo({ v, tr }: { v?: number; tr: Translate }) {
  return <span className={cn("text-xs", v ? "text-green" : "text-meta")}>{v ? tr("Oui") : tr("Non")}</span>;
}

async function Disks({ i, node, tr }: TabProps) {
  const r = await attempt(nodeDisks(i, node));
  if (!r.ok) return <ApiError error={r.error} />;
  return (
    <PveTable
      head={[tr("Périphérique"), tr("Type"), tr("Modèle"), tr("Numéro de série"), tr("Taille"), tr("Utilisation"), "SMART", tr("Usure")]}
      align={[undefined, undefined, undefined, undefined, "right"]}
      empty={tr("Aucun disque détecté.")}
      rows={r.data.map((d) => {
        const healthy = d.health === "PASSED" || d.health === "OK";
        return [
          <span key="d" className="font-mono font-medium text-h1">{d.devpath}</span>,
          <span key="t" className="font-mono text-xs uppercase">{d.type ?? "—"}</span>,
          d.model ?? "—",
          <span key="s" className="font-mono text-xs">{d.serial ?? "—"}</span>,
          formatBytes(d.size, tr.locale),
          <span key="u" className="text-xs">{d.used ?? tr("Libre")}</span>,
          d.health ? <Badge key="h" tone={healthy ? "green" : d.health === "UNKNOWN" ? "muted" : "red"}>{d.health}</Badge> : "—",
          <span key="w" className="font-mono text-xs">{typeof d.wearout === "number" ? `${100 - d.wearout} %` : "—"}</span>,
        ];
      })}
    />
  );
}

async function Storage({ i, node, tr, base, selected }: TabProps & { base: string; selected?: string }) {
  const r = await attempt(nodeStorages(i, node));
  if (!r.ok) return <ApiError error={r.error} />;
  const current = r.data.find((s) => s.storage === selected) ?? r.data.find((s) => s.active);
  const content = current ? await attempt(storageContent(i, node, current.storage)) : null;
  const fmt = dateFormat(tr.locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="grid gap-10">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {r.data.map((s) => (
          <Link key={s.storage} href={`${base}?tab=stockage&storage=${encodeURIComponent(s.storage)}`} scroll={false}>
            <Card className={cn("h-full p-4 transition-colors hover:border-line-strong", current?.storage === s.storage && "border-accent")}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="truncate font-medium text-h1">{s.storage}</span>
                <span className="shrink-0 font-mono text-xs text-meta">{s.type}</span>
              </div>
              <Meter value={pct(s.used ?? 0, s.total ?? 0)} label={s.active ? s.content.replaceAll(",", ", ") : tr("Inactif")} detail={`${formatBytes(s.used, tr.locale)} / ${formatBytes(s.total, tr.locale)}`} />
            </Card>
          </Link>
        ))}
      </div>
      {current && content && (
        <section>
          <SectionTitle>{tr("Contenu de {storage}", { storage: current.storage })}</SectionTitle>
          {!content.ok ? (
            <ApiError error={content.error} />
          ) : (
            <PveTable
              head={[tr("Volume"), tr("Contenu"), tr("Format"), tr("Invité"), tr("Date"), tr("Taille")]}
              align={[undefined, undefined, undefined, undefined, undefined, "right"]}
              empty={tr("Stockage vide.")}
              rows={content.data
                .sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0))
                .map((v) => [
                  <span key="v" className="break-all font-mono text-xs text-h1">{v.volid.split(":").slice(1).join(":")}</span>,
                  <span key="c" className="text-xs">{v.content}</span>,
                  <span key="f" className="font-mono text-xs">{v.format ?? "—"}</span>,
                  <span key="g" className="font-mono text-xs">{v.vmid ?? "—"}</span>,
                  <span key="d" className="whitespace-nowrap text-xs">{v.ctime ? fmt.format(new Date(v.ctime * 1000)) : "—"}</span>,
                  formatBytes(v.size, tr.locale),
                ])}
            />
          )}
        </section>
      )}
    </div>
  );
}

async function Services({ i, node, tr }: TabProps) {
  const r = await attempt(nodeServices(i, node));
  if (!r.ok) return <ApiError error={r.error} />;
  return (
    <PveTable
      head={[tr("Service"), tr("Description"), tr("État"), tr("Unité"), ""]}
      align={[undefined, undefined, undefined, undefined, "right"]}
      empty={tr("Aucun service.")}
      rows={r.data.map((s) => {
        const running = s.state === "running";
        return [
          <span key="n" className="font-mono font-medium text-h1">{s.name}</span>,
          <span key="d" className="text-xs text-body">{s.desc ?? "—"}</span>,
          <Badge key="s" tone={running ? "green" : s.state === "dead" ? "muted" : "yellow"}>{s.state}</Badge>,
          <span key="u" className="font-mono text-xs text-meta">{s["unit-state"] ?? "—"}</span>,
          <div key="a" className="flex justify-end gap-0.5">
            {!running && <ActionButton action={serviceActionAction.bind(null, i.id, node, s.service, "start")} variant="subtle" size="icon-sm" title={tr("Démarrer")} icon={<Play size={14} />} />}
            {running && (
              <ConfirmButton
                action={serviceActionAction.bind(null, i.id, node, s.service, "restart")}
                icon={<RotateCw size={14} />}
                label="Redémarrer"
                title="Redémarrer le service ?"
                confirmLabel="Redémarrer"
                pendingLabel="Envoi…"
                message={tr("Redémarrer {name} sur {node} ? Les services pveproxy et pvedaemon coupent brièvement l'API.", { name: s.name, node })}
              />
            )}
            {running && (
              <ConfirmButton
                action={serviceActionAction.bind(null, i.id, node, s.service, "stop")}
                icon={<Square size={14} />}
                label="Arrêter"
                title="Arrêter le service ?"
                confirmLabel="Arrêter"
                pendingLabel="Envoi…"
                message={tr("Arrêter {name} sur {node} ? Arrêter pveproxy coupe l'accès à l'API et à cette page.", { name: s.name, node })}
              />
            )}
          </div>,
        ];
      })}
    />
  );
}

async function Updates({ i, node, tr }: TabProps) {
  const r = await attempt(nodeUpdates(i, node));
  return (
    <section>
      <SectionTitle
        actions={
          <ActionButton action={aptRefreshAction.bind(null, i.id, node)} variant="secondary" size="sm" icon={<RefreshCw size={14} />} pendingLabel={tr("Envoi…")}>
            {tr("Actualiser les dépôts")}</ActionButton>
        }
      >
        {r.data ? tr("{n} paquet(s) à mettre à jour", { n: r.data.length }) : tr("Mises à jour")}
      </SectionTitle>
      {!r.ok ? (
        <ApiError error={r.error} />
      ) : (
        <PveTable
          head={[tr("Paquet"), tr("Version actuelle"), tr("Nouvelle version"), tr("Priorité"), tr("Description")]}
          empty={tr("Le nœud est à jour.")}
          rows={r.data.map((u) => [
            <span key="p" className="font-mono font-medium text-h1">{u.Package}</span>,
            <span key="o" className="font-mono text-xs text-meta">{u.OldVersion ?? "—"}</span>,
            <span key="v" className="font-mono text-xs text-accent-text">{u.Version}</span>,
            <span key="pr" className="text-xs">{u.Priority ?? "—"}</span>,
            <span key="t" className="text-xs text-body">{u.Title ?? ""}</span>,
          ])}
        />
      )}
      <p className="mt-3 text-xs text-meta">{tr("L'installation (apt dist-upgrade) se fait depuis le shell du nœud : l'API Proxmox ne la propose pas.")}</p>
    </section>
  );
}

async function Tasks({ i, node, tr }: TabProps) {
  const r = await attempt(nodeTaskList(i, node));
  return !r.ok ? <ApiError error={r.error} /> : <TaskTable tasks={r.data} tr={tr} />;
}

async function Syslog({ i, node, tr }: TabProps) {
  const r = await attempt(nodeSyslog(i, node, 500));
  if (!r.ok) return <ApiError error={r.error} />;
  return (
    <Card className="overflow-hidden">
      <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs leading-relaxed text-body">
        {r.data.map((l) => l.t).join("\n") || tr("Journal vide.")}
      </pre>
    </Card>
  );
}

