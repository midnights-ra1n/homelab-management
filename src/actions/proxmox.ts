"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getIntegration } from "@/lib/data/integrations";
import { parseForm, success } from "@/lib/action-utils";
import { backupSchema, guestConfigSchema, snapshotSchema, type FormState } from "@/lib/validation";
import {
  GUEST_ACTIONS,
  aptRefresh,
  backupNow,
  createSnapshot,
  guestAction,
  nodePower,
  serviceAction,
  snapshotCommand,
  updateGuestConfig,
  type ServiceAction,
  proxmoxOverview,
  proxmoxTasks,
  remoteMigrate,
  targetOptions,
  vncProxy,
  type GuestAction,
  type GuestType,
} from "@/lib/integrations/proxmox";
import { registerVncSession } from "@/lib/integrations/vnc-relay";

type Result = { ok: boolean; message: string };

function integrationOrThrow(id: number) {
  const i = getIntegration(id);
  if (!i || i.type !== "proxmox") throw new Error("Intégration Proxmox introuvable");
  return i;
}

export async function guestActionAction(
  integrationId: number,
  node: string,
  type: GuestType,
  vmid: number,
  action: GuestAction,
): Promise<Result> {
  await requireUser();
  if (!GUEST_ACTIONS.includes(action) || (type !== "qemu" && type !== "lxc")) return { ok: false, message: "Action invalide" };
  try {
    const upid = await guestAction(integrationOrThrow(integrationId), node, type, vmid, action);
    revalidatePath("/proxmox");
    return { ok: true, message: `Tâche lancée : ${upid ?? action}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function nodeTasksAction(integrationId: number, node: string) {
  await requireUser();
  try {
    return { ok: true as const, tasks: await proxmoxTasks(integrationOrThrow(integrationId), node, 20) };
  } catch (err) {
    return { ok: false as const, message: (err as Error).message };
  }
}

export async function migrationTargetsAction(integrationId: number) {
  await requireUser();
  try {
    const i = integrationOrThrow(integrationId);
    const overview = await proxmoxOverview(i);
    const node = overview.nodes.find((n) => n.status === "online")?.node;
    if (!node) return { ok: false as const, message: "Aucun nœud en ligne sur la cible" };
    return { ok: true as const, node, ...(await targetOptions(i, node)) };
  } catch (err) {
    return { ok: false as const, message: (err as Error).message };
  }
}

export async function remoteMigrateAction(opts: {
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
}): Promise<Result> {
  await requireUser();
  if (opts.sourceId === opts.targetId) return { ok: false, message: "La cible doit être un autre nœud" };
  if (!opts.targetStorage || !opts.targetBridge) return { ok: false, message: "Stockage et bridge cibles requis" };
  try {
    const upid = await remoteMigrate({
      source: integrationOrThrow(opts.sourceId),
      sourceNode: opts.sourceNode,
      type: opts.type,
      vmid: opts.vmid,
      target: integrationOrThrow(opts.targetId),
      targetStorage: opts.targetStorage,
      targetBridge: opts.targetBridge,
      targetVmid: opts.targetVmid,
      online: opts.online,
      deleteSource: opts.deleteSource,
    });
    revalidatePath("/proxmox");
    return { ok: true, message: `Migration lancée (${upid}). Suis la progression dans les tâches du nœud source.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Prépare une console noVNC : jeton à usage unique pour le relais WebSocket + mot de passe VNC. */
export async function vncSessionAction(integrationId: number, node: string, type: GuestType, vmid: number) {
  await requireUser();
  try {
    const v = await vncProxy(integrationOrThrow(integrationId), node, type, vmid);
    const token = registerVncSession({ integrationId, node, type, vmid, port: String(v.port), ticket: v.ticket });
    return { ok: true as const, token, password: v.ticket };
  } catch (err) {
    return { ok: false as const, message: (err as Error).message };
  }
}

/* --------------------------------------------------------------------------
 * Vues détaillées : nœud et invité
 * ------------------------------------------------------------------------ */

async function run(fn: () => Promise<unknown>, ok: string): Promise<Result> {
  await requireUser();
  try {
    await fn();
    revalidatePath("/", "layout");
    return { ok: true, message: ok };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function serviceActionAction(integrationId: number, node: string, service: string, action: ServiceAction) {
  return run(() => serviceAction(integrationOrThrow(integrationId), node, service, action), `${service} : ${action} lancé`);
}

export async function aptRefreshAction(integrationId: number, node: string) {
  return run(() => aptRefresh(integrationOrThrow(integrationId), node), "Actualisation des dépôts lancée (apt update)");
}

export async function nodePowerAction(integrationId: number, node: string, command: "reboot" | "shutdown") {
  return run(() => nodePower(integrationOrThrow(integrationId), node, command), command === "reboot" ? "Redémarrage du nœud demandé" : "Arrêt du nœud demandé");
}

export async function snapshotCommandAction(integrationId: number, node: string, type: GuestType, vmid: number, name: string, command: "rollback" | "delete") {
  return run(
    () => snapshotCommand(integrationOrThrow(integrationId), node, type, vmid, name, command),
    command === "rollback" ? `Retour au snapshot ${name} lancé` : `Suppression du snapshot ${name} lancée`,
  );
}

function formError(err: unknown): FormState {
  return { message: (err as Error).message };
}

export async function updateGuestConfigAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(guestConfigSchema, fd);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  const values: Record<string, string> = { [d.type === "qemu" ? "name" : "hostname"]: d.name, onboot: d.onboot ? "1" : "0" };
  const remove: string[] = [];
  if (d.cores) values.cores = String(d.cores);
  if (d.memory) values.memory = String(d.memory);
  if (d.type === "qemu" && d.sockets) values.sockets = String(d.sockets);
  if (d.type === "lxc" && d.swap !== null) values.swap = String(d.swap);
  const tags = d.tags.split(/[;,\s]+/).filter(Boolean).join(";");
  if (tags) values.tags = tags;
  else remove.push("tags");
  if (d.description) values.description = d.description;
  else remove.push("description");
  try {
    await updateGuestConfig(integrationOrThrow(d.integration_id), d.node, d.type, d.vmid, values, remove);
    revalidatePath("/", "layout");
    return success("Configuration enregistrée. Certains changements (CPU, mémoire) s'appliquent au prochain démarrage.");
  } catch (err) {
    return formError(err);
  }
}

export async function createSnapshotAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(snapshotSchema, fd);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  try {
    await createSnapshot(integrationOrThrow(d.integration_id), d.node, d.type, d.vmid, d.snapname, d.description, d.vmstate);
    revalidatePath("/", "layout");
    return success(`Snapshot ${d.snapname} en cours de création.`);
  } catch (err) {
    return formError(err);
  }
}

export async function backupNowAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(backupSchema, fd);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  try {
    await backupNow(integrationOrThrow(d.integration_id), d.node, d.vmid, d.storage, d.mode);
    revalidatePath("/", "layout");
    return success(`Sauvegarde lancée vers ${d.storage}. Suis-la dans l'onglet Tâches.`);
  } catch (err) {
    return formError(err);
  }
}
