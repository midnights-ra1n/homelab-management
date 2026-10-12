import "server-only";
import tls from "node:tls";
import type { Integration } from "../data/integrations";
import { httpJson, IntegrationError } from "./http";

/**
 * Client Proxmox VE (API REST, jeton API).
 * Chaque intégration = un nœud (ou un cluster) indépendant : on agrège côté app,
 * sans cluster Proxmox ni Proxmox Datacenter Manager.
 */

export type PveResource = {
  id: string;
  type: "node" | "qemu" | "lxc" | "storage" | "sdn" | "pool";
  node: string;
  status: string;
  name?: string;
  vmid?: number;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  tags?: string;
  template?: number;
  storage?: string;
  plugintype?: string;
  content?: string;
  shared?: number;
};

export type PveNodeStatus = {
  cpu: number;
  cpuinfo: { model: string; cores: number; cpus: number; sockets: number; mhz: string };
  memory: { total: number; used: number; free: number };
  rootfs: { total: number; used: number };
  swap?: { total: number; used: number };
  uptime: number;
  loadavg: string[];
  kversion: string;
  pveversion: string;
  "current-kernel"?: { release: string };
};

export type PveTask = {
  upid: string;
  node: string;
  type: string;
  id: string;
  user: string;
  status?: string;
  starttime: number;
  endtime?: number;
};

export type GuestType = "qemu" | "lxc";
export const GUEST_ACTIONS = ["start", "shutdown", "stop", "reboot", "suspend", "resume"] as const;
export type GuestAction = (typeof GUEST_ACTIONS)[number];

export function authHeader(i: Integration) {
  const { token_id, token_secret } = i.config;
  if (!token_id || !token_secret) throw new IntegrationError("Jeton API Proxmox manquant (ID + secret)");
  return { Authorization: `PVEAPIToken=${token_id}=${token_secret}` };
}

async function pve<T>(i: Integration, path: string, init: { method?: string; body?: URLSearchParams } = {}) {
  const res = await httpJson<{ data: T }>(`${i.url}/api2/json${path}`, {
    method: init.method,
    body: init.body,
    headers: {
      ...authHeader(i),
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    verifyTls: i.config.verify_tls ?? false,
    timeoutMs: init.method === "POST" ? 15000 : 8000,
  });
  return res.data;
}

export async function testProxmox(i: Integration) {
  const v = await pve<{ version: string; release: string }>(i, "/version");
  const nodes = await pve<{ node: string }[]>(i, "/nodes");
  return `Proxmox VE ${v.version} — ${nodes.length} nœud(s) : ${nodes.map((n) => n.node).join(", ")}`;
}

export type ProxmoxOverview = {
  integration: { id: number; name: string; url: string };
  version: string;
  nodes: (PveResource & { details?: PveNodeStatus })[];
  guests: PveResource[];
  storages: PveResource[];
};

export async function proxmoxOverview(i: Integration): Promise<ProxmoxOverview> {
  const [version, resources] = await Promise.all([
    pve<{ version: string }>(i, "/version"),
    pve<PveResource[]>(i, "/cluster/resources"),
  ]);
  const nodes = resources.filter((r) => r.type === "node");
  const details = await Promise.allSettled(
    nodes.map((n) => (n.status === "online" ? pve<PveNodeStatus>(i, `/nodes/${n.node}/status`) : Promise.reject())),
  );
  return {
    integration: { id: i.id, name: i.name, url: i.url },
    version: version.version,
    nodes: nodes.map((n, idx) => ({
      ...n,
      details: details[idx].status === "fulfilled" ? details[idx].value : undefined,
    })),
    guests: resources
      .filter((r) => (r.type === "qemu" || r.type === "lxc") && !r.template)
      .sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0)),
    storages: resources.filter((r) => r.type === "storage"),
  };
}

export async function proxmoxTasks(i: Integration, node: string, limit = 15) {
  return pve<PveTask[]>(i, `/nodes/${encodeURIComponent(node)}/tasks?limit=${limit}`);
}

export async function guestAction(i: Integration, node: string, type: GuestType, vmid: number, action: GuestAction) {
  if (!GUEST_ACTIONS.includes(action)) throw new IntegrationError("Action inconnue");
  assertGuest(type, vmid);
  if (type === "lxc" && (action === "suspend" || action === "resume")) {
    throw new IntegrationError("Suspendre / reprendre n'est disponible que pour les VM");
  }
  return pve<string>(i, `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/status/${action}`, {
    method: "POST",
    body: new URLSearchParams(),
  });
}

