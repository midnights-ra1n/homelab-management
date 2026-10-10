import "server-only";
import type { Integration } from "../data/integrations";
import { httpJson, IntegrationError } from "./http";

/** Client Beszel (API PocketBase). */

export type BeszelSystem = {
  id: string;
  name: string;
  host: string;
  status: "up" | "down" | "paused" | "pending" | string;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  uptime: number | null;
  cores: number | null;
  threads: number | null;
  cpuModel: string;
  kernel: string;
  hostname: string;
  agentVersion: string;
  bandwidth: number | null;
  temperature: number | null;
  loadAvg: number[] | null;
  gpu: number | null;
  updated: string;
};

const tokens = new Map<number, { token: string; expires: number }>();

async function authenticate(i: Integration): Promise<string> {
  const cached = tokens.get(i.id);
  if (cached && cached.expires > Date.now()) return cached.token;
  if (!i.config.username || !i.config.password) {
    throw new IntegrationError("Identifiants Beszel manquants (e-mail + mot de passe)");
  }
  const res = await httpJson<{ token: string }>(`${i.url}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: i.config.username, password: i.config.password }),
    verifyTls: i.config.verify_tls ?? true,
  });
  tokens.set(i.id, { token: res.token, expires: Date.now() + 30 * 60_000 });
  return res.token;
}

type RawInfo = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function beszelSystems(i: Integration): Promise<BeszelSystem[]> {
  let token = await authenticate(i);
  const fetchSystems = (t: string) =>
    httpJson<{ items: { id: string; name: string; host: string; status: string; info: RawInfo; updated: string }[] }>(
      `${i.url}/api/collections/systems/records?perPage=500&sort=name`,
      { headers: { Authorization: t }, verifyTls: i.config.verify_tls ?? true },
    );
  let res;
  try {
    res = await fetchSystems(token);
  } catch (e) {
    if (e instanceof IntegrationError && e.status === 401) {
      tokens.delete(i.id);
      token = await authenticate(i);
      res = await fetchSystems(token);
    } else throw e;
  }
  return res.items.map((s) => {
    const info = s.info ?? {};
    const la = Array.isArray(info.la) ? (info.la as number[]) : num(info.l1) !== null ? [info.l1, info.l5, info.l15].map(Number) : null;
    return {
      id: s.id,
      name: s.name,
      host: s.host,
      status: s.status,
      cpu: num(info.cpu),
      mem: num(info.mp),
      disk: num(info.dp),
      uptime: num(info.u),
      cores: num(info.c),
      threads: num(info.t),
      cpuModel: str(info.m),
      kernel: str(info.k),
      hostname: str(info.h),
      agentVersion: str(info.v),
      bandwidth: num(info.b),
      temperature: num(info.dt),
      loadAvg: la,
      gpu: num(info.g),
      updated: s.updated,
    };
  });
}

export async function testBeszel(i: Integration) {
  tokens.delete(i.id);
  const systems = await beszelSystems(i);
  const up = systems.filter((s) => s.status === "up").length;
  return `${systems.length} système(s) supervisé(s), ${up} en ligne`;
}
