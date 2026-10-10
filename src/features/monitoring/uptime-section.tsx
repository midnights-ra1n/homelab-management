import Link from "next/link";
import { Activity, Import } from "lucide-react";
import { importMonitorsAction } from "@/actions/monitors";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { assetOptions } from "@/lib/data/assets";
import { incidentCount, monitorSummaries } from "@/lib/monitor/summary";
import { TONE_VAR } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Sparkline, UptimeBars } from "./charts";
import { formatPct } from "@/lib/monitor/format";
import { MonitorDialog } from "./monitor-dialog";

/** Sondes intégrées : bandeau d'état, chiffres clés et une ligne par sonde (style status page). */
export function UptimeSection() {
  const list = monitorSummaries();
  const assets = assetOptions().map((a) => ({ id: a.id, label: a.display_name }));
  const active = list.filter((s) => s.monitor.enabled);
  const down = active.filter((s) => s.last && !s.last.up);
  const pending = active.filter((s) => !s.last);
  const withData = active.filter((s) => s.uptime24 !== null);
  const global24 = withData.length ? withData.reduce((a, s) => a + s.uptime24!, 0) / withData.length : null;
  const avgs = active.filter((s) => s.avg24 !== null);
  const avg = avgs.length ? Math.round(avgs.reduce((a, s) => a + s.avg24!, 0) / avgs.length) : null;
  const inc7 = incidentCount(active.map((s) => s.monitor.id), 7);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <ActionButton action={importMonitorsAction} icon={<Import size={15} />} pendingLabel="Import…" title="Créer une sonde pour chaque application">
        Importer les applications
      </ActionButton>
      <MonitorDialog assets={assets} />
    </div>
  );

  if (list.length === 0) {
    return (
      <section aria-labelledby="uptime-title" className="grid gap-6">
        <SectionTitle id="uptime-title" actions={actions}>
          Disponibilité
        </SectionTitle>
        <EmptyState icon={<Activity size={22} />} title="Aucune sonde">
          Ajoute des sondes HTTP ou TCP : l&apos;application les contrôle en continu et trace temps de réponse, disponibilité sur 90 jours et
          incidents — sans outil externe.
        </EmptyState>
      </section>
    );
  }

  const state = down.length ? "down" : active.length === 0 ? "paused" : "up";
  const tone = state === "down" ? TONE_VAR.red : state === "paused" ? TONE_VAR.muted : TONE_VAR.green;

  return (
    <section aria-labelledby="uptime-title" className="grid gap-6">
      <SectionTitle id="uptime-title" actions={actions}>
        Disponibilité
      </SectionTitle>

      {/* Bandeau d'état global */}
      <div
        className="flex items-center gap-4 rounded-3xl border px-5 py-5 sm:px-7"
        style={{
          background: `color-mix(in srgb, ${tone} 9%, var(--mm-bg-box))`,
          borderColor: `color-mix(in srgb, ${tone} 35%, var(--mm-border))`,
        }}
      >
        <span className="relative flex h-4 w-4 shrink-0">
          <span className="ping absolute inset-0 rounded-full" style={{ background: tone }} />
          <span className="relative h-4 w-4 rounded-full" style={{ background: tone }} />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-h1 sm:text-xl">
            {state === "down"
              ? `${down.length} service${down.length > 1 ? "s" : ""} en panne`
              : state === "paused"
                ? "Toutes les sondes sont en pause"
                : "Tous les services sont opérationnels"}
          </p>
          <p className="text-sm text-body">
            {state === "down" ? down.map((d) => d.monitor.name).join(", ") : `${active.length} sonde(s) active(s)`}
            {pending.length > 0 && ` · ${pending.length} en attente du premier contrôle`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6">
        <Stat label="Disponibilité 24 h" value={formatPct(global24)} detail="moyenne des sondes" />
        <Stat label="Temps de réponse" value={avg !== null ? `${avg} ms` : "—"} detail="moyenne sur 24 h" />
        <Stat label="Incidents" value={inc7} detail="sur 7 jours" tone={inc7 ? "yellow" : undefined} />
        <Stat label="Sondes" value={`${down.length ? active.length - down.length : active.length}/${list.length}`} detail="opérationnelles" />
      </div>

      {/* Liste des sondes */}
      <ul className="grid gap-3">
        {list.map((s) => {
          const m = s.monitor;
          const up = s.last?.up;
          const dot = !m.enabled ? TONE_VAR.muted : !s.last ? TONE_VAR.blue : s.degraded ? TONE_VAR.yellow : up ? TONE_VAR.green : TONE_VAR.red;
          const label = !m.enabled ? "En pause" : !s.last ? "En attente" : s.degraded ? "Échec isolé" : up ? "Opérationnel" : "En panne";
          return (
            <li key={m.id}>
              <Link
                href={`/monitoring/${m.id}`}
                className={cn(
                  "group grid gap-4 rounded-2xl border border-line-subtle bg-box p-4 transition-colors hover:border-line-accent sm:p-5",
                  "lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_9rem_6.5rem] lg:items-center lg:gap-6",
                  !m.enabled && "opacity-60",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="relative flex h-3 w-3 shrink-0">
                    {m.enabled && s.last && <span className="ping absolute inset-0 rounded-full" style={{ background: dot }} />}
                    <span className="relative h-3 w-3 rounded-full" style={{ background: dot }} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-h1 group-hover:text-accent-text">{m.name}</p>
                    <p className="truncate font-mono text-xs text-meta">
                      {label} · {m.target.replace(/^https?:\/\//, "")}
                    </p>
                  </div>
                </div>
                <UptimeBars days={s.daily} height={28} />
                <div className="hidden lg:block">
                  <Sparkline values={s.spark.values} down={s.spark.down} />
                </div>
                <div className="flex items-baseline justify-between gap-3 lg:block lg:text-right">
                  <p className="text-base font-semibold text-h1">
                    {formatPct(s.uptime90)}
                  </p>
                  <p className="font-mono text-xs text-meta">{s.last?.ms != null ? `${s.last.ms} ms` : (s.last?.error ?? "—")}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-meta">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: TONE_VAR.green }} /> ≥ 99,9 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: TONE_VAR.yellow }} /> ≥ 99 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: TONE_VAR.red }} /> &lt; 99 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-line-subtle" /> sans mesure
        </span>
        <span>· 90 derniers jours · disponibilité sur 90 j à droite</span>
      </p>
    </section>
  );
}