/* --------------------------------------------------------------------------
 * Migration distante entre nœuds hors cluster (qm/pct remote-migrate)
 * ------------------------------------------------------------------------ */

export async function targetOptions(i: Integration, node: string) {
  const [storages, networks] = await Promise.all([
    pve<{ storage: string; content: string; active?: number; avail?: number }[]>(
      i,
      `/nodes/${encodeURIComponent(node)}/storage?enabled=1`,
    ),
    pve<{ iface: string; type: string }[]>(i, `/nodes/${encodeURIComponent(node)}/network?type=any_bridge`),
  ]);
  return {
    storages: storages
      .filter((s) => /images|rootdir/.test(s.content))
      .map((s) => ({ storage: s.storage, content: s.content, avail: s.avail ?? null })),
    bridges: networks.map((n) => n.iface).sort(),
  };
}

/** Empreinte SHA-256 du certificat TLS d'un nœud (requise par remote_migrate). */
export function certificateFingerprint(url: string): Promise<string> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: u.hostname, port: Number(u.port || 8006), servername: u.hostname, rejectUnauthorized: false },
      () => {
        const fp = socket.getPeerCertificate().fingerprint256;
        socket.end();
        if (fp) resolve(fp);
        else reject(new IntegrationError("Empreinte du certificat introuvable"));
      },
    );
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new IntegrationError("Délai dépassé lors de la lecture du certificat"));
    });
    socket.on("error", (e) => reject(new IntegrationError(e.message)));
  });
}

export async function remoteMigrate(opts: {
  source: Integration;
  sourceNode: string;
  type: GuestType;
  vmid: number;
  target: Integration;
  targetStorage: string;
  targetBridge: string;
  targetVmid?: number | null;
  online: boolean;
  deleteSource: boolean;
}) {
  const { target } = opts;
  assertGuest(opts.type, opts.vmid, opts.targetVmid);
  if (!target.config.token_id || !target.config.token_secret) {
    throw new IntegrationError("Le nœud cible n'a pas de jeton API configuré");
  }
  const u = new URL(target.url);
  const fingerprint = await certificateFingerprint(target.url);
  const endpoint = [
    `apitoken=PVEAPIToken=${target.config.token_id}=${target.config.token_secret}`,
    `host=${u.hostname}`,
    `port=${u.port || 8006}`,
    `fingerprint=${fingerprint}`,
  ].join(",");
  const body = new URLSearchParams({
    "target-endpoint": endpoint,
    "target-storage": opts.targetStorage,
    "target-bridge": opts.targetBridge,
    delete: opts.deleteSource ? "1" : "0",
  });
  if (opts.targetVmid) body.set("target-vmid", String(opts.targetVmid));
  if (opts.type === "qemu" && opts.online) body.set("online", "1");
  if (opts.type === "lxc" && opts.online) body.set("restart", "1");
  return pve<string>(opts.source, `/nodes/${encodeURIComponent(opts.sourceNode)}/${opts.type}/${opts.vmid}/remote_migrate`, {
    method: "POST",
    body,
  });
}

/** Les arguments arrivent du client (server actions) et finissent dans le chemin de l'API Proxmox. */
function assertGuest(type: unknown, vmid: unknown, targetVmid: unknown = null) {
  const okId = (v: unknown) => Number.isInteger(v) && (v as number) >= 100 && (v as number) <= 999_999_999;
  if ((type !== "qemu" && type !== "lxc") || !okId(vmid) || (targetVmid != null && !okId(targetVmid))) {
    throw new IntegrationError("Invité Proxmox invalide");
  }
}

/** Ouvre une session VNC (noVNC) : le ticket sert de mot de passe VNC, à utiliser sous ~10 s. */
export async function vncProxy(i: Integration, node: string, type: GuestType, vmid: number) {
  assertGuest(type, vmid);
  return pve<{ port: string | number; ticket: string }>(i, `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/vncproxy`, {
    method: "POST",
    body: new URLSearchParams({ websocket: "1" }),
  });
}

/** Lien direct vers l'interface web Proxmox pour un invité. */
export function guestConsoleUrl(baseUrl: string, type: GuestType, vmid: number) {
  return `${baseUrl}/#v1:0:=${type}%2F${vmid}:4:::::::`;
}
