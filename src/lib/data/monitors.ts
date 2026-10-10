import "server-only";
import { all, get, run } from "../db";
import type { MonitorInput } from "../validation";
import { logActivity } from "./activity";

export type Monitor = {
  id: number;
  name: string;
  type: "http" | "tcp";
  target: string;
  interval_sec: number;
  timeout_ms: number;
  accept: "2xx3xx" | "lt500";
  verify_tls: number;
  enabled: number;
  asset_id: number | null;
  asset_name: string | null;
  created_at: string;
};

export type Check = { ts: number; up: number; ms: number | null; status: number | null; error: string };

const DAY = 86_400_000;
export const RETENTION_DAYS = 30;

export function listMonitors(): Monitor[] {
  return all<Monitor>(
    `SELECT m.*, a.display_name AS asset_name FROM monitors m LEFT JOIN assets a ON a.id = m.asset_id ORDER BY m.name COLLATE NOCASE`,
  );
}

export function getMonitor(id: number) {
  return get<Monitor>(`SELECT m.*, a.display_name AS asset_name FROM monitors m LEFT JOIN assets a ON a.id = m.asset_id WHERE m.id = ?`, [id]);
}

function values(i: MonitorInput) {
  return [i.name, i.type, i.target, i.interval_sec, i.timeout_ms, i.accept, i.verify_tls ? 1 : 0, i.enabled ? 1 : 0, i.asset_id];
}

export function createMonitor(i: MonitorInput) {
  const { lastId } = run(
    `INSERT INTO monitors (name, type, target, interval_sec, timeout_ms, accept, verify_tls, enabled, asset_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values(i),
  );
  logActivity("monitor", lastId, "create", `Sonde « ${i.name} » ajoutée`);
  return lastId;
}

export function updateMonitor(id: number, i: MonitorInput) {
  run(
    `UPDATE monitors SET name = ?, type = ?, target = ?, interval_sec = ?, timeout_ms = ?, accept = ?, verify_tls = ?, enabled = ?,
       asset_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [...values(i), id],
  );
}

