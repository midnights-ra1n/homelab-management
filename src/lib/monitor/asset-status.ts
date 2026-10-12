import "server-only";
import net from "node:net";
import { all, run, transaction } from "../db";
import { fetchBeszel, fetchMaintenant, fetchProxmox } from "../integrations";

/**
 * Détection de l'état réel des actifs de l'inventaire, par ordre de fiabilité :
 * Proxmox (VM/CT liés, nœuds) → Beszel → Maintenant (Docker) → sonde TCP sur l'IP.
 * Les états manuels (maintenance, planifié, retiré) ne sont jamais écrasés.
 */

type Row = {
  id: number;
  kind: string;
  display_name: string;
  hostname: string;
  proxmox_integration_id: number | null;
  proxmox_vmid: number | null;
  management_url: string;
  ip: string | null;
};

export type Detected = { online: boolean; source: string };

const PROBE_PORTS = [22, 80, 443, 8006, 3389, 445, 53, 8080];
const PROBE_BATCH = 16;

/** Hôte vivant si un port accepte la connexion ou la refuse (RST) ; muet ou injoignable sinon. */
export async function hostAlive(host: string, timeoutMs = 2500): Promise<boolean> {
  const tryPort = (port: number) =>
    new Promise<boolean>((resolve, reject) => {
      const s = net.connect({ host, port });
      const end = (alive: boolean) => {
        s.destroy();
        if (alive) resolve(true);
        else reject(new Error("down"));
      };
      s.setTimeout(timeoutMs, () => end(false));
      s.once("connect", () => end(true));
      s.once("error", (e: NodeJS.ErrnoException) => end(e.code === "ECONNREFUSED"));
    });
  return Promise.any(PROBE_PORTS.map(tryPort)).catch(() => false);
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function keys(a: Row) {
  return [a.hostname, a.display_name, a.ip, a.hostname.split(".")[0]].map(norm).filter(Boolean);
}

function urlHost(u: string) {
  try {
    return u ? new URL(u).hostname : "";
  } catch {
    return "";
  }
}

/** Décide de l'état d'un actif à partir des sources déjà collectées. Pur, donc testable. */
export function detect(
  a: Row,
  src: {
    guests: Map<string, boolean>; // `${integrationId}:${vmid}` → running
    pveOk: Set<number>;
    nodes: Map<string, boolean>; // nom de nœud → online
    beszel: Map<string, boolean>; // nom / hôte → up
    containers: Map<string, boolean>; // nom → running
  },
): Detected | null {
  if (a.proxmox_integration_id && a.proxmox_vmid && src.pveOk.has(a.proxmox_integration_id)) {
    const running = src.guests.get(`${a.proxmox_integration_id}:${a.proxmox_vmid}`);
    if (running !== undefined) return { online: running, source: "proxmox" };
  }
  const k = keys(a);
  if (a.kind === "physical") {
    const hit = k.find((x) => src.nodes.has(x));
    if (hit) return { online: src.nodes.get(hit)!, source: "proxmox" };
  }
  if (a.kind === "docker") {
    const hit = k.find((x) => src.containers.has(x));
    if (hit) return { online: src.containers.get(hit)!, source: "maintenant" };
    return null; // l'IP d'un conteneur est souvent celle de l'hôte : une sonde serait trompeuse
  }
  const hit = k.find((x) => src.beszel.has(x));
  if (hit) return { online: src.beszel.get(hit)!, source: "beszel" };
  return null;
}

export async function refreshAssetStatuses() {
  const assets = all<Row>(
    `SELECT a.id, a.kind, a.display_name, a.hostname, a.proxmox_integration_id, a.proxmox_vmid, a.management_url,
       (SELECT address FROM ip_addresses WHERE asset_id = a.id ORDER BY is_primary DESC, id LIMIT 1) AS ip
     FROM assets a WHERE a.status IN ('online','offline')`,
  );
  if (!assets.length) return;
  const [pve, beszel, maintenant] = await Promise.all([fetchProxmox(), fetchBeszel(), fetchMaintenant()]);

  const src = {
    guests: new Map<string, boolean>(),
    pveOk: new Set<number>(),
    nodes: new Map<string, boolean>(),
    beszel: new Map<string, boolean>(),
    containers: new Map<string, boolean>(),
  };
  for (const p of pve) {
    if (!p.data) continue;
    src.pveOk.add(p.id);
    for (const g of p.data.guests) src.guests.set(`${p.id}:${g.vmid}`, g.status === "running");
    for (const n of p.data.nodes) src.nodes.set(norm(n.node), n.status === "online");
  }
  for (const s of beszel.flatMap((b) => b.data ?? [])) {
    if (s.status !== "up" && s.status !== "down") continue; // en pause / en attente : inconnu
    for (const k of [s.name, s.host, s.hostname]) if (k) src.beszel.set(norm(k), s.status === "up");
  }
  for (const c of maintenant.flatMap((m) => m.data?.containers ?? [])) {
    src.containers.set(norm(c.name).replace(/^\//, ""), c.state === "running");
  }

  const check = async (a: Row): Promise<[number, Detected | null]> => {
    const d = detect(a, src);
    if (d || a.kind === "docker") return [a.id, d];
    const host = a.ip || urlHost(a.management_url);
    return [a.id, host ? { online: await hostAlive(host), source: "tcp" } : null];
  };
  // Par lots : chaque sonde ouvre jusqu'à 8 sockets, on borne le nombre de connexions simultanées.
  const results: [number, Detected | null][] = [];
  for (let i = 0; i < assets.length; i += PROBE_BATCH) {
    results.push(...(await Promise.all(assets.slice(i, i + PROBE_BATCH).map(check))));
  }

  const now = new Date().toISOString();
  transaction(() => {
    for (const [id, d] of results) {
      if (!d) continue;
      // Re-filtre l'état : il a pu passer en maintenance pendant la collecte.
      run(
        `UPDATE assets SET status = ?, status_source = ?, status_checked_at = ?
         WHERE id = ? AND status IN ('online','offline')`,
        [d.online ? "online" : "offline", d.source, now, id],
      );
    }
  });
}
