import "server-only";
import { refreshAssetStatuses } from "./asset-status";

/**
 * Tâche de fond : toutes les minutes, état réel de l'inventaire.
 * Les sondes de disponibilité sont gérées par Homelab Monitoring.
 */
const TICK_MS = 10_000;
const ASSET_STATUS_MS = 60_000;

const g = globalThis as unknown as { __hmPoller?: { timer: NodeJS.Timeout; lastAssets: number; assetsBusy: boolean } };

function tick() {
  const state = g.__hmPoller!;
  const now = Date.now();
  if (!state.assetsBusy && now - state.lastAssets >= ASSET_STATUS_MS - 1000) {
    // Les API d'intégration peuvent mettre plusieurs secondes à répondre : jamais deux passes en même temps.
    state.assetsBusy = true;
    state.lastAssets = now;
    void refreshAssetStatuses()
      .catch((e) => console.error("[état inventaire]", e))
      .finally(() => (state.assetsBusy = false));
  }
}

function safeTick() {
  try {
    tick();
  } catch (e) {
    console.error("[tâche de fond]", e);
  }
}

export function startPoller() {
  if (g.__hmPoller) return;
  g.__hmPoller = { lastAssets: 0, assetsBusy: false, timer: setInterval(safeTick, TICK_MS) };
  g.__hmPoller.timer.unref?.();
  safeTick();
}
