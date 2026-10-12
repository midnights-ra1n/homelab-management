import "server-only";
import { lastCheckTimes, listMonitors, pruneChecks, recordCheck, type Monitor } from "../data/monitors";
import { refreshAssetStatuses } from "./asset-status";
import { probeHttp, probeTcp } from "./probe";

/**
 * Moniteur en tâche de fond : toutes les 10 s, lance les sondes dont
 * l'intervalle est écoulé (max 8 en parallèle) et enregistre le résultat.
 */
const TICK_MS = 10_000;
const CONCURRENCY = 8;
const ASSET_STATUS_MS = 60_000;

const g = globalThis as unknown as { __hmPoller?: { timer: NodeJS.Timeout; running: Set<number>; lastPrune: number; lastAssets: number; assetsBusy: boolean } };

async function runOne(m: Monitor) {
  const r =
    m.type === "tcp"
      ? await probeTcp(m.target, m.timeout_ms)
      : await probeHttp(m.target, { timeoutMs: m.timeout_ms, verifyTls: !!m.verify_tls, accept: m.accept });
  recordCheck(m.id, { ts: Date.now(), up: r.up ? 1 : 0, ms: r.ms, status: r.status, error: r.error });
}

async function tick() {
  const state = g.__hmPoller!;
  const now = Date.now();
  const last = lastCheckTimes();
  if (!state.assetsBusy && now - state.lastAssets >= ASSET_STATUS_MS - 1000) {
    // En parallèle des sondes : les API d'intégration peuvent mettre plusieurs secondes à répondre.
    state.assetsBusy = true;
    state.lastAssets = now;
    void refreshAssetStatuses()
      .catch((e) => console.error("[état inventaire]", e))
      .finally(() => (state.assetsBusy = false));
  }
  const due = listMonitors().filter(
    (m) => m.enabled && !state.running.has(m.id) && now - (last.get(m.id) ?? 0) >= m.interval_sec * 1000 - 1000,
  );
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY);
    batch.forEach((m) => state.running.add(m.id));
    await Promise.allSettled(batch.map(runOne));
    batch.forEach((m) => state.running.delete(m.id));
  }
  if (now - state.lastPrune > 3600_000) {
    pruneChecks(now);
    state.lastPrune = now;
  }
}

export function startPoller() {
  if (g.__hmPoller) return;
  g.__hmPoller = {
    running: new Set(),
    lastPrune: 0,
    lastAssets: 0,
    assetsBusy: false,
    timer: setInterval(() => void tick().catch((e) => console.error("[sondes]", e)), TICK_MS),
  };
  g.__hmPoller.timer.unref?.();
  void tick().catch((e) => console.error("[sondes]", e));
}

/** Lance immédiatement une sonde (bouton « Tester maintenant »). */
export async function runNow(m: Monitor) {
  await runOne(m);
}
