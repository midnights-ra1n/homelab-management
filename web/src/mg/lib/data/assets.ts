// Types of homelab-management's lib/data/assets.ts + client fetchers.
import { get, qs } from "../client";
import { resource } from "../resource";
import type { IpAddress } from "./network";
import type { Activity } from "./activity";
import type { AssetKind, AssetStatus } from "../constants";

export type Disk = { name: string; type: string; capacity_gb: number | null; usage: string };

export type Nic = { name: string; mac: string; speed: string };


export type Asset = {
  id: number;
  kind: AssetKind;
  display_name: string;
  hostname: string;
  status: AssetStatus;
  /** Source de la dernière détection automatique (ping, hlm = monitoring) ; vide = manuel. */
  status_source: string;
  status_checked_at: string | null;
  role: string;
  description: string;
  tags: string[];
  parent_id: number | null;
  os: string;
  os_version: string;
  location: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  cpu_model: string;
  cpu_sockets: number | null;
  cpu_cores: number | null;
  cpu_threads: number | null;
  ram_gb: number | null;
  ram_type: string;
  gpu: string;
  disks: Disk[];
  nics: Nic[];
  power_watts: number | null;
  management_url: string;
  docker_image: string;
  docker_ports: string;
  docker_compose: string;
  proxmox_integration_id: number | null;
  proxmox_node: string;
  proxmox_vmid: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
  // Jointures
  parent_name: string | null;
  parent_kind: AssetKind | null;
  primary_ip: string | null;
  primary_mac: string | null;
  subnet_id: number | null;
  subnet_name: string | null;
  subnet_cidr: string | null;
  vlan_number: number | null;
  vlan_name: string | null;
  children_count: number;
};

export type AssetFilters = { kind?: string; status?: string; q?: string; tag?: string; vlan?: string; host?: string };

export type AssetOption = { id: number; display_name: string; kind: AssetKind; hostname: string; subnet_id: number | null };

export type BulkOp =
  | { op: "status"; status: AssetStatus }
  | { op: "tag"; tag: string }
  | { op: "parent"; parentId: number | null }
  | { op: "delete" };


/* ---------------------------------------------------------------- fetchers */

export type DecommissionStep = { key: string; label: string; hint?: string; auto: boolean; done: boolean; result?: string };
export type Decommission = { started_at: string; previous_status: string; reason?: string; steps: DecommissionStep[] };

/** Everything the asset page shows (one request). */
export type AssetDetail = {
  asset: Asset & { hlm_integration_id: number | null; hlm_host_id: number | null; decommission: Decommission | null };
  children: Asset[];
  ancestors: { id: number; display_name: string }[];
  ips: IpAddress[];
  activity: Activity[];
  domains: { id: number; fqdn: string; exposure: string; proxy_asset_id: number | null; target_asset_id: number | null }[];
  tunnels: { id: number; name: string }[];
  rules: { id: number; name: string; position: number }[];
  shortcuts: { id: number; name: string; url: string }[];
};

export const listAssets = (filters: AssetFilters = {}) => get<Asset[]>(`/api/mg/assets${qs(filters)}`);
export const assetDetail = (id: number) => get<AssetDetail>(`/api/mg/assets/${id}`);
export const getAsset = (id: number) =>
  resource(`asset:${id}`, () => assetDetail(id).then((d) => d.asset as Asset | undefined, () => undefined));
export const childrenOf = (id: number) => resource(`children:${id}`, () => assetDetail(id).then((d) => d.children));
export const ancestorsOf = (id: number) => resource(`ancestors:${id}`, () => assetDetail(id).then((d) => d.ancestors));

export const assetOptions = (kinds?: AssetKind[]) => get<AssetOption[]>(`/api/mg/assets/options${qs({ kinds: kinds?.join(",") })}`);

type Meta = {
  hosts: { id: number; display_name: string; count: number }[];
  tags: { tag: string; count: number }[];
  counts: { kind: AssetKind; status: AssetStatus; n: number }[];
  hardware: { servers: number; cores: number; threads: number; ram_gb: number; watts: number }[];
  storage: { total: number }[];
};
const meta = () => get<Meta>("/api/mg/assets/meta");
export const hostOptions = () => resource("meta:hosts", () => meta().then((m) => m.hosts));
export const allTags = () => resource("meta:tags", () => meta().then((m) => m.tags));
export const hardwareTotals = () => resource("meta:hw", () => meta().then((m) => m.hardware[0]));
export const storageTotalGb = () => resource("meta:storage", () => meta().then((m) => m.storage[0]?.total ?? 0));
export const assetCounts = () =>
  resource("meta:counts", () =>
    meta().then((m) => {
      const byKind: Partial<Record<AssetKind, number>> = {};
      const byStatus: Partial<Record<AssetStatus, number>> = {};
      let total = 0;
      for (const r of m.counts) {
        byKind[r.kind] = (byKind[r.kind] ?? 0) + r.n;
        byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
        total += r.n;
      }
      return { total, byKind, byStatus };
    }),
  );

export type AssetMonitoring = {
  linked: boolean;
  integration?: { id: number; name: string; url: string };
  host_id?: number;
  host?: import("../integrations/hlm").HlmHost;
  error?: string;
};
/** Monitoring host linked to the item by the agent sync (live data from Midnights Monitoring). */
export const assetMonitoring = (id: number) => get<AssetMonitoring>(`/api/mg/assets/${id}/monitoring`);

export type AgentState = {
  asset_id: number;
  name: string;
  integration_id: number;
  host_id: number;
  version: string;
  latest: string;
  outdated: boolean;
  connected: boolean;
  install: string;
  action: { action: string; state: "pending" | "running" | "done" | "failed"; message: string; at: number } | null;
};
/** Agents of the items linked to monitored hosts, with their version. */
export const agentsState = () =>
  resource("agents", () =>
    get<{ agents: AgentState[]; errors: string[] }>("/api/mg/agents").catch((e: Error) => ({ agents: [] as AgentState[], errors: [e.message] })),
  );
