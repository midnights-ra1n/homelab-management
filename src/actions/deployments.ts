"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { dbError, parseForm } from "@/lib/action-utils";
import { DEPLOYMENT_STATUSES, type DeploymentStatus } from "@/lib/constants";
import {
  addStep,
  createDeployment,
  deleteDeployment,
  deleteStep,
  getDeployment,
  setDeploymentStatus,
  toggleStep,
  updateDeployment,
} from "@/lib/data/deployments";
import { createAsset } from "@/lib/data/assets";
import { run } from "@/lib/db";
import { assetSchema, deploymentSchema, type FormState } from "@/lib/validation";
import { findSubnetFor } from "@/lib/data/network";

export async function saveDeploymentAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(deploymentSchema, fd);
  if (!parsed.ok) return parsed.state;
  let deploymentId = id;
  try {
    if (id) updateDeployment(id, parsed.data);
    else deploymentId = createDeployment(parsed.data);
  } catch (err) {
    return dbError(err);
  }
  revalidatePath("/", "layout");
  redirect(`/deploiements/${deploymentId}`);
}

export async function setDeploymentStatusAction(id: number, status: DeploymentStatus) {
  await requireUser();
  if (!DEPLOYMENT_STATUSES.includes(status)) return;
  setDeploymentStatus(id, status);
  revalidatePath("/", "layout");
}

export async function toggleStepAction(stepId: number) {
  await requireUser();
  toggleStep(stepId);
  revalidatePath("/", "layout");
}

export async function addStepAction(deploymentId: number, label: string) {
  await requireUser();
  const clean = label.trim().slice(0, 300);
  if (clean) addStep(deploymentId, clean);
  revalidatePath("/", "layout");
}

export async function deleteStepAction(stepId: number) {
  await requireUser();
  deleteStep(stepId);
  revalidatePath("/", "layout");
}

export async function deleteDeploymentAction(id: number) {
  await requireUser();
  deleteDeployment(id);
  revalidatePath("/", "layout");
  redirect("/deploiements");
}

/** Crée l'élément d'inventaire correspondant à un déploiement terminé et les relie. */
export async function promoteDeploymentAction(id: number) {
  await requireUser();
  const d = getDeployment(id);
  if (!d || d.asset_id) return;
  const kind = d.kind === "application" ? "docker" : d.kind;
  const input = assetSchema.parse({
    kind,
    display_name: d.title.slice(0, 120),
    hostname: d.title.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-|-$/g, ""),
    status: d.status === "done" ? "online" : "planned",
    tags: d.tags.join(","),
    parent_id: d.target_host_id ?? "",
    cpu_cores: d.planned_cpu ?? "",
    proxmox_vmid: d.vmid && d.vmid >= 100 && (kind === "vm" || kind === "lxc") ? d.vmid : "",
    notes: d.apps ? `Conteneurs / apps : ${d.apps}` : "",
    ram_gb: d.planned_ram_gb ?? "",
    disks: d.planned_disk_gb
      ? JSON.stringify([{ name: "disk0", type: "virtual", capacity_gb: d.planned_disk_gb, usage: "" }])
      : "[]",
    primary_ip: d.planned_ip,
    primary_subnet_id: d.subnet_id ?? (d.planned_ip ? findSubnetFor(d.planned_ip) ?? "" : ""),
    description: d.description,
  });
  let assetId: number;
  try {
    assetId = createAsset(input);
  } catch {
    // IP déjà prise : on crée sans IP
    assetId = createAsset({ ...input, primary_ip: "", primary_subnet_id: null });
  }
  run("UPDATE deployments SET asset_id = ?, updated_at = datetime('now') WHERE id = ?", [assetId, id]);
  revalidatePath("/", "layout");
  redirect(`/inventaire/${assetId}`);
}
