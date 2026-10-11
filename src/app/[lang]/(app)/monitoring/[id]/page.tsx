import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink, Pause, Play, RefreshCw } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { assetOptions } from "@/lib/data/assets";
import { all } from "@/lib/db";
import {
  buckets,
  confirmedDown,
  dailyUptime,
  getMonitor,
  incidents,
  uptimeFromDaily,
  uptimeSince,
  type Check,
} from "@/lib/data/monitors";
import { deleteMonitorAction, runMonitorNowAction, toggleMonitorAction } from "@/actions/monitors";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { LinkTabs } from "@/components/ui/tabs";
import { MonitorDialog } from "@/features/monitoring/monitor-dialog";
import { LocalTime, ResponseChart, UptimeBars } from "@/features/monitoring/charts";
import { formatDuration, formatPct } from "@/lib/monitor/format";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Sonde") };
}

const HOUR = 3_600_000;
const RANGES = {
  "24h": { label: "24 h", span: 24 * HOUR, bucket: 10 * 60_000 },
  "7j": { label: "7 jours", span: 7 * 24 * HOUR, bucket: HOUR },
  "30j": { label: "30 jours", span: 30 * 24 * HOUR, bucket: 6 * HOUR },
} as const;

export default function MonitorPage({ params, searchParams }: PageProps<"/[lang]/monitoring/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[36rem] rounded-2xl" />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: Pick<PageProps<"/[lang]/monitoring/[id]">, "params" | "searchParams">) {
  const tr = await getT();
  await requireUser();
  const id = Number((await params).id);
  const m = getMonitor(id);
  if (!m) notFound();
  const sp = await searchParams;
  const rangeKey = (typeof sp.periode === "string" && sp.periode in RANGES ? sp.periode : "24h") as keyof typeof RANGES;
  const range = RANGES[rangeKey];

  // eslint-disable-next-line react-hooks/purity -- rendu serveur dynamique, instant de la requête
  const now = Date.now();
  const from = Math.floor((now - range.span) / range.bucket) * range.bucket;
  const points = buckets(id, from, range.bucket);
  const stats = uptimeSince(id, now - range.span);
  const u24 = uptimeSince(id, now - 24 * HOUR).uptime;
  const u7 = uptimeSince(id, now - 7 * 24 * HOUR).uptime;
  const u30 = uptimeSince(id, now - 30 * 24 * HOUR).uptime;
  const daily = dailyUptime(id, 90, now);
  const u90 = uptimeFromDaily(daily);
  const incs = incidents(id, now - 30 * 24 * HOUR, now);
  const recent = all<Check>(tr("SELECT ts, up, ms, status, error FROM monitor_checks WHERE monitor_id = ? ORDER BY ts DESC LIMIT 12"), [id]);
  const last = recent[0];
  const isDown = confirmedDown(id);
  const state = !m.enabled ? "paused" : !last ? "pending" : isDown ? "down" : last.up ? "up" : "degraded";
  const stateMeta = {
    up: { label: "Opérationnel", tone: "green" as const },
    down: { label: "En panne", tone: "red" as const },
    paused: { label: "En pause", tone: "muted" as const },
    pending: { label: "En attente", tone: "blue" as const },
    degraded: { label: "Échec isolé", tone: "yellow" as const },
  }[state];

  return (
    <div className="grid grid-cols-1 gap-8 xl:gap-10">
      <header className="rise flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Link href="/monitoring" className="text-sm text-meta hover:text-accent-text">
            {tr("← Monitoring")}</Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-h1 sm:text-4xl">{m.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={stateMeta.tone} dot>
              {tr(stateMeta.label)}
            </Badge>
            <Badge tone="muted">{m.type === "http" ? "HTTP" : "TCP"}</Badge>
            {m.type === "http" ? (
              <a href={m.target} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-sm text-body hover:text-accent-text">
                {m.target} <ExternalLink size={12} />
              </a>
            ) : (
              <span className="font-mono text-sm text-body">{m.target}</span>
            )}
            {m.asset_id && (
              <Link href={`/inventaire/${m.asset_id}`} className="text-sm text-meta hover:text-accent-text">
                · {m.asset_name}
              </Link>
            )}
          </div>
          <p className="mt-2 text-xs text-meta">
            {tr("Contrôle toutes les ")}{m.interval_sec < 60 ? `${m.interval_sec} s` : `${m.interval_sec / 60} min`}
            {last && (
              <>
                {" · dernier "}
                <LocalTime ts={last.ts} mode="relative" />
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton action={runMonitorNowAction.bind(null, id)} icon={<RefreshCw size={15} />} pendingLabel={tr("Contrôle…")}>
            {tr("Tester maintenant")}</ActionButton>
          <form action={toggleMonitorAction.bind(null, id, !m.enabled)}>
            <Button type="submit" variant="secondary" icon={m.enabled ? <Pause size={15} /> : <Play size={15} />}>
              {m.enabled ? tr("Pause") : tr("Reprendre")}
            </Button>
          </form>
          <MonitorDialog monitor={m} assets={assetOptions().map((a) => ({ id: a.id, label: a.display_name }))} />
          <ConfirmButton action={deleteMonitorAction.bind(null, id)} size="icon" message={tr("Supprimer la sonde « {name} » et tout son historique ?", { name: m.name })} />
        </div>
      </header>

      {state === "down" && last && (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--mm-red)_40%,var(--mm-border))] bg-[color-mix(in_srgb,var(--mm-red)_9%,var(--mm-bg-box))] px-5 py-4 text-sm text-h2">
          <span className="font-semibold text-red">{tr("✕ En panne")}</span> — {last.error || tr("aucune réponse")}
          {incs[0] && !incs[0].end && <span className="text-meta"> {tr("· depuis ")}{formatDuration(incs[0].duration, tr.locale)}</span>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6">
        <Stat label={tr("Disponibilité 24 h")} value={formatPct(u24, 2, tr.locale)} />
        <Stat label={tr("7 jours")} value={formatPct(u7, 2, tr.locale)} />
        <Stat label={tr("30 jours")} value={formatPct(u30, 2, tr.locale)} />
        <Stat label={tr("90 jours")} value={formatPct(u90, 2, tr.locale)} />
      </div>

      <Card>
        <CardHeader
          overline={tr("Temps de réponse")}
          title={
            <span className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span>{stats.avg !== null ? `${Math.round(stats.avg)} ms` : "—"} <span className="text-sm font-normal text-meta">{tr("en moyenne")}</span></span>
              <span className="font-mono text-xs font-normal text-meta">
                {tr("min ")}{stats.min ?? "—"} {tr("ms · max ")}{stats.max ?? "—"} {tr("ms · ")}{stats.checks} {tr("contrôle(s)")}</span>
            </span>
          }
          actions={
            <LinkTabs
              label={tr("Période")}
              active={rangeKey}
              items={Object.entries(RANGES).map(([k, r]) => ({ value: k, label: tr(r.label), href: `/monitoring/${id}${k === "24h" ? "" : `?periode=${k}`}` }))}
            />
          }
        />
        <CardBody>
          <ResponseChart points={points} from={from} to={now} bucketMs={range.bucket} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader overline={tr("Disponibilité")} title={tr("{pct} sur 90 jours", { pct: formatPct(u90, 2, tr.locale) })} />
        <CardBody>
          <UptimeBars days={daily} height={44} />
          <div className="mt-2 flex justify-between font-mono text-[0.7rem] text-meta">
            <span className="hidden sm:inline">{tr("il y a 90 jours")}</span>
            <span className="sm:hidden">{tr("jours récents")}</span>
            <span>{tr("aujourd'hui")}</span>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 xl:gap-8">
        <Card>
          <CardHeader overline={tr("Incidents")} title={incs.length ? tr("{n} sur 30 jours", { n: incs.length }) : tr("Aucun incident sur 30 jours")} />
          <CardBody>
            {incs.length === 0 ? (
              <p className="text-sm text-green">{tr("✓ Aucune interruption détectée.")}</p>
            ) : (
              <ul className="grid gap-2">
                {incs.slice(0, 15).map((inc) => (
                  <li key={inc.start} className="flex items-start justify-between gap-3 rounded-xl border border-line-subtle bg-page px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm text-h1">
                        <LocalTime ts={inc.start} />
                      </span>
                      <span className="block truncate text-xs text-meta">{inc.error || tr("Aucune réponse")}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Badge tone={inc.end ? "muted" : "red"}>{inc.end ? tr("Résolu") : tr("En cours")}</Badge>
                      <span className="mt-1 block font-mono text-xs text-body">{formatDuration(inc.duration, tr.locale)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader overline={tr("Journal")} title={tr("Derniers contrôles")} />
          <CardBody>
            {recent.length === 0 ? (
              <p className="text-sm text-meta">{tr("Pas encore de contrôle.")}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
                    <th className="pb-2 font-medium">{tr("Heure")}</th>
                    <th className="pb-2 font-medium">{tr("État")}</th>
                    <th className="pb-2 text-right font-medium">{tr("Réponse")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((c) => (
                    <tr key={c.ts} className="border-t border-line-subtle">
                      <td className="py-2 font-mono text-xs text-body">
                        <LocalTime ts={c.ts} mode="time" />
                      </td>
                      <td className="py-2">
                        <span className={c.up ? "text-green" : "text-red"}>{c.up ? "✓ OK" : tr("✕ Échec")}</span>
                        {c.status !== null && <span className="ml-2 font-mono text-xs text-meta">{c.status}</span>}
                        {!c.up && c.error && <span className="ml-2 text-xs text-meta">{tr(c.error)}</span>}
                      </td>
                      <td className="py-2 text-right font-mono text-xs text-h2 tabular-nums">{c.ms !== null ? `${c.ms} ms` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
