
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

export type GuestAction = (typeof GUEST_ACTIONS)[number];

export type ProxmoxOverview = {
  integration: { id: number; name: string; url: string };
  version: string;
  nodes: (PveResource & { details?: PveNodeStatus })[];
  guests: PveResource[];
  storages: PveResource[];
};

export type Timeframe = (typeof TIMEFRAMES)[number];

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

export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

export const GUEST_ACTIONS = ["start", "shutdown", "stop", "reboot", "suspend", "resume"] as const;

export const TIMEFRAMES = ["hour", "day", "week", "month", "year"] as const;

export const SERVICE_ACTIONS = ["start", "stop", "restart", "reload"] as const;

export const BACKUP_MODES = ["snapshot", "suspend", "stop"] as const;

/** Lien direct vers l'interface web Proxmox pour un invité. */
export function guestConsoleUrl(baseUrl: string, type: GuestType, vmid: number) {
  return `${baseUrl}/#v1:0:=${type}%2F${vmid}:4:::::::`;
}

/* ---------------------------------------------------------------- fetchers */

import { get } from "../client";
import { resource } from "../resource";

type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

/** Proxmox views pass through the server; a failed call rejects with the API's message. */
function pveGet<T>(path: string) {
  return resource(`pve-unwrap:${path}`, () =>
    get<Reply<T>>(path).then((r) => {
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }),
  );
}

const nodeBase = (i: { id: number }, node: string) => `/api/mg/proxmox/${i.id}/node/${encodeURIComponent(node)}`;
const guestBase = (i: { id: number }, node: string, type: GuestType, vmid: number) =>
  `/api/mg/proxmox/${i.id}/guest/${encodeURIComponent(node)}/${type}/${vmid}`;

export const proxmoxOverview = (i: { id: number }) => pveGet<ProxmoxOverview>(`/api/mg/proxmox/${i.id}`);
export const nodeStatus = (i: { id: number }, node: string) => pveGet<PveNodeStatus>(`${nodeBase(i, node)}/status`);
export const nodeRrd = (i: { id: number }, node: string, tf: Timeframe) => pveGet<PveRrdPoint[]>(`${nodeBase(i, node)}/rrd?tf=${tf}`);
export const nodeNetwork = (i: { id: number }, node: string) => pveGet<PveNetwork[]>(`${nodeBase(i, node)}/network`);
export const nodeDisks = (i: { id: number }, node: string) => pveGet<PveDisk[]>(`${nodeBase(i, node)}/disks`);
export const nodeStorages = (i: { id: number }, node: string) => pveGet<PveStorage[]>(`${nodeBase(i, node)}/storage`);
export const nodeServices = (i: { id: number }, node: string) => pveGet<PveService[]>(`${nodeBase(i, node)}/services`);
export const nodeUpdates = (i: { id: number }, node: string) => pveGet<PveUpdate[]>(`${nodeBase(i, node)}/updates`);
export const nodeSyslog = (i: { id: number }, node: string, _limit = 500) => pveGet<{ n: number; t: string }[]>(`${nodeBase(i, node)}/syslog`);
export const nodeTaskList = (i: { id: number }, node: string, vmid?: number) =>
  pveGet<PveTask[]>(`${nodeBase(i, node)}/tasks${vmid ? `?vmid=${vmid}` : ""}`);
export const storageContent = (i: { id: number }, node: string, storage: string, opts: { content?: string; vmid?: number } = {}) => {
  const q = new URLSearchParams({ storage });
  if (opts.content) q.set("content", opts.content);
  if (opts.vmid) q.set("vmid", String(opts.vmid));
  return pveGet<PveVolume[]>(`${nodeBase(i, node)}/content?${q}`);
};
export const guestStatus = (i: { id: number }, node: string, type: GuestType, vmid: number) =>
  pveGet<PveGuestStatus>(`${guestBase(i, node, type, vmid)}/status`);
export const guestRrd = (i: { id: number }, node: string, type: GuestType, vmid: number, tf: Timeframe) =>
  pveGet<PveRrdPoint[]>(`${guestBase(i, node, type, vmid)}/rrd?tf=${tf}`);
export const guestConfig = (i: { id: number }, node: string, type: GuestType, vmid: number) =>
  pveGet<Record<string, string | number>>(`${guestBase(i, node, type, vmid)}/config`);
export const guestSnapshots = (i: { id: number }, node: string, type: GuestType, vmid: number) =>
  pveGet<PveSnapshot[]>(`${guestBase(i, node, type, vmid)}/snapshots`);
export const guestInterfaces = (i: { id: number }, node: string, type: GuestType, vmid: number) =>
  pveGet<PveInterface[]>(`${guestBase(i, node, type, vmid)}/interfaces`);
export const guestBackups = (i: { id: number }, node: string, vmid: number, type: GuestType = "qemu") =>
  pveGet<{ storages: string[]; backups: (PveVolume & { storage: string })[] }>(`${guestBase(i, node, type, vmid)}/backups`);
