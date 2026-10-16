import Link from "next/link";
import { cache, Suspense, use } from "react";
import { Activity, AlertTriangle, ArrowUpRight, Boxes, ClipboardList, Cpu, HardDrive, MemoryStick, Network, Plus, Rocket, Server, ShieldAlert, Zap, PackageCheck } from "lucide-react";
import { assetCounts, hardwareTotals, storageTotalGb } from "@/lib/data/assets";
import { deploymentCounts, listDeployments } from "@/lib/data/deployments";
import { openTasks, taskCounts } from "@/lib/data/tasks";
import { ipamTotals, listSubnets } from "@/lib/data/network";
import { listIntegrations } from "@/lib/data/integrations";
import { fetchProxmox } from "@/lib/integrations";
import { collectAlerts } from "@/lib/monitor/alerts";
import { AlertBanner } from "@/components/alert-banner";
import {
  ASSET_KINDS,
  ASSET_KIND_META,
  DEPLOYMENT_KIND_META,
  DEPLOYMENT_STATUS_META,
  PRIORITY_META,
  TONE_VAR,
} from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { KindIcon } from "@/components/kind-icon";
import { cn, formatBytes, formatDate, formatGb, isOverdue, pct } from "@/lib/utils";
import { getT } from "@/i18n/server";

