import "server-only";
import { listIntegrations, type Integration } from "../data/integrations";
import type { IntegrationType } from "../constants";
import { hlmData, pctOf, testHlm, type HlmData } from "./hlm";
import { beszelSystems, testBeszel, type BeszelSystem } from "./beszel";
import { maintenantData, testMaintenant, type MaintenantData } from "./maintenant";
import { patchmonHosts, testPatchmon, type PatchmonHost } from "./patchmon";
import { proxmoxOverview, testProxmox, type ProxmoxOverview } from "./proxmox";
import { testWebmin, webminInstance, type WebminInstance } from "./webmin";

export type Source<T> = {
  id: number;
  name: string;
  url: string;
  ok: boolean;
  error?: string;
  data?: T;
};

async function collect<T>(type: IntegrationType, fetcher: (i: Integration) => Promise<T>): Promise<Source<T>[]> {
  const integrations = listIntegrations(type, true);
  const results = await Promise.allSettled(integrations.map(fetcher));
  return integrations.map((i, idx) => {
    const r = results[idx];
    return r.status === "fulfilled"
      ? { id: i.id, name: i.name, url: i.url, ok: true, data: r.value }
      : { id: i.id, name: i.name, url: i.url, ok: false, error: (r.reason as Error)?.message ?? "Erreur inconnue" };
  });
}

export const fetchBeszel = () => collect<BeszelSystem[]>("beszel", beszelSystems);
export const fetchMaintenant = () => collect<MaintenantData>("maintenant", maintenantData);
export const fetchPatchmon = () => collect<PatchmonHost[]>("patchmon", patchmonHosts);
export const fetchProxmox = () => collect<ProxmoxOverview>("proxmox", proxmoxOverview);
export const fetchWebmin = () => collect<WebminInstance>("webmin", webminInstance);
export const fetchHlm = () => collect<HlmData>("hlm", hlmData);

/** Clés de rapprochement d'une machine entre sources (nom, FQDN, nom court), en minuscules. */
export function machineKeys(...values: (string | null | undefined)[]) {
  return values.flatMap((v) => {
    const k = (v ?? "").trim().toLowerCase();
    return k ? [k, k.split(".")[0]] : [];
  });
}

export async function testIntegration(i: Integration): Promise<string> {
  switch (i.type) {
    case "proxmox":
      return testProxmox(i);
    case "beszel":
      return testBeszel(i);
    case "maintenant":
      return testMaintenant(i);
    case "patchmon":
      return testPatchmon(i);
    case "webmin":
      return testWebmin(i);
    case "hlm":
      return testHlm(i);
  }
}

/** Synthèse monitoring pour le tableau de bord. */
export async function monitoringSummary() {
  const [beszel, maintenant, patchmon, hlm] = await Promise.all([fetchBeszel(), fetchMaintenant(), fetchPatchmon(), fetchHlm()]);
  // Une machine suivie à la fois par Homelab Monitoring et Beszel n'est comptée (et alertée) qu'une fois.
  const hlmHosts = hlm.flatMap((s) => s.data?.hosts ?? []);
  const covered = new Set(hlmHosts.flatMap((h) => machineKeys(h.name, h.info?.hostname)));
  const systems = [
    ...hlmHosts.map((h) => ({
      name: h.name,
      source: "Homelab Monitoring",
      status: h.status === "major_outage" ? "down" : h.status === "unknown" ? "pending" : "up",
      cpu: h.latest?.cpu ?? null,
      mem: pctOf(h.latest?.mem_used, h.latest?.mem_total),
      disk: pctOf(h.latest?.disk_used, h.latest?.disk_total),
    })),
    ...beszel
      .flatMap((s) => s.data ?? [])
      .filter((s) => !machineKeys(s.name, s.host, s.hostname).some((k) => covered.has(k)))
      .map((s) => ({ name: s.name, source: "Beszel", status: s.status, cpu: s.cpu, mem: s.mem, disk: s.disk })),
  ];
  const probes = hlm.flatMap((s) => s.data?.monitors ?? []).filter((m) => m.enabled);
  const containers = maintenant.flatMap((s) => s.data?.containers ?? []);
  const endpoints = maintenant.flatMap((s) => s.data?.endpoints ?? []);
  const certificates = maintenant.flatMap((s) => s.data?.certificates ?? []);
  const hosts = patchmon.flatMap((s) => s.data ?? []);
  const soon = Date.now() + 21 * 86_400_000;
  return {
    configured: beszel.length + maintenant.length + patchmon.length + hlm.length,
    errors: [...beszel, ...maintenant, ...patchmon, ...hlm].filter((s) => !s.ok).map((s) => ({ name: s.name, error: s.error! })),
    systems: {
      total: systems.length,
      up: systems.filter((s) => s.status === "up").length,
      down: systems.filter((s) => s.status === "down"),
      hot: systems.filter((s) => (s.cpu ?? 0) > 85 || (s.mem ?? 0) > 90 || (s.disk ?? 0) > 90),
    },
    containers: {
      total: containers.length,
      running: containers.filter((c) => c.state === "running").length,
      unhealthy: containers.filter((c) => c.health === "unhealthy" || (c.state !== "running" && c.state !== "exited")),
    },
    endpoints: {
      total: endpoints.length,
      up: endpoints.filter((e) => e.status === "up").length,
      down: endpoints.filter((e) => e.status === "down" || e.status === "degraded"),
    },
    probes: {
      total: probes.length,
      down: probes.filter((m) => m.status === "major_outage" || m.status === "minor_outage"),
    },
    certificates: {
      expiring: certificates.filter((c) => c.expiresAt && new Date(c.expiresAt).getTime() < soon),
    },
    patches: {
      hosts: hosts.length + hlmHosts.filter((h) => h.updates).length,
      updates: hosts.reduce((n, h) => n + h.updates, 0) + hlmHosts.reduce((n, h) => n + (h.updates?.pending ?? 0), 0),
      security: hosts.reduce((n, h) => n + h.securityUpdates, 0) + hlmHosts.reduce((n, h) => n + (h.updates?.security ?? 0), 0),
      reboot: [
        ...hosts.filter((h) => h.needsReboot).map((h) => h.friendlyName),
        ...hlmHosts.filter((h) => h.updates?.reboot_required).map((h) => h.name),
      ],
    },
  };
}
