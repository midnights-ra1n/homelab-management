/* Integrations seen from the browser: each source is one integration's result (an error does not hide the others). */
import { get } from "../client";
import { resource } from "../resource";
import { pctOf, type HlmData } from "./hlm";
import type { ProxmoxOverview } from "./proxmox";
import type { WebminInstance } from "./webmin";

export type Source<T> = { id: number; name: string; url: string; ok: boolean; error?: string; data?: T };

export const fetchProxmox = () => get<Source<ProxmoxOverview>[]>("/api/mg/proxmox");
export const fetchWebmin = () => get<Source<WebminInstance>[]>("/api/mg/webmin");
export const fetchHlm = () => get<Source<HlmData>[]>("/api/mg/monitoring");

/** Keys matching one machine across sources (name, FQDN, short name), lower case. */
export function machineKeys(...values: (string | null | undefined)[]) {
  return values.flatMap((v) => {
    const k = (v ?? "").trim().toLowerCase();
    return k ? [k, k.split(".")[0]] : [];
  });
}

/** Monitoring summary of the dashboard, from the Midnights Monitoring integrations. */
export const monitoringSummary = () => resource("monitoring-summary", async () => summarize(await fetchHlm()));

export function summarize(hlm: Source<HlmData>[]) {
    const hosts = hlm.flatMap((s) => s.data?.hosts ?? []);
    const systems = hosts.map((h) => ({
      name: h.name,
      source: "Midnights Monitoring",
      status: h.status === "major_outage" ? "down" : h.status === "unknown" ? "pending" : "up",
      cpu: h.latest?.cpu ?? null,
      mem: pctOf(h.latest?.mem_used, h.latest?.mem_total),
      disk: pctOf(h.latest?.disk_used, h.latest?.disk_total),
    }));
    const probes = hlm.flatMap((s) => s.data?.monitors ?? []).filter((m) => m.enabled);
    const soon = Date.now() + 21 * 86_400_000;
    return {
      configured: hlm.length,
      /** Hosts and enabled probes followed: 0 means there is nothing to report on, not that all is well. */
      monitored: systems.length + probes.length,
      bandwidth: hlm.flatMap((s) => (s.data?.bandwidth?.links ?? []).map((l) => ({ ...l, t: s.data!.bandwidth!.t, source: s.name, url: s.url }))),
      errors: hlm.filter((s) => !s.ok).map((s) => ({ name: s.name, error: s.error! })),
      systems: {
        total: systems.length,
        up: systems.filter((s) => s.status === "up").length,
        down: systems.filter((s) => s.status === "down"),
        hot: systems.filter((s) => (s.cpu ?? 0) > 85 || (s.mem ?? 0) > 90 || (s.disk ?? 0) > 90),
      },
      probes: {
        total: probes.length,
        down: probes.filter((m) => m.status === "major_outage" || m.status === "minor_outage"),
      },
      certificates: {
        expiring: probes
          .filter((m) => m.cert_expires_at && m.cert_expires_at * 1000 < soon)
          .map((m) => ({ name: m.name, expiresAt: new Date(m.cert_expires_at! * 1000).toISOString() })),
      },
      patches: {
        hosts: hosts.filter((h) => h.updates).length,
        updates: hosts.reduce((n, h) => n + (h.updates?.pending ?? 0), 0),
        security: hosts.reduce((n, h) => n + (h.updates?.security ?? 0), 0),
        reboot: hosts.filter((h) => h.updates?.reboot_required).map((h) => h.name),
      },
    };
}
