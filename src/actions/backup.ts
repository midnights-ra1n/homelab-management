"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { importBackup, type Backup } from "@/lib/data/backup";
import type { FormState } from "@/lib/validation";

export async function importBackupAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { errors: { file: "Choisis un fichier .json" } };
  if (fd.get("confirm") !== "on") return { message: "Coche la confirmation pour remplacer les données." };
  try {
    importBackup(JSON.parse(await file.text()) as Backup);
  } catch (err) {
    return { message: `Import impossible : ${(err as Error).message}` };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Sauvegarde restaurée.", nonce: Date.now() };
}
