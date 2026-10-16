
export type HlmStatus = "operational" | "maintenance" | "degraded" | "minor_outage" | "major_outage" | "unknown";

export type HlmHost = {
  id: number;
  name: string;
  status: HlmStatus;
  last_seen: number;
  maintenance: boolean;
  connected: boolean;
  info?: { hostname?: string; os?: string; kernel?: string; cpu_model?: string; cpu_cores?: number; boot_time?: number } | null;
  latest?: {
    cpu?: number;
    mem_used?: number;
    mem_total?: number;
    disk_used?: number;
    disk_total?: number;
    temp?: number | null;
  } | null;
  updates?: { pending: number; security: number; reboot_required: boolean } | null;
};

export type HlmMonitor = {
  id: number;
  name: string;
  type: "http" | "tcp" | "dns" | "ssl" | string;
  target: string;
  interval_s: number;
  config?: { method?: string; expected_status?: string; keyword?: string; record_type?: string; dns_server?: string; expected?: string; check_ssl?: boolean } | null;
  enabled: boolean;
  maintenance: boolean;
  status: HlmStatus;
  message: string;
  latency_ms: number | null;
  last_check: number; // millisecondes
  cert_expires_at: number | null; // secondes
  days?: { day: number; uptime: number | null; worst: HlmStatus }[]; // 90 jours, minuit UTC, uptime 0–1
};

export type HlmData = { hosts: HlmHost[]; monitors: HlmMonitor[] };

/** Libellé court du type de sonde (HTTPS distingué de HTTP par la cible). */
export const probeKind = (m: Pick<HlmMonitor, "type" | "target">) =>
  m.type === "http" && /^https:/i.test(m.target) ? "HTTPS" : m.type.toUpperCase();


export const pctOf = (used?: number, total?: number) => (used != null && total ? (used / total) * 100 : null);
