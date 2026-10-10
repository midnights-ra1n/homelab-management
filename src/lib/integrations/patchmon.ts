import "server-only";
import type { Integration } from "../data/integrations";
import { httpJson, IntegrationError } from "./http";

/** Client PatchMon (Integration API, identifiants à portée « host:get », auth Basic). */

export type PatchmonHost = {
  id: string;
  friendlyName: string;
  hostname: string;
  ip: string;
  groups: string[];
  osType: string;
  osVersion: string;
  lastUpdate: string | null;
  status: string;
  needsReboot: boolean;
  updates: number;
  securityUpdates: number;
  totalPackages: number | null;
};

type RawHost = {
  id: string;
  friendly_name: string;
  hostname: string;
  ip: string;
  host_groups?: { id: string; name: string }[];
  os_type?: string;
  os_version?: string;
  last_update?: string;
  status?: string;
  effective_status?: string;
  needs_reboot?: boolean;
  updates_count?: number;
  security_updates_count?: number;
  total_packages?: number;
};

export async function patchmonHosts(i: Integration): Promise<PatchmonHost[]> {
  const key = i.config.token_id || i.config.username;
  const secret = i.config.token_secret || i.config.password;
  if (!key || !secret) throw new IntegrationError("Identifiants d'API PatchMon manquants (clé + secret)");
  const res = await httpJson<{ hosts: RawHost[] }>(`${i.url}/api/v1/api/hosts?include=stats`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
    verifyTls: i.config.verify_tls ?? true,
  });
  return (res.hosts ?? []).map((h) => ({
    id: h.id,
    friendlyName: h.friendly_name,
    hostname: h.hostname,
    ip: h.ip,
    groups: (h.host_groups ?? []).map((g) => g.name),
    osType: h.os_type ?? "",
    osVersion: h.os_version ?? "",
    lastUpdate: h.last_update ?? null,
    status: h.effective_status ?? h.status ?? "unknown",
    needsReboot: !!h.needs_reboot,
    updates: h.updates_count ?? 0,
    securityUpdates: h.security_updates_count ?? 0,
    totalPackages: h.total_packages ?? null,
  }));
}

export async function testPatchmon(i: Integration) {
  const hosts = await patchmonHosts(i);
  const pending = hosts.reduce((n, h) => n + h.updates, 0);
  return `${hosts.length} hôte(s), ${pending} mise(s) à jour en attente`;
}
