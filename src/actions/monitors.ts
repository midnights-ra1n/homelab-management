"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { dbError, parseForm, success } from "@/lib/action-utils";
import {
  createMonitor,
  deleteMonitor,
  getMonitor,
  importFromShortcuts,
  setMonitorEnabled,
  updateMonitor,
} from "@/lib/data/monitors";
import { runNow } from "@/lib/monitor/poller";
import { monitorSchema, type FormState } from "@/lib/validation";

function refresh() {
  revalidatePath("/monitoring", "layout");
  revalidatePath("/");
}

export async function saveMonitorAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(monitorSchema, fd);
  if (!parsed.ok) return parsed.state;
  try {
    if (id) updateMonitor(id, parsed.data);
    else {
      const newId = createMonitor(parsed.data);
      const m = getMonitor(newId);
      if (m) await runNow(m); // premier point immédiat
    }
  } catch (err) {
    return dbError(err);
  }
  refresh();
  return success(id ? "Sonde mise à jour." : "Sonde ajoutée : premier contrôle effectué.");
}

export async function deleteMonitorAction(id: number) {
  await requireUser();
  deleteMonitor(id);
  refresh();
  redirect("/monitoring");
}

export async function toggleMonitorAction(id: number, enabled: boolean) {
  await requireUser();
  setMonitorEnabled(id, enabled);
  refresh();
}

export async function runMonitorNowAction(id: number): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const m = getMonitor(id);
  if (!m) return { ok: false, message: "Sonde introuvable" };
  await runNow(m);
  refresh();
  return { ok: true, message: `Contrôle de « ${m.name} » effectué` };
}

export async function importMonitorsAction(): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const n = importFromShortcuts();
  refresh();
  return { ok: true, message: n ? `${n} sonde(s) créée(s) depuis les applications` : "Toutes les applications ont déjà une sonde" };
}
