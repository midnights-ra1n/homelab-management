import type { Metadata } from "next";
import { Suspense } from "react";
import { ExternalLink, RefreshCw, Server, Settings } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fetchProxmox } from "@/lib/integrations";
import { listIntegrations } from "@/lib/data/integrations";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { SkeletonGrid } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { GuestTable, type GuestRow } from "@/features/proxmox/guest-table";
import { NodeTasks } from "@/features/proxmox/node-tasks";
import { SyncProxmoxButton } from "@/features/proxmox/sync-button";
import { nodeHref, toGuestRow } from "@/features/proxmox/console-href";
import Link from "next/link";
import { formatBytes, formatUptime, pct } from "@/lib/utils";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Proxmox") };
}

export default async function ProxmoxPage() {
  const tr = await getT();
  return (
    <>
      <PageHeader
        title={tr("Tous tes nœuds, sans cluster")}
        description={tr("Agrège des hôtes Proxmox VE autonomes — sans quorum à 3 nœuds ni Proxmox Datacenter Manager : état, ressources, actions sur les invités et migration distante.")}
        actions={
          <ButtonLink href="/parametres#integrations" variant="secondary" icon={<Settings size={16} />}>
            {tr("Gérer les nœuds")}</ButtonLink>
        }
      />
      <Suspense fallback={<SkeletonGrid count={3} />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  const tr = await getT();
  await requireUser();
  if (listIntegrations("proxmox").length === 0) {
    return (
      <EmptyState
        icon={<Server size={22} />}
        title={tr("Aucun nœud Proxmox configuré")}
        action={
          <ButtonLink href="/parametres#integrations" icon={<Settings size={16} />}>
            {tr("Ajouter un nœud")}</ButtonLink>
        }
      >
        {tr("Crée un jeton API sur chaque nœud (Datacenter → Permissions → API Tokens, rôle PVEAuditor pour la lecture, PVEVMAdmin pour les actions) puis ajoute-le dans les paramètres.")}</EmptyState>
    );
  }

  const sources = await fetchProxmox();
  const ok = sources.filter((s) => s.ok && s.data);
  const nodes = ok.flatMap((s) => s.data!.nodes.map((n) => ({ ...n, source: s })));
  const guests: GuestRow[] = ok.flatMap((s) =>
    s.data!.guests.map((g) => toGuestRow(s, g)),
  );
  const storages = ok.flatMap((s) => s.data!.storages.map((st) => ({ ...st, sourceName: s.name })));
  const online = nodes.filter((n) => n.status === "online");
  const running = guests.filter((g) => g.status === "running").length;
  const memUsed = online.reduce((n, x) => n + (x.mem ?? 0), 0);
  const memMax = online.reduce((n, x) => n + (x.maxmem ?? 0), 0);
  const cpuTotal = online.reduce((n, x) => n + (x.maxcpu ?? 0), 0);
  const cpuUsed = online.reduce((n, x) => n + (x.cpu ?? 0) * (x.maxcpu ?? 0), 0);

  return (
    <div className="grid grid-cols-1 gap-10 xl:gap-14">
      {sources
        .filter((s) => !s.ok)
        .map((s) => (
          <Alert key={s.id} kind="error" title={tr("{name} injoignable", { name: s.name })}>
            {s.error}
          </Alert>
        ))}

      <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4 xl:gap-8">
        <Stat label={tr("Nœuds en ligne")} value={`${online.length}/${nodes.length}`} detail={tr("{length} intégration(s)", { length: sources.length })} />
        <Stat label={tr("Invités démarrés")} value={`${running}/${guests.length}`} detail={`${guests.filter((g) => g.type === "qemu").length} VM · ${guests.filter((g) => g.type === "lxc").length} CT`} />
        <Stat label={tr("CPU agrégé")} value={`${pct(cpuUsed, cpuTotal)} %`} detail={tr("{n} threads", { n: cpuTotal })} />
        <Stat label={tr("Mémoire agrégée")} value={`${pct(memUsed, memMax)} %`} detail={`${formatBytes(memUsed, tr.locale)} / ${formatBytes(memMax, tr.locale)}`} />
      </div>

      <section aria-labelledby="nodes">
        <SectionTitle id="nodes" actions={<SyncProxmoxButton icon={<RefreshCw size={15} />} />}>
          {tr("Nœuds")}</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {nodes.map((n) => {
            const d = n.details;
            const isOnline = n.status === "online";
            return (
              <Card key={`${n.source.id}-${n.node}`} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        {isOnline && <span className="ping absolute inset-0 rounded-full bg-green" />}
                        <span className={`relative h-2.5 w-2.5 rounded-full ${isOnline ? "bg-green" : "bg-red"}`} />
                      </span>
                      <Link href={nodeHref(n.source.id, n.node)} className="truncate text-lg font-semibold text-h1 hover:text-accent-text">{n.node}</Link>
                    </p>
                    <p className="mt-1 font-mono text-xs text-meta">
                      {n.source.name} {tr("· PVE ")}{n.source.data!.version}
                    </p>
                  </div>
                  <Badge tone={isOnline ? "green" : "red"}>{isOnline ? tr("En ligne") : tr("Hors ligne")}</Badge>
                </div>
                {isOnline ? (
                  <div className="mt-5 grid gap-3">
                    <Meter label="CPU" value={(n.cpu ?? 0) * 100} detail={tr("{cpu} % · {n} threads", { cpu: Math.round((n.cpu ?? 0) * 100), n: n.maxcpu })} />
                    <Meter label={tr("Mémoire")} value={pct(n.mem ?? 0, n.maxmem ?? 0)} detail={`${formatBytes(n.mem, tr.locale)} / ${formatBytes(n.maxmem, tr.locale)}`} />
                    <Meter label={tr("Disque racine")} value={pct(n.disk ?? 0, n.maxdisk ?? 0)} detail={`${formatBytes(n.disk, tr.locale)} / ${formatBytes(n.maxdisk, tr.locale)}`} />
                    {d && (
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <div>
                          <dt className="text-meta">{tr("Uptime")}</dt>
                          <dd className="font-mono text-h2">{formatUptime(d.uptime, tr.locale)}</dd>
                        </div>
                        <div>
                          <dt className="text-meta">{tr("Charge")}</dt>
                          <dd className="font-mono text-h2">{d.loadavg?.join(" · ")}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-meta">{tr("Processeur")}</dt>
                          <dd className="truncate text-h2">
                            {d.cpuinfo.model} · {d.cpuinfo.sockets}×{d.cpuinfo.cores}c
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-meta">{tr("Noyau")}</dt>
                          <dd className="truncate font-mono text-h2">{d["current-kernel"]?.release ?? d.kversion.split(" ")[2]}</dd>
                        </div>
                      </dl>
                    )}
                  </div>
                ) : (
                  <p className="mt-5 text-sm text-meta">{tr("Nœud injoignable depuis son API.")}</p>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 pt-5">
                  <span className="font-mono text-xs text-meta">
                    {guests.filter((g) => g.integrationId === n.source.id && g.node === n.node).length} {tr("invité(s)")}</span>
                  <div className="flex gap-1">
                    {isOnline && <NodeTasks integrationId={n.source.id} node={n.node} />}
                    <ButtonLink href={nodeHref(n.source.id, n.node)} variant="ghost" size="sm" icon={<Server size={14} />}>
                      {tr("Gérer")}</ButtonLink>
                    <ButtonLink href={n.source.url} target="_blank" rel="noreferrer" variant="ghost" size="sm" icon={<ExternalLink size={14} />}>
                      {tr("Web UI")}</ButtonLink>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="guests">
        <SectionTitle id="guests">{tr("Machines virtuelles & conteneurs")}</SectionTitle>
        <GuestTable guests={guests} integrations={ok.map((s) => ({ id: s.id, name: s.name }))} />
      </section>

      {storages.length > 0 && (
        <section aria-labelledby="storages">
          <SectionTitle id="storages">{tr("Stockages")}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {storages.map((s) => (
              <Card key={s.id + s.sourceName} className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-h1">{s.storage}</span>
                  <span className="shrink-0 font-mono text-xs text-meta">{s.plugintype}</span>
                </div>
                <Meter
                  value={pct(s.disk ?? 0, s.maxdisk ?? 0)}
                  label={s.node + (s.shared ? tr(" · partagé") : "")}
                  detail={`${formatBytes(s.disk, tr.locale)} / ${formatBytes(s.maxdisk, tr.locale)}`}
                />
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