export function setMonitorEnabled(id: number, enabled: boolean) {
  run("UPDATE monitors SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, id]);
}

export function deleteMonitor(id: number) {
  const m = get<{ name: string }>("SELECT name FROM monitors WHERE id = ?", [id]);
  run("DELETE FROM monitors WHERE id = ?", [id]);
  if (m) logActivity("monitor", id, "delete", `Sonde « ${m.name} » supprimée`);
}

/** Crée une sonde HTTP par raccourci de la page d'accueil qui n'en a pas encore. */
export function importFromShortcuts() {
  const { changes } = run(
    `INSERT INTO monitors (name, type, target, asset_id)
     SELECT s.name, 'http', s.url, s.asset_id FROM shortcuts s
     WHERE NOT EXISTS (SELECT 1 FROM monitors m WHERE m.target = s.url)`,
  );
  return changes;
}

/* Enregistrement ----------------------------------------------------------- */

export function recordCheck(monitorId: number, c: Check) {
  run("INSERT INTO monitor_checks (monitor_id, ts, up, ms, status, error) VALUES (?, ?, ?, ?, ?, ?)", [
    monitorId,
    c.ts,
    c.up,
    c.ms,
    c.status,
    c.error,
  ]);
  const day = new Date(c.ts).toISOString().slice(0, 10);
  run(
    `INSERT INTO monitor_daily (monitor_id, day, checks, ups, sum_ms) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(monitor_id, day) DO UPDATE SET checks = checks + 1, ups = ups + excluded.ups, sum_ms = sum_ms + excluded.sum_ms`,
    [monitorId, day, c.up, c.up && c.ms ? c.ms : 0],
  );
}

export function pruneChecks(now = Date.now()) {
  run("DELETE FROM monitor_checks WHERE ts < ?", [now - RETENTION_DAYS * DAY]);
  run("DELETE FROM monitor_daily WHERE day < ?", [new Date(now - 120 * DAY).toISOString().slice(0, 10)]);
}

export function lastCheckTimes(): Map<number, number> {
  return new Map(
    all<{ monitor_id: number; ts: number }>("SELECT monitor_id, MAX(ts) AS ts FROM monitor_checks GROUP BY monitor_id").map((r) => [
      r.monitor_id,
      r.ts,
    ]),
  );
}

/* Lecture ------------------------------------------------------------------ */

export function lastCheck(monitorId: number): Check | undefined {
  return get<Check>("SELECT ts, up, ms, status, error FROM monitor_checks WHERE monitor_id = ? ORDER BY ts DESC LIMIT 1", [monitorId]);
}

export function uptimeSince(monitorId: number, since: number) {
  const r = get<{ n: number; ups: number; avg: number | null; min: number | null; max: number | null }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(up), 0) AS ups, AVG(CASE WHEN up = 1 THEN ms END) AS avg,
       MIN(CASE WHEN up = 1 THEN ms END) AS min, MAX(CASE WHEN up = 1 THEN ms END) AS max
     FROM monitor_checks WHERE monitor_id = ? AND ts >= ?`,
    [monitorId, since],
  )!;
  return { checks: r.n, uptime: r.n ? (r.ups / r.n) * 100 : null, avg: r.avg, min: r.min, max: r.max };
}

export type Bucket = { t: number; ms: number | null; checks: number; ups: number };

/** Série agrégée par tranches (temps de réponse moyen + disponibilité). */
export function buckets(monitorId: number, since: number, bucketMs: number): Bucket[] {
  const rows = all<Bucket>(
    `SELECT CAST(ts / ? AS INTEGER) * ? AS t, AVG(CASE WHEN up = 1 THEN ms END) AS ms, COUNT(*) AS checks, SUM(up) AS ups
     FROM monitor_checks WHERE monitor_id = ? AND ts >= ? GROUP BY t ORDER BY t`,
    [bucketMs, bucketMs, monitorId, since],
  );
  return rows.map((r) => ({ ...r, ms: r.ms === null ? null : Math.round(r.ms) }));
}

export type DailyUptime = { day: string; checks: number; uptime: number | null; avg: number | null };

/** Disponibilité jour par jour sur N jours (jours sans donnée inclus). */
export function dailyUptime(monitorId: number, days = 90, now = Date.now()): DailyUptime[] {
  const rows = new Map(
    all<{ day: string; checks: number; ups: number; sum_ms: number }>(
      "SELECT day, checks, ups, sum_ms FROM monitor_daily WHERE monitor_id = ? AND day >= ?",
      [monitorId, new Date(now - (days - 1) * DAY).toISOString().slice(0, 10)],
    ).map((r) => [r.day, r]),
  );
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(now - (days - 1 - i) * DAY).toISOString().slice(0, 10);
    const r = rows.get(day);
    return {
      day,
      checks: r?.checks ?? 0,
      uptime: r && r.checks ? (r.ups / r.checks) * 100 : null,
      avg: r && r.ups ? Math.round(r.sum_ms / r.ups) : null,
    };
  });
}

export function uptimeFromDaily(daily: DailyUptime[]) {
  const n = daily.reduce((a, d) => a + d.checks, 0);
  const ups = daily.reduce((a, d) => a + (d.uptime !== null ? (d.uptime / 100) * d.checks : 0), 0);
  return n ? (ups / n) * 100 : null;
}

export type Incident = { start: number; end: number | null; duration: number; error: string; checks: number };

/** Nombre d'échecs consécutifs requis pour déclarer une panne (filtre les « blips »). */
export const CONFIRM_FAILURES = 2;

/** État confirmé : en panne seulement après N échecs consécutifs. */
export function confirmedDown(monitorId: number) {
  const recent = all<{ up: number }>("SELECT up FROM monitor_checks WHERE monitor_id = ? ORDER BY ts DESC LIMIT ?", [monitorId, CONFIRM_FAILURES]);
  if (!recent.length) return null;
  if (recent[0].up) return false;
  return recent.length < CONFIRM_FAILURES ? true : recent.every((r) => !r.up);
}

/** Incidents = suites d'au moins N contrôles en échec (une suite en cours compte dès le premier échec si c'est la seule mesure). */
export function incidents(monitorId: number, since: number, now = Date.now()): Incident[] {
  const rows = all<{ ts: number; up: number; error: string }>(
    "SELECT ts, up, error FROM monitor_checks WHERE monitor_id = ? AND ts >= ? ORDER BY ts",
    [monitorId, since],
  );
  const out: Incident[] = [];
  let cur: Incident | null = null;
  for (const r of rows) {
    if (!r.up) {
      if (!cur) cur = { start: r.ts, end: null, duration: 0, error: r.error, checks: 0 };
      cur.checks++;
    } else if (cur) {
      cur.end = r.ts;
      cur.duration = r.ts - cur.start;
      out.push(cur);
      cur = null;
    }
  }
  if (cur) {
    cur.duration = now - cur.start;
    out.push(cur);
  }
  return out.filter((i) => i.checks >= CONFIRM_FAILURES || (i.end === null && rows.length < CONFIRM_FAILURES)).reverse();
}