export default function DashboardPage() {
  const tr = use(getT());
  return (
    <>
      <header className="mb-8 sm:mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-h1 sm:text-5xl">
          {tr("Tableau de ")}<span className="text-accent-text">{tr("bord")}</span>
        </h1>
      </header>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-8 xl:gap-10">
      <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4 xl:gap-8">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

function Dashboard() {
  const tr = use(getT());
  const assets = use(assetCounts());
  const ipam = use(ipamTotals());
  const deployments = use(deploymentCounts());
  const tasks = use(taskCounts());
  const hasProxmox = use(listIntegrations("proxmox", true)).length > 0;
  const hasMonitoring =
    use(listIntegrations("hlm", true)).length > 0;

  return (
    <div className="grid grid-cols-1 gap-8 xl:gap-10">
      {hasMonitoring && (
        <Suspense fallback={null}>
          <DashboardAlertBanner />
        </Suspense>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4 xl:gap-8">
        <Stat
          href="/inventaire"
          label={tr("Éléments inventoriés")}
          value={assets.total}
          icon={<Boxes size={16} />}
          detail={
            ASSET_KINDS.filter((k) => assets.byKind[k])
              .map((k) => `${assets.byKind[k]} ${tr(ASSET_KIND_META[k].label).split(" ")[0].toLowerCase()}`)
              .join(" · ") || tr("Inventaire vide")
          }
        />
        <Stat
          href="/reseau"
          label={tr("Adresses IP")}
          value={ipam.used}
          icon={<Network size={16} />}
          detail={tr("{0} % de {subnets} sous-réseau(x)", { "0": pct(ipam.used, ipam.capacity), subnets: ipam.subnets })}
        />
        <Stat
          href="/deploiements"
          label={tr("Déploiements actifs")}
          value={deployments.active}
          icon={<Rocket size={16} />}
          tone={deployments.by.blocked ? "red" : "accent"}
          detail={deployments.by.blocked ? tr("{blocked} bloqué(s)", { blocked: deployments.by.blocked }) : tr("{0} terminé(s)", { "0": deployments.by.done ?? 0 })}
        />
        <Stat
          href="/taches"
          label={tr("Tâches ouvertes")}
          value={tasks.todo + tasks.in_progress}
          icon={<ClipboardList size={16} />}
          tone={tasks.overdue ? "yellow" : "accent"}
          detail={tasks.overdue ? tr("{overdue} en retard", { overdue: tasks.overdue }) : tr("{in_progress} en cours", { in_progress: tasks.in_progress })}
        />
      </div>

      {/* Live : Proxmox + monitoring (toujours affichés, état vide si non configuré) */}
      <div className="grid gap-8 xl:grid-cols-2 xl:gap-10">
        <div>
          {hasProxmox ? (
            <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
              <ProxmoxWidget />
            </Suspense>
          ) : (
            <NotConfigured
              overline={tr("Proxmox")}
              title={tr("Aucun nœud connecté")}
              text={tr("Ajoute un jeton API par nœud Proxmox VE pour suivre leurs ressources et leurs invités ici.")}
              icon={<Server size={20} />}
            />
          )}
        </div>
        <div>
          {hasMonitoring ? (
            <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
              <MonitoringWidget />
            </Suspense>
          ) : (
            <NotConfigured
              overline={tr("Monitoring")}
              title={tr("Aucune instance de monitoring")}
              text={tr("Connecte Homelab Monitoring : sondes, pannes, certificats et mises à jour remonteront ici.")}
              icon={<Activity size={20} />}
              href="/parametres#integrations"
              cta={tr("Connecter une intégration")}
            />
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2 xl:gap-10">
        <div>
          <DeploymentsWidget />
        </div>
        <div>
          <TasksWidget />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2 xl:gap-10">
        <div>
          <CapacityWidget />
        </div>
        <div>
          <SubnetsWidget />
        </div>
      </div>

    </div>
  );
}

/* --------------------------------------------------------------------------- */

function ProxmoxWidget() {
  const tr = use(getT());
  const sources = use(fetchProxmox());
  const nodes = sources.flatMap((s) => (s.data?.nodes ?? []).map((n) => ({ ...n, source: s.name })));
  const guests = sources.flatMap((s) => s.data?.guests ?? []);
  const running = guests.filter((g) => g.status === "running").length;
  const errors = sources.filter((s) => !s.ok);
  return (
    <Card className="h-full">
      <CardHeader
        overline={tr("Proxmox")}
        title={tr("{online}/{nodes} nœud(s) · {running}/{guests} invité(s) actifs", { online: nodes.filter((n) => n.status === "online").length, nodes: nodes.length, running, guests: guests.length })}
        actions={
          <ButtonLink href="/proxmox" variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>
            {tr("Détails")}</ButtonLink>
        }
      />
      <CardBody className="grid gap-4">
        {errors.map((e) => (
          <p key={e.id} className="flex items-center gap-2 text-sm text-red">
            <span aria-hidden="true">✕</span> {e.name} : {tr(e.error)}
          </p>
        ))}
        {nodes.map((n) => (
          <div key={`${n.source}-${n.node}`} className="rounded-xl border border-line-subtle bg-page p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-medium text-h1">
                <Server size={15} className="text-meta" aria-hidden="true" />
                {n.node}
              </span>
              <Badge tone={n.status === "online" ? "green" : "red"} dot>
                {n.status === "online" ? tr("En ligne") : tr("Hors ligne")}
              </Badge>
            </div>
            {n.status === "online" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Meter size="sm" label="CPU" value={(n.cpu ?? 0) * 100} />
                <Meter size="sm" label={tr("Mémoire")} value={pct(n.mem ?? 0, n.maxmem ?? 0)} detail={`${formatBytes(n.mem, tr.locale)} / ${formatBytes(n.maxmem, tr.locale)}`} />
              </div>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

/** Une seule collecte par requête, partagée par la bannière et le widget. */
const dashboardAlerts = cache(async () => collectAlerts(await getT()));

function DashboardAlertBanner() {
  const { alerts } = use(dashboardAlerts());
  return <AlertBanner initial={alerts} />;
}

function MonitoringWidget() {
  const tr = use(getT());
  const { m, alerts } = use(dashboardAlerts());
  return (
    <Card className="h-full">
      <CardHeader
        overline={tr("Monitoring")}
        title={alerts.length ? tr("{n} point(s) d'attention", { n: alerts.length }) : tr("Tout est au vert")}
        actions={
          <ButtonLink href="/monitoring" variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>
            {tr("Détails")}</ButtonLink>
        }
      />
      <CardBody className="grid gap-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: tr("Sondes"), value: m.probes.total ? `${m.probes.total - m.probes.down.length}/${m.probes.total}` : "—", icon: Activity },
            { label: tr("Systèmes"), value: m.systems.total ? `${m.systems.up}/${m.systems.total}` : "—", icon: Server },
            { label: tr("Mises à jour"), value: m.patches.hosts ? m.patches.updates : "—", icon: PackageCheck },
            { label: tr("MàJ sécurité"), value: m.patches.hosts ? m.patches.security : "—", icon: ShieldAlert },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-line-subtle bg-page p-3">
              <dt className="flex items-center gap-1.5 text-xs text-meta">
                <k.icon size={13} aria-hidden="true" /> {k.label}
              </dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-h1">{k.value}</dd>
            </div>
          ))}
        </dl>
        {alerts.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-green">
            <span aria-hidden="true">✓</span> {tr("Aucune alerte en cours.")}{m.patches.updates > 0 && <span className="text-meta"> · {m.patches.updates} {tr("mise(s) à jour disponibles")}</span>}
          </p>
        ) : (
          <ul className="grid max-h-56 gap-1.5 overflow-y-auto">
            {alerts.slice(0, 12).map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-page">
                  <AlertTriangle size={14} style={{ color: TONE_VAR[a.tone] }} className="shrink-0" aria-hidden="true" />
                  <span className="truncate text-h2">{tr(a.text)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function NotConfigured({
  overline,
  title,
  text,
  icon,
  href = "/parametres#integrations",
  cta = "Connecter une intégration",
}: {
  overline: string;
  title: string;
  text: string;
  icon: React.ReactNode;
  href?: string;
  cta?: string;
}) {
  const tr = use(getT());
  cta = tr(cta);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader overline={overline} title={title} />
      <CardBody className="flex flex-1 flex-col items-start gap-5">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">{icon}</span>
          <p className="text-sm leading-relaxed text-body">{text}</p>
        </div>
        <ButtonLink href={href} variant="secondary" size="sm" icon={<Plus size={14} />} className="mt-auto">
          {cta}
        </ButtonLink>
      </CardBody>
    </Card>
  );
}

function DeploymentsWidget() {
  const tr = use(getT());
  const items = use(listDeployments({ status: "active" })).slice(0, 6);
  return (
    <Card className="h-full">
      <CardHeader
        overline={tr("Déploiements")}
        title={tr("En cours")}
        actions={
          <ButtonLink href="/deploiements/nouveau" variant="ghost" size="sm" icon={<Plus size={14} />}>
            {tr("Nouveau")}</ButtonLink>
        }
      />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-sm text-meta">{tr("Aucun déploiement en cours.")}</p>
        ) : (
          <ul className="grid gap-2">
            {items.map((d) => {
              const progress = pct(d.steps_done, d.steps_total);
              return (
                <li key={d.id}>
                  <Link
                    href={`/deploiements/${d.id}`}
                    className="block rounded-xl border border-line-subtle bg-page px-4 py-3 transition-colors hover:border-line-accent"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-h1">{d.title}</span>
                      <span className="flex shrink-0 gap-1.5">
                        <Badge tone={DEPLOYMENT_KIND_META[d.kind].tone}>{tr(DEPLOYMENT_KIND_META[d.kind].label)}</Badge>
                        <Badge tone={DEPLOYMENT_STATUS_META[d.status].tone} dot>
                          {tr(DEPLOYMENT_STATUS_META[d.status].label)}
                        </Badge>
                      </span>
                    </div>
                    {d.steps_total > 0 && (
                      <Meter
                        className="mt-3"
                        size="sm"
                        value={progress}
                        tone={d.status === "blocked" ? "red" : "accent"}
                        label={tr("{done}/{total} étapes", { done: d.steps_done, total: d.steps_total }) + (d.target_date ? tr(" · cible {date}", { date: formatDate(d.target_date, tr.locale) }) : "")}
                        detail={`${progress} %`}
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function TasksWidget() {
  const tr = use(getT());
  const items = use(openTasks(7));
  return (
    <Card className="h-full">
      <CardHeader
        overline={tr("Tâches")}
        title={tr("À faire prochainement")}
        actions={
          <ButtonLink href="/taches" variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>
            {tr("Kanban")}</ButtonLink>
        }
      />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-sm text-meta">{tr("Rien en attente. Profite.")}</p>
        ) : (
          <ul className="grid gap-1">
            {items.map((t) => {
              const late = isOverdue(t.due_date);
              return (
                <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-page">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_VAR[PRIORITY_META[t.priority].tone] }} title={tr(PRIORITY_META[t.priority].label)} />
                  <span className="min-w-0 flex-1 truncate text-sm text-h2">{t.title}</span>
                  {t.status === "in_progress" && <Badge tone="accent">{tr("En cours")}</Badge>}
                  {t.due_date && (
                    <span className={cn("shrink-0 font-mono text-xs", late ? "text-red" : "text-meta")}>{formatDate(t.due_date, tr.locale)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function CapacityWidget() {
  const tr = use(getT());
  const hw = use(hardwareTotals());
  const storage = use(storageTotalGb());
  const counts = use(assetCounts());
  const max = Math.max(1, ...ASSET_KINDS.map((k) => counts.byKind[k] ?? 0));
  return (
    <Card className="h-full">
      <CardHeader overline={tr("Capacité")} title={tr("{n} serveur(s) physique(s)", { n: hw.servers })} />
      <CardBody className="grid gap-5">
        <dl className="grid grid-cols-2 gap-3">
          {[
            { icon: Cpu, label: tr("Cœurs / threads"), value: `${hw.cores} / ${hw.threads}` },
            { icon: MemoryStick, label: tr("Mémoire"), value: formatGb(hw.ram_gb, tr.locale) },
            { icon: HardDrive, label: tr("Stockage brut"), value: formatGb(storage, tr.locale) },
            { icon: Zap, label: tr("Consommation"), value: hw.watts ? `${hw.watts} W` : "—" },
          ].map((k) => (
            <div key={k.label}>
              <dt className="flex items-center gap-1.5 text-xs text-meta">
                <k.icon size={13} aria-hidden="true" /> {k.label}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold text-h1">{k.value}</dd>
            </div>
          ))}
        </dl>
        <ul className="grid gap-2" aria-label={tr("Répartition par type")}>
          {ASSET_KINDS.filter((k) => counts.byKind[k]).map((k) => (
            <li key={k} className="flex items-center gap-3 text-xs">
              <KindIcon kind={k} size={14} className="shrink-0 text-meta" />
              <span className="w-28 shrink-0 truncate text-body">{ASSET_KIND_META[k].plural}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-elevated">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${((counts.byKind[k] ?? 0) / max) * 100}%`, background: TONE_VAR[ASSET_KIND_META[k].tone] }}
                />
              </span>
              <span className="w-6 text-right font-mono text-h2">{counts.byKind[k]}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function SubnetsWidget() {
  const tr = use(getT());
  const subnets = use(listSubnets()).slice(0, 7);
  return (
    <Card className="h-full">
      <CardHeader
        overline="IPAM"
        title={tr("Occupation des sous-réseaux")}
        actions={
          <ButtonLink href="/reseau" variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>
            {tr("Réseau")}</ButtonLink>
        }
      />
      <CardBody className="grid gap-4">
        {subnets.length === 0 ? (
          <p className="text-sm text-meta">{tr("Aucun sous-réseau déclaré.")}</p>
        ) : (
          subnets.map((s) => {
            const used = s.used + s.reserved + s.dhcp;
            return (
              <Link key={s.id} href={`/reseau?subnet=${s.id}`} className="block rounded-lg hover:bg-page">
                <Meter
                  label={`${s.name}${s.vlan_number ? ` · VLAN ${s.vlan_number}` : ""}`}
                  value={pct(used, s.capacity)}
                  detail={`${used}/${s.capacity}`}
                />
              </Link>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}



