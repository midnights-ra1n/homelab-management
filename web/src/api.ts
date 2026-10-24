export type Status = "operational" | "degraded" | "maintenance" | "minor_outage" | "major_outage" | "unknown";

export const statusLabel: Record<Status, string> = {
  operational: "Opérationnel",
  degraded: "Performances dégradées",
  maintenance: "Maintenance",
  minor_outage: "Panne partielle",
  major_outage: "Panne majeure",
  unknown: "En attente",
};

/** Preferences shared with the iOS / macOS app (merged per key by the server). */
export interface Preferences { theme?: "auto" | "light" | "dark"; monitors_view?: "cards" | "table"; [k: string]: unknown }
export const savePrefs = (p: Preferences) => { api.put("/api/preferences", p).catch(() => { /* offline: kept locally */ }); };

export interface HostInfo {
  hostname?: string; os?: string; kernel?: string; arch?: string; cpu_model?: string;
  cpu_cores?: number; mem_total?: number; agent_version?: string; boot_time?: number;
  virtualization?: string; manufacturer?: string; model?: string; ips?: { iface: string; address: string; prefix: number }[];
}
export interface HostLatest {
  cpu?: number; mem_used?: number; mem_total?: number; swap_used?: number; swap_total?: number;
  disk_used?: number; disk_total?: number; net_rx?: number; net_tx?: number; load1?: number; temp?: number | null; cpu_temp?: number | null;
  disks?: { mount: string; fs: string; used: number; total: number }[];
  temps?: { label: string; c: number }[];
  ifaces?: { name: string; rx: number; tx: number }[];
}
export interface Package { name: string; current: string; candidate: string; security: boolean }
export interface HostUpdates {
  manager: string; packages?: Package[]; reboot_required: boolean; lists_updated_at: number;
  checked_at: number; pending: number; security: number;
}
export interface Host {
  id: number; name: string; status: Status; last_seen: number; maintenance: boolean; public: boolean;
  connected: boolean; agent_down: boolean; reachable?: boolean; info: HostInfo; latest: HostLatest; updates: HostUpdates | null; created_at: number;
  action: HostAction | null; agent_latest: string; agent_outdated: boolean; docker: DockerSnapshot | null;
  node_apps: NodeSnapshot | null;
}

/** Host status wording: tells a stopped agent apart from a machine that is down. */
export const hostStatusLabel = (h: Pick<Host, "status" | "agent_down" | "reachable">) =>
  !h.agent_down ? statusLabel[h.status] : h.reachable ? "Agent hors ligne · hôte en ligne" : h.reachable === false ? "Hors ligne · injoignable" : statusLabel[h.status];
export type ImageUpdate = "up_to_date" | "available" | "unknown" | "local" | "pinned";
export interface DockerContainer {
  id: string; name: string; image: string; state: string; health: string; started_at: string; restart_count: number;
  cpu_pct: number | null; mem_used: number | null; mem_limit: number | null; net_rx: number | null; net_tx: number | null;
  compose_project: string; compose_service: string; update: ImageUpdate;
}
export interface DockerSnapshot { containers: DockerContainer[]; error?: string; collected_at: number; running: number; updates_available: number }
/** Node.js apps of the base-node playbook (node-app), see server/nodeapps.go. */
export interface NodeOp { id: string; kind: string; commit: string; started: number; finished: number | null; result: "running" | "success" | "failed" | "rolled_back" | string }
export interface NodeApp {
  name: string; port: number; status: string; restarts: number; memory_mb: number; failed_commit: string;
  source: string; repo: string; branch: string; start_command: string; migrate_command: string;
  auto_deploy: boolean; auto_update: boolean; deployed_commit: string; deploy_key: string; managed_by_ansible: boolean; history: NodeOp[];
}
export interface NodeKey { id: string; name: string; kind: "shared" | "app" | string; type: string; comment: string; fingerprint: string; created: number }
export interface NodeSnapshot { apps: NodeApp[]; ssh_keys: NodeKey[]; ui_port: number; actions: boolean; error?: string; collected_at: number; online: number; failing: number }
export type NodeAction = "node_deploy" | "node_pull" | "node_update" | "node_restart" | "node_stop" | "node_remove" | "node_purge";
export type HostActionName = "check_updates" | "apply_updates" | "update_agent" | "update_container" | NodeAction;
export interface HostAction { action: HostActionName; target?: string; state: "pending" | "running" | "done" | "failed"; message: string; at: number }
export const actionBusy = (h: Host) => !!h.action && (h.action.state === "pending" || h.action.state === "running") && Date.now() / 1000 - h.action.at < 7200;
export interface Install { hub_url: string; key: string; token: string; command: string }

