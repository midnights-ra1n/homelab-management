import "server-only";
import type { Integration } from "../data/integrations";
import { httpJson, IntegrationError } from "./http";

/** Client Homelab Monitoring (API REST /api/v1, jeton Bearer « hlm_… », scopes hosts:read + monitors:read). */

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

/** Libellé court du type de sonde (HTTPS distingué de HTTP par la cible). */
export const probeKind = (m: Pick<HlmMonitor, "type" | "target">) =>
  m.type === "http" && /^https:/i.test(m.target) ? "HTTPS" : m.type.toUpperCase();

export type HlmData = { hosts: HlmHost[]; monitors: HlmMonitor[] };

const get = <T>(i: Integration, path: string) => {
  if (!i.config.token_secret) throw new IntegrationError("Jeton d'API Homelab Monitoring manquant (hlm_…)");
  return httpJson<T>(`${i.url}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${i.config.token_secret}` },
    verifyTls: i.config.verify_tls ?? true,
  });
};

export async function hlmData(i: Integration): Promise<HlmData> {
  const [hosts, monitors] = await Promise.all([
    get<HlmHost[]>(i, "/hosts"),
    // Scope monitors:read facultatif : un jeton limité aux hôtes reste utilisable.
    get<HlmMonitor[]>(i, "/monitors").catch((e) => {
      if (e instanceof IntegrationError && e.status === 403) return [];
      throw e;
    }),
  ]);
  return { hosts, monitors };
}

export const pctOf = (used?: number, total?: number) => (used != null && total ? (used / total) * 100 : null);

export async function testHlm(i: Integration) {
  const { hosts, monitors } = await hlmData(i);
  const up = hosts.filter((h) => h.status === "operational").length;
  return `${hosts.length} hôte(s) dont ${up} opérationnel(s), ${monitors.length} sonde(s)`;
}
