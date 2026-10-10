import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  ClipboardList,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Plus,
  Rocket,
  Server,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { assetCounts, hardwareTotals, storageTotalGb } from "@/lib/data/assets";
import { deploymentCounts, listDeployments } from "@/lib/data/deployments";
import { openTasks, taskCounts } from "@/lib/data/tasks";
import { ipamTotals, listSubnets } from "@/lib/data/network";
import { listIntegrations } from "@/lib/data/integrations";
import { fetchProxmox, monitoringSummary } from "@/lib/integrations";
import { confirmedDown, listMonitors } from "@/lib/data/monitors";
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
import { FadeIn } from "@/components/ui/fade-in";
import { cn, formatBytes, formatDate, formatGb, isOverdue, pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Tableau de bord" };

export default function DashboardPage() {
  return (
    <>
      <header className="rise mb-8 sm:mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-h1 sm:text-5xl">
          Tableau de <span className="text-accent-text">bord</span>
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
    <div className="grid grid-cols-1 gap-6 xl:gap-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

async function Dashboard() {
  await requireUser();
  const assets = assetCounts();
  const ipam = ipamTotals();
  const deployments = deploymentCounts();
  const tasks = taskCounts();
  const hasProxmox = listIntegrations("proxmox", true).length > 0;
  const hasMonitoring =
    listMonitors().length > 0 || ["beszel", "maintenant", "patchmon"].some((t) => listIntegrations(t as "beszel", true).length > 0);

  return (
    <div className="grid grid-cols-1 gap-6 xl:gap-8">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6">
        <Stat
          href="/inventaire"
          label="Éléments inventoriés"
          value={assets.total}
          icon={<Boxes size={16} />}
          detail={
            ASSET_KINDS.filter((k) => assets.byKind[k])
              .map((k) => `${assets.byKind[k]} ${ASSET_KIND_META[k].label.split(" ")[0].toLowerCase()}`)
              .join(" · ") || "Inventaire vide"
          }
        />
        <Stat
          href="/reseau"
          label="Adresses IP"
          value={ipam.used}
          icon={<Network size={16} />}
          detail={`${pct(ipam.used, ipam.capacity)} % de ${ipam.subnets} sous-réseau(x)`}
        />
        <Stat
          href="/deploiements"
          label="Déploiements actifs"
          value={deployments.active}
          icon={<Rocket size={16} />}
          tone={deployments.by.blocked ? "red" : "accent"}
          detail={deployments.by.blocked ? `${deployments.by.blocked} bloqué(s)` : `${deployments.by.done ?? 0} terminé(s)`}
        />
        <Stat
          href="/taches"
          label="Tâches ouvertes"
          value={tasks.todo + tasks.in_progress}
          icon={<ClipboardList size={16} />}
          tone={tasks.overdue ? "yellow" : "accent"}
          detail={tasks.overdue ? `${tasks.overdue} en retard` : `${tasks.in_progress} en cours`}
        />
      </div>

      {/* Live : Proxmox + monitoring (toujours affichés, état vide si non configuré) */}
      <div className="grid gap-6 xl:grid-cols-2 xl:gap-8">
        <FadeIn>
          {hasProxmox ? (
            <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
              <ProxmoxWidget />
            </Suspense>
          ) : (
            <NotConfigured
              overline="Proxmox"
              title="Aucun nœud connecté"
              text="Ajoute un jeton API par nœud Proxmox VE pour suivre leurs ressources et leurs invités ici."
              icon={<Server size={20} />}
            />
          )}
        </FadeIn>
        <FadeIn delay={80}>
          {hasMonitoring ? (
            <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
              <MonitoringWidget />
            </Suspense>
          ) : (
            <NotConfigured
              overline="Monitoring"
              title="Aucune instance de monitoring"
              text="Ajoute des sondes de disponibilité (HTTP/TCP) dans Monitoring, ou connecte Beszel, Maintenant ou PatchMon : pannes, certificats et mises à jour remonteront ici."
              icon={<Activity size={20} />}
              href="/monitoring"
              cta="Ajouter une sonde"
            />
          )}
        </FadeIn>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:gap-8">
        <FadeIn>
          <DeploymentsWidget />
        </FadeIn>
        <FadeIn delay={80}>
          <TasksWidget />
        </FadeIn>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:gap-8">
        <FadeIn>
          <CapacityWidget />
        </FadeIn>
        <FadeIn delay={80}>
          <SubnetsWidget />
        </FadeIn>
      </div>

    </div>
  );
}

/* --------------------------------------------------------------------------- */

async function ProxmoxWidget() {
  const sources = await fetchProxmox();
  const nodes = sources.flatMap((s) => (s.data?.nodes ?? []).map((n) => ({ ...n, source: s.name })));
  const guests = sources.flatMap((s) => s.data?.guests ?? []);
  const running = guests.filter((g) => g.status === "running").length;
  const errors = sources.filter((s) => !s.ok);
  return (
    <Card className="h-full">
      <CardHeader
        overline="Proxmox"
        title={`${nodes.filter((n) => n.status === "online").length}/${nodes.length} nœud(s) · ${running}/${guests.length} invité(s) actifs`}
        actions={
          <ButtonLink href="/proxmox" variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>
            Détails
          </ButtonLink>
        }
      />
      <CardBody className="grid gap-4">
        {errors.map((e) => (
          <p key={e.id} className="flex items-center gap-2 text-sm text-red">
            <span aria-hidden="true">✕</span> {e.name} : {e.error}
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
                {n.status === "online" ? "En ligne" : "Hors ligne"}
              </Badge>
            </div>
            {n.status === "online" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Meter size="sm" label="CPU" value={(n.cpu ?? 0) * 100} />
                <Meter size="sm" label="Mémoire" value={pct(n.mem ?? 0, n.maxmem ?? 0)} detail={`${formatBytes(n.mem)} / ${formatBytes(n.maxmem)}`} />
              </div>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

async function MonitoringWidget() {
  const m = await monitoringSummary();
  const probes = listMonitors().filter((x) => x.enabled);
  const probesDown = probes.filter((x) => confirmedDown(x.id));
  const alerts: { tone: "red" | "yellow"; text: string; href: string }[] = [
    ...m.systems.down.map((s) => ({ tone: "red" as const, text: `${s.name} hors ligne (Beszel)`, href: "/monitoring" })),
    ...m.systems.hot.map((s) => ({
      tone: "yellow" as const,
      text: `${s.name} : CPU ${Math.round(s.cpu ?? 0)} % · RAM ${Math.round(s.mem ?? 0)} % · disque ${Math.round(s.disk ?? 0)} %`,
      href: "/monitoring",
    })),
    ...m.containers.unhealthy.map((c) => ({ tone: "red" as const, text: `Conteneur ${c.name} : ${c.health ?? c.state}`, href: "/monitoring" })),
    ...m.endpoints.down.map((e) => ({ tone: "red" as const, text: `Endpoint ${e.name} : ${e.status}`, href: "/monitoring" })),
    ...m.certificates.expiring.map((c) => ({
      tone: "yellow" as const,
      text: `Certificat ${c.name} expire le ${formatDate(c.expiresAt)}`,
      href: "/monitoring",
    })),
    ...m.patches.reboot.map((h) => ({ tone: "yellow" as const, text: `${h.friendlyName} doit redémarrer`, href: "/monitoring" })),
    ...probesDown.map((x) => ({ tone: "red" as const, text: `${x.name} en panne`, href: `/monitoring/${x.id}` })),
    ...m.errors.map((e) => ({ tone: "red" as const, text: `${e.name} : ${e.error}`, href: "/parametres#integrations" })),
  ];
  return (
    <Card className="h-full">
      <CardHeader
        overline="Monitoring"
        title={alerts.length ? `${alerts.length} point(s) d'attention` : "Tout est au vert"}
        actions={
          <ButtonLink href="/monitoring" variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>
            Détails
          </ButtonLink>
        }
      />
      <CardBody className="grid gap-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Sondes", value: probes.length ? `${probes.length - probesDown.length}/${probes.length}` : "—", icon: Activity },
            { label: "Systèmes", value: m.systems.total ? `${m.systems.up}/${m.systems.total}` : "—", icon: Server },
            { label: "Endpoints", value: m.endpoints.total ? `${m.endpoints.up}/${m.endpoints.total}` : "—", icon: Network },
            { label: "MàJ sécurité", value: m.patches.hosts ? m.patches.security : "—", icon: ShieldAlert },
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
            <span aria-hidden="true">✓</span> Aucune alerte en cours.
            {m.patches.updates > 0 && <span className="text-meta"> · {m.patches.updates} mise(s) à jour disponibles</span>}
          </p>
        ) : (
          <ul className="grid max-h-56 gap-1.5 overflow-y-auto">
            {alerts.slice(0, 12).map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-page">
                  <AlertTriangle size={14} style={{ color: TONE_VAR[a.tone] }} className="shrink-0" aria-hidden="true" />
                  <span className="truncate text-h2">{a.text}</span>
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
  const items = listDeployments({ status: "active" }).slice(0, 6);
  return (
    <Card className="h-full">
      <CardHeader
        overline="Déploiements"
        title="En cours"
        actions={
          <ButtonLink href="/deploiements/nouveau" variant="ghost" size="sm" icon={<Plus size={14} />}>
            Nouveau
          </ButtonLink>
        }
      />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-sm text-meta">Aucun déploiement en cours.</p>
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
                        <Badge tone={DEPLOYMENT_KIND_META[d.kind].tone}>{DEPLOYMENT_KIND_META[d.kind].label}</Badge>
                        <Badge tone={DEPLOYMENT_STATUS_META[d.status].tone} dot>
                          {DEPLOYMENT_STATUS_META[d.status].label}
                        </Badge>
                      </span>
                    </div>
                    {d.steps_total > 0 && (
                      <Meter
                        className="mt-3"
                        size="sm"
                        value={progress}
                        tone={d.status === "blocked" ? "red" : "accent"}
                        label={`${d.steps_done}/${d.steps_total} étapes${d.target_date ? ` · cible ${formatDate(d.target_date)}` : ""}`}
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
  const items = openTasks(7);
  return (
    <Card className="h-full">
      <CardHeader
        overline="Tâches"
        title="À faire prochainement"
        actions={
          <ButtonLink href="/taches" variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>
            Kanban
          </ButtonLink>
        }
      />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-sm text-meta">Rien en attente. Profite.</p>
        ) : (
          <ul className="grid gap-1">
            {items.map((t) => {
              const late = isOverdue(t.due_date);
              return (
                <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-page">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_VAR[PRIORITY_META[t.priority].tone] }} title={PRIORITY_META[t.priority].label} />
                  <span className="min-w-0 flex-1 truncate text-sm text-h2">{t.title}</span>
                  {t.status === "in_progress" && <Badge tone="accent">En cours</Badge>}
                  {t.due_date && (
                    <span className={cn("shrink-0 font-mono text-xs", late ? "text-red" : "text-meta")}>{formatDate(t.due_date)}</span>
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
  const hw = hardwareTotals();
  const storage = storageTotalGb();
  const counts = assetCounts();
  const max = Math.max(1, ...ASSET_KINDS.map((k) => counts.byKind[k] ?? 0));
  return (
    <Card className="h-full">
      <CardHeader overline="Capacité" title={`${hw.servers} serveur(s) physique(s)`} />
      <CardBody className="grid gap-5">
        <dl className="grid grid-cols-2 gap-3">
          {[
            { icon: Cpu, label: "Cœurs / threads", value: `${hw.cores} / ${hw.threads}` },
            { icon: MemoryStick, label: "Mémoire", value: formatGb(hw.ram_gb) },
            { icon: HardDrive, label: "Stockage brut", value: formatGb(storage) },
            { icon: Zap, label: "Consommation", value: hw.watts ? `${hw.watts} W` : "—" },
          ].map((k) => (
            <div key={k.label}>
              <dt className="flex items-center gap-1.5 text-xs text-meta">
                <k.icon size={13} aria-hidden="true" /> {k.label}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold text-h1">{k.value}</dd>
            </div>
          ))}
        </dl>
        <ul className="grid gap-2" aria-label="Répartition par type">
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
  const subnets = listSubnets().slice(0, 7);
  return (
    <Card className="h-full">
      <CardHeader
        overline="IPAM"
        title="Occupation des sous-réseaux"
        actions={
          <ButtonLink href="/reseau" variant="ghost" size="sm" icon={<ArrowUpRight size={14} />}>
            Réseau
          </ButtonLink>
        }
      />
      <CardBody className="grid gap-4">
        {subnets.length === 0 ? (
          <p className="text-sm text-meta">Aucun sous-réseau déclaré.</p>
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



