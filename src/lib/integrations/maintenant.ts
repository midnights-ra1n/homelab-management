import "server-only";
import type { Integration } from "../data/integrations";
import { httpJson, parseHeader } from "./http";

/**
 * Client Maintenant (API REST /api/v1). L'outil n'a pas d'authentification native :
 * un en-tête optionnel permet de passer un reverse proxy (Basic, Bearer, Authelia…).
 */

export type MaintenantContainer = {
  id: string | number;
  name: string;
  image: string;
  state: string;
  health: string | null;
  group: string;
  host: string;
  updateAvailable?: boolean;
};

export type MaintenantEndpoint = {
  id: string | number;
  name: string;
  type: string;
  target: string;
  status: "up" | "down" | "degraded" | "unknown" | string;
};

export type MaintenantCertificate = { id: string | number; name: string; expiresAt: string | null; status: string };

export type MaintenantHeartbeat = { id: string | number; name: string; status: string; lastPing: string | null };

export type MaintenantData = {
  containers: MaintenantContainer[];
  endpoints: MaintenantEndpoint[];
  certificates: MaintenantCertificate[];
  heartbeats: MaintenantHeartbeat[];
  updates: number | null;
};

type Obj = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const arr = (v: unknown, ...keys: string[]): Obj[] => {
  if (Array.isArray(v)) return v as Obj[];
  if (v && typeof v === "object") {
    for (const k of keys) if (Array.isArray((v as Obj)[k])) return (v as Obj)[k] as Obj[];
  }
  return [];
};

function get<T>(i: Integration, path: string) {
  return httpJson<T>(`${i.url}/api/v1${path}`, {
    headers: parseHeader(i.config.auth_header),
    verifyTls: i.config.verify_tls ?? true,
  });
}

export async function maintenantData(i: Integration): Promise<MaintenantData> {
  const [containers, endpoints, certificates, heartbeats, updates] = await Promise.allSettled([
    get<Obj>(i, "/containers"),
    get<Obj>(i, "/endpoints"),
    get<Obj>(i, "/certificates"),
    get<Obj>(i, "/heartbeats"),
    get<Obj>(i, "/updates/summary"),
  ]);
  if (containers.status === "rejected" && endpoints.status === "rejected") throw containers.reason;

  const containerList: MaintenantContainer[] = [];
  if (containers.status === "fulfilled") {
    const groups = arr(containers.value, "groups");
    const flat = groups.length && groups[0].containers ? groups : [{ name: "", containers: arr(containers.value, "containers") }];
    for (const g of flat) {
      for (const c of arr(g.containers)) {
        if (c.archived || c.is_ignored) continue;
        containerList.push({
          id: (c.id as string) ?? s(c.external_id),
          name: s(c.name),
          image: s(c.image),
          state: s(c.state) || "unknown",
          health: c.health_status ? s(c.health_status) : null,
          group: s(g.name),
          host: s(c.agent_hostname ?? c.agent_label),
        });
      }
    }
  }

  const endpointList: MaintenantEndpoint[] =
    endpoints.status === "fulfilled"
      ? arr(endpoints.value, "endpoints").map((e) => ({
          id: e.id as string,
          name: s(e.name) || s(e.target),
          type: s(e.endpoint_type),
          target: s(e.target),
          status: s(e.status) || "unknown",
        }))
      : [];

  const certificateList: MaintenantCertificate[] =
    certificates.status === "fulfilled"
      ? arr(certificates.value, "certificates", "items").map((c) => ({
          id: c.id as string,
          name: s(c.hostname ?? c.name ?? c.host ?? c.target),
          expiresAt: (c.not_after ?? c.expires_at ?? c.expiry ?? c.valid_until ?? null) as string | null,
          status: s(c.status),
        }))
      : [];

  const heartbeatList: MaintenantHeartbeat[] =
    heartbeats.status === "fulfilled"
      ? arr(heartbeats.value, "heartbeats", "items").map((h) => ({
          id: h.id as string,
          name: s(h.name),
          status: s(h.status) || "unknown",
          lastPing: (h.last_ping_at ?? h.last_ping ?? null) as string | null,
        }))
      : [];

  let updateCount: number | null = null;
  if (updates.status === "fulfilled" && updates.value) {
    const u = updates.value;
    const candidate = u.total ?? u.available ?? u.updates_available ?? u.count ?? u.pending;
    if (typeof candidate === "number") updateCount = candidate;
  }

  return {
    containers: containerList,
    endpoints: endpointList,
    certificates: certificateList,
    heartbeats: heartbeatList,
    updates: updateCount,
  };
}

export async function testMaintenant(i: Integration) {
  const d = await maintenantData(i);
  return `${d.containers.length} conteneur(s), ${d.endpoints.length} endpoint(s), ${d.certificates.length} certificat(s)`;
}
