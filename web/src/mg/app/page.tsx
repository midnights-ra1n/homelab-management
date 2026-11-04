import Link from "next/link";
import { cache, Suspense, use } from "react";
import { Activity, ArrowUpRight, Plus, Server } from "../../shared/icons";
import { assetCounts } from "@/lib/data/assets";
import { deploymentCounts, listDeployments } from "@/lib/data/deployments";
import { openTasks, taskCounts } from "@/lib/data/tasks";
import { ipamTotals } from "@/lib/data/network";
import { listIntegrations } from "@/lib/data/integrations";
import { fetchProxmox } from "@/lib/integrations";
import { collectAlerts } from "@/lib/monitor/alerts";
import { AlertBanner } from "@/components/alert-banner";
import { ASSET_KINDS, ASSET_KIND_META, DEPLOYMENT_STATUS_META } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { cn, formatBytes, formatDate, isOverdue, pct } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { SECTIONS, STAT_GRID } from "../../ui";

export default function DashboardPage() {
  const tr = use(getT());
  return (
    <>
      <PageHeader title={tr("Tableau de bord")} description={tr("L'essentiel de l'infrastructure, en un coup d'œil.")} />
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className={SECTIONS}>
      <div className={STAT_GRID}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-72" />
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
    <div className={SECTIONS}>
      {hasMonitoring && (
        <Suspense fallback={null}>
          <DashboardAlertBanner />
        </Suspense>
      )}

      {/* KPI */}
      <div className={STAT_GRID}>
        <Stat
          href="/inventaire"
          label={tr("Éléments inventoriés")}
          value={assets.total}
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
          detail={tr("{0} % de {subnets} sous-réseau(x)", { "0": pct(ipam.used, ipam.capacity), subnets: ipam.subnets })}
        />
        <Stat
          href="/deploiements"
          label={tr("Déploiements actifs")}
          value={deployments.active}
          tone={deployments.by.blocked ? "red" : "accent"}
          detail={deployments.by.blocked ? tr("{blocked} bloqué(s)", { blocked: deployments.by.blocked }) : tr("{0} terminé(s)", { "0": deployments.by.done ?? 0 })}
        />
        <Stat
          href="/taches"
          label={tr("Tâches ouvertes")}
          value={tasks.todo + tasks.in_progress}
          tone={tasks.overdue ? "yellow" : "accent"}
          detail={tasks.overdue ? tr("{overdue} en retard", { overdue: tasks.overdue }) : tr("{in_progress} en cours", { in_progress: tasks.in_progress })}
        />
      </div>

      {/* Live : Proxmox + monitoring (toujours affichés, état vide si non configuré) */}
      <div className="grid gap-4 lg:grid-cols-2">
        {hasMonitoring ? (
          <Suspense fallback={<Skeleton className="h-72" />}>
            <MonitoringWidget />
          </Suspense>
        ) : (
          <NotConfigured title={tr("Aucune instance de monitoring")} text={tr("Connecte Midnights Monitoring : sondes, pannes et mises à jour remonteront ici.")} icon={<Activity size={20} />} />
        )}
        {hasProxmox ? (
          <Suspense fallback={<Skeleton className="h-72" />}>
            <ProxmoxWidget />
          </Suspense>
        ) : (
          <NotConfigured title={tr("Aucun nœud Proxmox")} text={tr("Ajoute un jeton API par nœud pour suivre ses ressources ici.")} icon={<Server size={20} />} />
        )}
        <DeploymentsWidget />
        <TasksWidget />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- */

const details = (href: string, label: string) => (
  <ButtonLink href={href} variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>{label}</ButtonLink>
);
const ROW = "-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 hover:bg-hover";

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
        title={tr("{online}/{nodes} nœud(s) · {running}/{guests} invité(s) actif(s)", { online: nodes.filter((n) => n.status === "online").length, nodes: nodes.length, running, guests: guests.length })}
        actions={details("/proxmox", tr("Détails"))}
      />
      <CardBody className="grid gap-6">
        {errors.map((e) => (
          <p key={e.id} className="text-sm text-red">{e.name} : {tr(e.error)}</p>
        ))}
        {nodes.slice(0, 3).map((n) => (
          <div key={`${n.source}-${n.node}`} className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-h1">{n.node}</span>
              <Badge tone={n.status === "online" ? "green" : "red"} dot>
                {n.status === "online" ? tr("En ligne") : tr("Hors ligne")}
              </Badge>
            </div>
            {n.status === "online" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Meter label="CPU" value={(n.cpu ?? 0) * 100} />
                <Meter label={tr("Mémoire")} value={pct(n.mem ?? 0, n.maxmem ?? 0)} detail={`${formatBytes(n.mem, tr.locale)} / ${formatBytes(n.maxmem, tr.locale)}`} />
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
        title={alerts.length ? tr("{n} point(s) d'attention", { n: alerts.length }) : m.monitored ? tr("Tout est au vert") : tr("Rien n'est encore surveillé")}
        actions={details("/monitoring", tr("Détails"))}
      />
      <CardBody className="grid gap-5">
        <dl className="grid grid-cols-3 gap-4">
          {[
            { label: tr("Sondes"), value: m.probes.total ? `${m.probes.total - m.probes.down.length}/${m.probes.total}` : "—" },
            { label: tr("Systèmes"), value: m.systems.total ? `${m.systems.up}/${m.systems.total}` : "—" },
            { label: tr("Mises à jour"), value: m.patches.hosts ? m.patches.updates : "—" },
          ].map((k) => (
            <div key={k.label}>
              <dt className="text-sm text-meta">{k.label}</dt>
              <dd className="mm-stat__value mt-1">{k.value}</dd>
            </div>
          ))}
        </dl>
        {alerts.length > 0 && (
          <ul className="grid grid-cols-1">
            {alerts.slice(0, 5).map((a, i) => (
              <li key={i}>
                <Link href={a.href} className={ROW}>
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

/** Un seul lien, vers les intégrations : l'explication tient en une phrase. */
function NotConfigured({ title, text, icon }: { title: string; text: string; icon: React.ReactNode }) {
  const tr = use(getT());
  return (
    <EmptyState icon={icon} title={title}
      action={<ButtonLink href="/parametres#integrations" variant="secondary" icon={<Plus size={16} />}>{tr("Connecter une intégration")}</ButtonLink>}>
      {text}
    </EmptyState>
  );
}

function DeploymentsWidget() {
  const tr = use(getT());
  const items = use(listDeployments({ status: "active" })).slice(0, 5);
  return (
    <Card className="h-full">
      <CardHeader title={tr("Déploiements en cours")} actions={details("/deploiements", tr("Voir tous"))} />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-sm text-body">{tr("Aucun déploiement en cours.")}</p>
        ) : (
          <ul className="grid grid-cols-1">
            {items.map((d) => (
              <li key={d.id}>
                <Link href={`/deploiements/${d.id}`} className={ROW}>
                  <span className="min-w-0 flex-1 truncate font-semibold text-h1">{d.title}</span>
                  {d.steps_total > 0 && <span className="shrink-0 text-sm text-meta">{d.steps_done}/{d.steps_total}</span>}
                  <Badge tone={DEPLOYMENT_STATUS_META[d.status].tone} dot>{tr(DEPLOYMENT_STATUS_META[d.status].label)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function TasksWidget() {
  const tr = use(getT());
  const items = use(openTasks(5));
  return (
    <Card className="h-full">
      <CardHeader title={tr("À faire prochainement")} actions={details("/taches", tr("Voir toutes"))} />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-sm text-body">{tr("Rien en attente.")}</p>
        ) : (
          <ul className="grid grid-cols-1">
            {items.map((t) => (
              <li key={t.id} className={ROW}>
                <span className="min-w-0 flex-1 truncate text-h2">{t.title}</span>
                {t.due_date && <span className={cn("shrink-0 text-sm", isOverdue(t.due_date) ? "text-red" : "text-meta")}>{formatDate(t.due_date, tr.locale)}{t.due_time && ` · ${t.due_time}`}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
