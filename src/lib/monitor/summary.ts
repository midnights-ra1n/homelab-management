import "server-only";
import { buckets, confirmedDown, dailyUptime, lastCheck, listMonitors, uptimeFromDaily, uptimeSince, incidents, type Monitor } from "../data/monitors";

const HOUR = 3_600_000;

export type MonitorSummary = {
  monitor: Monitor;
  last: { ts: number; up: boolean; ms: number | null; error: string } | null;
  /** Dernier contrôle en échec mais panne pas encore confirmée. */
  degraded: boolean;
  uptime24: number | null;
  uptime90: number | null;
  avg24: number | null;
  daily: ReturnType<typeof dailyUptime>;
  spark: { values: (number | null)[]; down: boolean[] };
};

/** Données de la liste des sondes (une requête par sonde, volumes modestes). */
export function monitorSummaries(now = Date.now()): MonitorSummary[] {
  const since = now - 24 * HOUR;
  const slot = 30 * 60_000;
  const start = Math.floor(since / slot) * slot;
  return listMonitors().map((m) => {
    const last = lastCheck(m.id);
    const u24 = uptimeSince(m.id, since);
    const daily = dailyUptime(m.id, 90, now);
    const series = new Map(buckets(m.id, start, slot).map((b) => [b.t, b]));
    const values: (number | null)[] = [];
    const down: boolean[] = [];
    for (let t = start; t <= now; t += slot) {
      const b = series.get(t);
      values.push(b?.ms ?? null);
      down.push(!!b && b.ups < b.checks);
    }
    return {
      monitor: m,
      last: last ? { ts: last.ts, up: !confirmedDown(m.id), ms: last.ms, error: last.error } : null,
      degraded: !!last && !last.up && !confirmedDown(m.id),
      uptime24: u24.uptime,
      uptime90: uptimeFromDaily(daily),
      avg24: u24.avg === null ? null : Math.round(u24.avg),
      daily,
      spark: { values, down },
    };
  });
}

export function incidentCount(monitorIds: number[], days: number) {
  const since = Date.now() - days * 86_400_000;
  return monitorIds.reduce((n, id) => n + incidents(id, since).length, 0);
}
