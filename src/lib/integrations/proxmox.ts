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

/* --------------------------------------------------------------------------
 * Vues détaillées « comme dans Proxmox » : nœud et invité
 * ------------------------------------------------------------------------ */

export const TIMEFRAMES = ["hour", "day", "week", "month", "year"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Point RRD : nœud (memused, loadavg…) ou invité (mem, diskread…). */
export type PveRrdPoint = {
  time: number;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  memused?: number;
  memtotal?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  loadavg?: number;
  iowait?: number;
};

export type PveNetwork = {
  iface: string;
  type: string;
  active?: number;
  autostart?: number;
  method?: string;
  cidr?: string;
  address?: string;
  gateway?: string;
  bridge_ports?: string;
  "bridge-vlan-aware"?: number;
  comments?: string;
};

export type PveDisk = {
  devpath: string;
  model?: string;
  serial?: string;
  size: number;
  type?: string;
  health?: string;
  wearout?: number | string;
  used?: string;
  gpt?: number;
};

export type PveStorage = {
  storage: string;
  type: string;
  content: string;
  active?: number;
  enabled?: number;
  shared?: number;
  used?: number;
  total?: number;
  avail?: number;
};

export type PveVolume = { volid: string; format?: string; size: number; content: string; vmid?: number; ctime?: number; notes?: string; protected?: number };
export type PveService = { service: string; name: string; desc?: string; state: string; "active-state"?: string; "unit-state"?: string };
export type PveUpdate = { Package: string; Title?: string; OldVersion?: string; Version: string; Priority?: string; Origin?: string };
export type PveSnapshot = { name: string; description?: string; snaptime?: number; parent?: string; vmstate?: number };
export type PveGuestStatus = {
  status: string;
  name?: string;
  qmpstatus?: string;
  lock?: string;
  cpu?: number;
  cpus?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  swap?: number;
  maxswap?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  uptime?: number;
  pid?: number;
  agent?: number;
  ha?: { managed?: number; state?: string };
  "running-qemu"?: string;
  "running-machine"?: string;
};
export type PveInterface = { name: string; hwaddr?: string; addresses: string[] };

export const SERVICE_ACTIONS = ["start", "stop", "restart", "reload"] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];
export const BACKUP_MODES = ["snapshot", "suspend", "stop"] as const;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
/** Les noms (nœud, stockage, service, snapshot) arrivent du client et finissent dans le chemin de l'API. */
function assertName(...names: string[]) {
  if (!names.every((n) => typeof n === "string" && NAME_RE.test(n))) throw new IntegrationError("Nom invalide");
}
const nodePath = (node: string) => {
  assertName(node);
  return `/nodes/${node}`;
};
const guestPath = (node: string, type: GuestType, vmid: number) => {
  assertGuest(type, vmid);
  return `${nodePath(node)}/${type}/${vmid}`;
};
const post = (body: Record<string, string> = {}) => ({ method: "POST", body: new URLSearchParams(body) });

export const nodeStatus = (i: Integration, node: string) => pve<PveNodeStatus>(i, `${nodePath(node)}/status`);
export const nodeRrd = (i: Integration, node: string, tf: Timeframe) =>
  pve<PveRrdPoint[]>(i, `${nodePath(node)}/rrddata?timeframe=${tf}&cf=AVERAGE`);
export const nodeNetwork = (i: Integration, node: string) => pve<PveNetwork[]>(i, `${nodePath(node)}/network`);
export const nodeDisks = (i: Integration, node: string) => pve<PveDisk[]>(i, `${nodePath(node)}/disks/list?include-partitions=0`);
export const nodeStorages = (i: Integration, node: string) => pve<PveStorage[]>(i, `${nodePath(node)}/storage`);
export const nodeServices = (i: Integration, node: string) => pve<PveService[]>(i, `${nodePath(node)}/services`);
export const nodeUpdates = (i: Integration, node: string) => pve<PveUpdate[]>(i, `${nodePath(node)}/apt/update`);
export const nodeSyslog = (i: Integration, node: string, limit = 300) =>
  pve<{ n: number; t: string }[]>(i, `${nodePath(node)}/syslog?limit=${limit}`);
export const nodeTaskList = (i: Integration, node: string, vmid?: number) =>
  pve<PveTask[]>(i, `${nodePath(node)}/tasks?limit=50${vmid ? `&vmid=${vmid}` : ""}`);

export function storageContent(i: Integration, node: string, storage: string, opts: { content?: string; vmid?: number } = {}) {
  assertName(storage);
  const q = new URLSearchParams();
  if (opts.content) q.set("content", opts.content);
  if (opts.vmid) q.set("vmid", String(opts.vmid));
  return pve<PveVolume[]>(i, `${nodePath(node)}/storage/${storage}/content?${q}`);
}