export type MonitorType = "http" | "tcp" | "udp" | "ping" | "dns" | "ssl" | "snmp" | "meross" | "truenas";
export interface MonitorConfig {
  method?: string; expected_status?: string; keyword?: string; ignore_tls?: boolean; check_ssl?: boolean; degraded_ms?: number;
  dns_server?: string; record_type?: string; expected?: string; payload?: string; warn_days?: number; failure_threshold?: number;
  min_value?: number; max_value?: number; unit?: string; oid?: string; snmp_version?: "1" | "2c" | "3";
  snmp_mode?: "" | "in" | "out" | "ifstatus"; interface?: string; max_percent?: number; idle_minutes?: number;
  /** Secrets are write-only: the API never returns them, an empty value keeps the saved one. */
  community?: string; snmp_user?: string; auth_proto?: string; auth_pass?: string; priv_proto?: string; priv_pass?: string; channel?: number; api_key?: string;
}
export interface Day { day: number; uptime: number | null; worst: Status }
export interface Monitor {
  id: number; name: string; type: MonitorType; target: string; interval_s: number; timeout_s: number;
  config: MonitorConfig; enabled: boolean; maintenance: boolean; public: boolean; status: Status;
  message: string; latency_ms: number | null; last_check: number; cert_expires_at: number | null; days?: Day[]; category: string;
}

/** Days until the monitored certificate expires, or null when not tracked. */
export function certDays(m: Monitor) {
  if (m.cert_expires_at == null || !(m.type === "ssl" || m.config.check_ssl)) return null;
  return Math.floor((m.cert_expires_at * 1000 - Date.now()) / 86400000);
}
export type MonitorInput = Pick<Monitor, "name" | "type" | "target" | "interval_s" | "timeout_s" | "config" | "enabled" | "maintenance" | "public" | "category">;

export interface Series { t: number[]; latency: (number | null)[]; value?: (number | null)[]; worst: Status[]; name?: string }
export interface Overview { status: Status; hosts: Host[]; monitors: Monitor[]; latency: Series[]; bandwidth: Bandwidth }

/** SNMP interface probes grouped by device and interface (GET /api/bandwidth), shared with the management role. */
export interface BandwidthSide {
  monitor_id: number; name: string; status: Status; message: string;
  current_mbps: number | null; avg_mbps: number | null; peak_mbps: number | null; series: (number | null)[];
  /** Traffic volume in octets: since local midnight, since the 1st of the month, per day aligned on Bandwidth.days. */
  today_octets: number; month_octets: number; daily_octets: number[];
}
export interface BandwidthLink {
  target: string; interface: string; status: Status; speed_mbps: number | null;
  in: BandwidthSide | null; out: BandwidthSide | null; state: { monitor_id: number; name: string; status: Status; message: string } | null;
}
export interface Bandwidth { range: string; t: number[]; days: number[]; links: BandwidthLink[] }
/** Takes Mbit/s (the API unit) and shows bytes per second: Go/s, Mo/s, Ko/s, o/s (SI, 1 Mo = 10⁶ octets). */
export const fmtMbps = (v: number | null | undefined) => (v == null ? "—" : `${fmtOctets(v * 125_000)}/s`);
/** Octets in SI units (To, Go, Mo, Ko), like the rates. */
export const fmtOctets = (o: number | null | undefined) =>
  o == null ? "—" : o >= 1e12 ? `${fmtNum(o / 1e12, 2)} To` : o >= 1e9 ? `${fmtNum(o / 1e9, 2)} Go` : o >= 1e6 ? `${fmtNum(o / 1e6, o < 1e7 ? 2 : 1)} Mo` : o >= 1e3 ? `${fmtNum(o / 1e3, 0)} Ko` : `${fmtNum(o, 0)} o`;
/** One interface found by SNMP discovery (POST /api/snmp/discover, GET /api/snmp/devices). */
export interface SnmpIface {
  index: number; name: string; descr: string; alias: string; status: string; up: boolean; speed_mbps: number | null;
  in_octets: number | null; out_octets: number | null; addresses: string[]; default_route: boolean;
  role: "wan" | "lan" | "vpn" | "loopback" | "system" | ""; hint: string; probes: { id: number; name: string; mode: string }[];
}
export interface SnmpDevice { target: string; sys_name: string; sys_descr: string; uptime_s: number; interfaces: SnmpIface[]; error?: string }
export type HostSeries = Record<"t" | "cpu" | "mem" | "swap" | "disk" | "net_rx" | "net_tx" | "load1" | "temp" | "cpu_temp", (number | null)[]>;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("hlm:unauthorized"));
    throw new ApiError(res.status, data.error || `Erreur ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => req<T>("GET", p),
  post: <T>(p: string, b: unknown = {}) => req<T>("POST", p, b),
  put: <T>(p: string, b: unknown) => req<T>("PUT", p, b),
  patch: <T>(p: string, b: unknown) => req<T>("PATCH", p, b),
  del: (p: string) => req<void>("DELETE", p),
};

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
export const fmtNum = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(n);
export const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${nf.format(n)} %`);
export function fmtBytes(n: number | null | undefined, perSec = false) {
  if (n == null) return "—";
  const u = ["o", "Ko", "Mo", "Go", "To", "Po"];
  let i = 0;
  while (Math.abs(n) >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${nf.format(n)} ${u[i]}${perSec ? "/s" : ""}`;
}
export const fmtMs = (n: number | null | undefined) => (n == null ? "—" : `${fmtNum(n, 0)} ms`);
export const fmtDate = (unix: number) =>
  unix ? new Date(unix * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
export function fmtAgo(unix: number) {
  if (!unix) return "jamais";
  const s = Math.max(0, Math.round(Date.now() / 1000 - unix));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}
export const pct = (used?: number, total?: number) => (used != null && total ? (used / total) * 100 : null);
