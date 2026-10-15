import "server-only";
import { execFile } from "node:child_process";
import { all, run, transaction } from "../db";
import { ipToInt } from "../ip";

/**
 * État des éléments de l'inventaire : ping de l'IP principale, toutes les minutes.
 * Sans IP, l'état reste celui saisi à la main. Les états manuels (maintenance, planifié, retiré)
 * ne sont jamais écrasés. Les intégrations n'écrivent jamais dans l'inventaire.
 */

const PING_BATCH = 16;

/** Arguments du binaire ping : `-W` en secondes sous Linux (iputils, busybox), en millisecondes sous macOS. */
export function pingArgs(ip: string, timeoutMs: number, platform: NodeJS.Platform = process.platform) {
  const wait = platform === "darwin" ? String(timeoutMs) : String(Math.max(1, Math.round(timeoutMs / 1000)));
  return ["-n", "-c", "1", "-W", wait, ip];
}

/** Un seul écho ICMP ; true si l'hôte répond. Une IPv4 valide uniquement (jamais d'option passée à ping). */
export function ping(ip: string, timeoutMs = 2000): Promise<boolean> {
  if (ipToInt(ip) === null) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("ping", pingArgs(ip, timeoutMs), { timeout: timeoutMs + 1500 }, (err) => resolve(!err));
  });
}

export async function refreshAssetStatuses() {
  const assets = all<{ id: number; ip: string | null }>(
    `SELECT a.id, (SELECT address FROM ip_addresses WHERE asset_id = a.id ORDER BY is_primary DESC, id LIMIT 1) AS ip
     FROM assets a WHERE a.status IN ('online','offline')`,
  );
  if (!assets.length) return;

  const targets = assets.filter((a) => a.ip);
  // Par lots : on borne le nombre de processus ping simultanés.
  const results: [number, boolean][] = [];
  for (let i = 0; i < targets.length; i += PING_BATCH) {
    const batch = targets.slice(i, i + PING_BATCH);
    results.push(...(await Promise.all(batch.map(async (a): Promise<[number, boolean]> => [a.id, await ping(a.ip!)]))));
  }

  const now = new Date().toISOString();
  transaction(() => {
    for (const [id, online] of results) {
      // Re-filtre l'état : il a pu passer en maintenance pendant la collecte.
      run(
        `UPDATE assets SET status = ?, status_source = 'ping', status_checked_at = ?
         WHERE id = ? AND status IN ('online','offline')`,
        [online ? "online" : "offline", now, id],
      );
    }
    // IP retirée : l'état redevient manuel, on efface l'ancienne source.
    for (const a of assets) {
      if (!a.ip) run("UPDATE assets SET status_source = '', status_checked_at = NULL WHERE id = ? AND status_source != ''", [a.id]);
    }
  });
}
