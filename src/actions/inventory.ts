"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { dbError, parseForm, success } from "@/lib/action-utils";
import { z } from "zod";
import { ASSET_STATUSES, type AssetStatus } from "@/lib/constants";
import {
  AssetError,
  bulkUpdateAssets,
  createAsset,
  deleteAsset,
  duplicateAsset,
  listAssets,
  setAssetStatus,
  updateAsset,
} from "@/lib/data/assets";
import { findSubnetFor } from "@/lib/data/network";
import { get } from "@/lib/db";
import { checkIp } from "@/lib/net/engine";
import { loadSnapshot } from "@/lib/net/snapshot";
import { assetSchema, type FormState } from "@/lib/validation";
import { getRequestT } from "@/i18n/server";

export async function saveAssetAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(assetSchema, fd);
  if (!parsed.ok) return parsed.state;
  const input = parsed.data;
  if (input.primary_ip && !input.primary_subnet_id) input.primary_subnet_id = findSubnetFor(input.primary_ip);
  if (input.primary_ip) {
    const current = id ? get<{ id: number }>("SELECT id FROM ip_addresses WHERE asset_id = ? AND is_primary = 1", [id]) : undefined;
    const blocking = checkIp(loadSnapshot(), input.primary_ip, {
      subnetId: input.primary_subnet_id,
      assetId: id,
      ipId: current?.id ?? null,
    }).find((i) => i.level === "error");
    if (blocking) return { errors: { primary_ip: blocking.message }, message: blocking.message };
  }
  let assetId = id;
  try {
    if (id) updateAsset(id, input);
    else assetId = createAsset(input);
  } catch (err) {
    if (err instanceof AssetError) return { errors: { [err.field]: err.message }, message: err.message };
    return dbError(err, "primary_ip", "Cette adresse IP est déjà utilisée");
  }
  revalidatePath("/", "layout");
  // Ajout rapide (modale de la liste) : on reste sur place.
  if (fd.get("_stay")) return success(`« ${input.display_name} » a été ajouté à l'inventaire.`);
  redirect(`/inventaire/${assetId}`);
}

const bulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  action: z.discriminatedUnion("op", [
    z.object({ op: z.literal("status"), status: z.enum(ASSET_STATUSES) }),
    z.object({ op: z.literal("tag"), tag: z.string().trim().toLowerCase().min(1).max(40) }),
    z.object({ op: z.literal("parent"), parentId: z.number().int().positive().nullable() }),
    z.object({ op: z.literal("delete") }),
  ]),
});

/** Actions groupées de la liste d'inventaire. */
export async function bulkAssetAction(ids: number[], action: unknown): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const parsed = bulkSchema.safeParse({ ids, action });
  if (!parsed.success) return { ok: false, message: (await getRequestT())("Action invalide.") };
  try {
    const n = bulkUpdateAssets(parsed.data.ids, parsed.data.action);
    revalidatePath("/", "layout");
    const tr = await getRequestT();
    return { ok: true, message: tr(parsed.data.action.op === "delete" ? "{n} élément(s) supprimé(s)." : "{n} élément(s) modifié(s).", { n }) };
  } catch (err) {
    if (err instanceof AssetError) return { ok: false, message: (await getRequestT())(err.message) };
    throw err;
  }
}

/** Recherche globale (⌘K) : nom, hostname, IP, MAC, n° de série, tags. */
export async function searchAssetsAction(q: string) {
  await requireUser();
  const query = String(q ?? "").trim().slice(0, 100);
  if (!query) return [];
  return listAssets({ q: query })
    .slice(0, 12)
    .map((a) => ({ id: a.id, kind: a.kind, name: a.display_name, hostname: a.hostname, ip: a.primary_ip, status: a.status }));
}

export async function deleteAssetAction(id: number) {
  await requireUser();
  deleteAsset(id);
  revalidatePath("/", "layout");
  redirect("/inventaire");
}

export async function duplicateAssetAction(id: number) {
  await requireUser();
  const newId = duplicateAsset(id);
  revalidatePath("/", "layout");
  if (newId) redirect(`/inventaire/${newId}/modifier`);
}

export async function setAssetStatusAction(id: number, status: AssetStatus) {
  await requireUser();
  setAssetStatus(id, status);
  revalidatePath("/", "layout");
}
