"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { dbError, parseForm } from "@/lib/action-utils";
import type { AssetStatus } from "@/lib/constants";
import {
  AssetError,
  createAsset,
  deleteAsset,
  duplicateAsset,
  setAssetStatus,
  updateAsset,
} from "@/lib/data/assets";
import { findSubnetFor } from "@/lib/data/network";
import { get } from "@/lib/db";
import { checkIp } from "@/lib/net/engine";
import { loadSnapshot } from "@/lib/net/snapshot";
import { assetSchema, type FormState } from "@/lib/validation";

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
  redirect(`/inventaire/${assetId}`);
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
