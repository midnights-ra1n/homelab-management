import { act, api, postForm } from "../lib/client";
import type { GuestAction, GuestType, PveTask, ServiceAction } from "../lib/integrations/proxmox";
import type { FormState } from "../lib/validation";

type Result = { ok: boolean; message: string };
const guest = (id: number, node: string, type: GuestType, vmid: number) =>
  `/api/mg/proxmox/${id}/guest/${encodeURIComponent(node)}/${type}/${vmid}`;
const nodeURL = (id: number, node: string) => `/api/mg/proxmox/${id}/node/${encodeURIComponent(node)}`;

export const guestActionAction = (integrationId: number, node: string, type: GuestType, vmid: number, action: GuestAction): Promise<Result> =>
  act("POST", `${guest(integrationId, node, type, vmid)}/action`, { action });

export async function nodeTasksAction(integrationId: number, node: string) {
  const r = await api.get<{ ok: boolean; data?: PveTask[]; error?: string }>(`${nodeURL(integrationId, node)}/tasks`);
  return r.ok ? { ok: true as const, tasks: (r.data ?? []).slice(0, 20) } : { ok: false as const, message: r.error ?? "Erreur" };
}

export async function migrationTargetsAction(integrationId: number) {
  return api.get<
    | { ok: true; node: string; storages: { storage: string; content: string; avail: number | null }[]; bridges: string[] }
    | { ok: false; message: string }
  >(`/api/mg/proxmox/${integrationId}/targets`);
}

export const remoteMigrateAction = (opts: {
  sourceId: number;
  sourceNode: string;
  type: GuestType;
  vmid: number;
  targetId: number;
  targetStorage: string;
  targetBridge: string;
  targetVmid: number | null;
  online: boolean;
  deleteSource: boolean;
}): Promise<Result> => act("POST", "/api/mg/proxmox/migrate", opts);

export async function vncSessionAction(integrationId: number, node: string, type: GuestType, vmid: number) {
  return api.post<{ ok: true; token: string; password: string } | { ok: false; message: string }>(`${guest(integrationId, node, type, vmid)}/vnc`);
}

export const serviceActionAction = (integrationId: number, node: string, service: string, action: ServiceAction) =>
  act("POST", `${nodeURL(integrationId, node)}/service/${encodeURIComponent(service)}/${action}`);
export const aptRefreshAction = (integrationId: number, node: string) => act("POST", `${nodeURL(integrationId, node)}/apt-refresh`);
export const nodePowerAction = (integrationId: number, node: string, command: "reboot" | "shutdown") =>
  act("POST", `${nodeURL(integrationId, node)}/power`, { command });
export const snapshotCommandAction = (integrationId: number, node: string, type: GuestType, vmid: number, name: string, command: "rollback" | "delete") =>
  act("POST", `${guest(integrationId, node, type, vmid)}/snapshot/${encodeURIComponent(name)}/${command}`);

/** The guest forms carry integration_id, node, type and vmid as hidden fields. */
const guestOf = (fd: FormData) =>
  guest(Number(fd.get("integration_id")), String(fd.get("node")), String(fd.get("type")) as GuestType, Number(fd.get("vmid")));
export const updateGuestConfigAction = (_: FormState, fd: FormData) => postForm(`${guestOf(fd)}/config`, fd);
export const createSnapshotAction = (_: FormState, fd: FormData) => postForm(`${guestOf(fd)}/snapshot`, fd);
export const backupNowAction = (_: FormState, fd: FormData) => postForm(`${guestOf(fd)}/backup`, fd);