export function serviceAction(i: Integration, node: string, service: string, action: ServiceAction) {
  assertName(service);
  if (!SERVICE_ACTIONS.includes(action)) throw new IntegrationError("Action inconnue");
  return pve<string>(i, `${nodePath(node)}/services/${service}/${action}`, post());
}

export const aptRefresh = (i: Integration, node: string) => pve<string>(i, `${nodePath(node)}/apt/update`, post());

export function nodePower(i: Integration, node: string, command: "reboot" | "shutdown") {
  if (command !== "reboot" && command !== "shutdown") throw new IntegrationError("Commande inconnue");
  return pve<null>(i, `${nodePath(node)}/status`, post({ command }));
}

export const guestStatus = (i: Integration, node: string, type: GuestType, vmid: number) =>
  pve<PveGuestStatus>(i, `${guestPath(node, type, vmid)}/status/current`);
export const guestRrd = (i: Integration, node: string, type: GuestType, vmid: number, tf: Timeframe) =>
  pve<PveRrdPoint[]>(i, `${guestPath(node, type, vmid)}/rrddata?timeframe=${tf}&cf=AVERAGE`);
export const guestConfig = (i: Integration, node: string, type: GuestType, vmid: number) =>
  pve<Record<string, string | number>>(i, `${guestPath(node, type, vmid)}/config`);
export const guestSnapshots = (i: Integration, node: string, type: GuestType, vmid: number) =>
  pve<PveSnapshot[]>(i, `${guestPath(node, type, vmid)}/snapshot`);

/** Adresses IP : agent invité pour une VM (s'il tourne), interfaces du conteneur pour un CT. */
export async function guestInterfaces(i: Integration, node: string, type: GuestType, vmid: number): Promise<PveInterface[]> {
  if (type === "lxc") {
    const list = await pve<{ name: string; hwaddr?: string; inet?: string; inet6?: string }[]>(i, `${guestPath(node, type, vmid)}/interfaces`);
    return list.filter((n) => n.name !== "lo").map((n) => ({ name: n.name, hwaddr: n.hwaddr, addresses: [n.inet, n.inet6].filter(Boolean) as string[] }));
  }
  const r = await pve<{ result: { name: string; "hardware-address"?: string; "ip-addresses"?: { "ip-address": string; prefix: number }[] }[] }>(
    i,
    `${guestPath(node, type, vmid)}/agent/network-get-interfaces`,
  );
  return r.result
    .filter((n) => n.name !== "lo")
    .map((n) => ({ name: n.name, hwaddr: n["hardware-address"], addresses: (n["ip-addresses"] ?? []).map((a) => `${a["ip-address"]}/${a.prefix}`) }));
}

/** Mise à jour partielle de la configuration (PUT synchrone) ; `remove` = clés à supprimer. */
export function updateGuestConfig(i: Integration, node: string, type: GuestType, vmid: number, values: Record<string, string>, remove: string[] = []) {
  const body = new URLSearchParams(values);
  if (remove.length) body.set("delete", remove.join(","));
  return pve<null>(i, `${guestPath(node, type, vmid)}/config`, { method: "PUT", body });
}

export function createSnapshot(i: Integration, node: string, type: GuestType, vmid: number, name: string, description: string, vmstate: boolean) {
  assertName(name);
  const body: Record<string, string> = { snapname: name, description };
  if (type === "qemu" && vmstate) body.vmstate = "1";
  return pve<string>(i, `${guestPath(node, type, vmid)}/snapshot`, post(body));
}

export function snapshotCommand(i: Integration, node: string, type: GuestType, vmid: number, name: string, command: "rollback" | "delete") {
  assertName(name);
  if (name === "current") throw new IntegrationError("État courant : rien à faire");
  const path = `${guestPath(node, type, vmid)}/snapshot/${name}`;
  return command === "rollback" ? pve<string>(i, `${path}/rollback`, post()) : pve<string>(i, path, { method: "DELETE" });
}

/** Sauvegardes vzdump d'un invité sur tous les stockages « backup » actifs du nœud. */
export async function guestBackups(i: Integration, node: string, vmid: number) {
  const storages = (await nodeStorages(i, node)).filter((s) => s.active && s.content.split(",").includes("backup"));
  const lists = await Promise.allSettled(storages.map((s) => storageContent(i, node, s.storage, { content: "backup", vmid })));
  return {
    storages: storages.map((s) => s.storage),
    backups: lists
      .flatMap((r, idx) => (r.status === "fulfilled" ? r.value.map((v) => ({ ...v, storage: storages[idx].storage })) : []))
      .sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0)),
  };
}

export function backupNow(i: Integration, node: string, vmid: number, storage: string, mode: (typeof BACKUP_MODES)[number]) {
  assertGuest("qemu", vmid);
  assertName(storage);
  if (!BACKUP_MODES.includes(mode)) throw new IntegrationError("Mode de sauvegarde inconnu");
  return pve<string>(i, `${nodePath(node)}/vzdump`, post({ vmid: String(vmid), storage, mode, compress: "zstd" }));
}
