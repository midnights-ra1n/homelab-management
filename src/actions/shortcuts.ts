"use server";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { dbError, parseForm, success } from "@/lib/action-utils";
import { UPLOADS_DIR } from "@/lib/db";
import {
  addUploadedIcon,
  createGroup,
  createShortcut,
  deleteGroup,
  deleteShortcut,
  deleteUploadedIcon,
  listUploadedIcons,
  moveGroup,
  renameGroup,
  reorderShortcuts,
  updateShortcut,
  type UploadedIcon,
} from "@/lib/data/shortcuts";
import { probeUrl } from "@/lib/integrations/http";
import { searchIcons } from "@/lib/icon-index";
import { groupSchema, shortcutSchema, type FormState } from "@/lib/validation";

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveShortcutAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(shortcutSchema, fd);
  if (!parsed.ok) return parsed.state;
  try {
    if (id) updateShortcut(id, parsed.data);
    else createShortcut(parsed.data);
  } catch (err) {
    return dbError(err);
  }
  refresh();
  return success(id ? "Raccourci mis à jour." : "Raccourci ajouté.");
}

export async function deleteShortcutAction(id: number) {
  await requireUser();
  deleteShortcut(id);
  refresh();
}

export async function reorderShortcutsAction(groupId: number | null, ids: number[]) {
  await requireUser();
  reorderShortcuts(groupId, ids.filter((n) => Number.isInteger(n)));
  refresh();
}

export async function saveGroupAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(groupSchema, fd);
  if (!parsed.ok) return parsed.state;
  if (id) renameGroup(id, parsed.data.name);
  else createGroup(parsed.data.name);
  refresh();
  return success(id ? "Groupe renommé." : "Groupe créé.");
}

export async function deleteGroupAction(id: number) {
  await requireUser();
  deleteGroup(id);
  refresh();
}

export async function moveGroupAction(id: number, direction: -1 | 1) {
  await requireUser();
  moveGroup(id, direction);
  refresh();
}

/** Vérifie la disponibilité des raccourcis (appelé depuis le client). */
export async function probeShortcutsAction(urls: string[]) {
  await requireUser();
  const unique = [...new Set(urls)].filter((u) => /^https?:\/\//i.test(u)).slice(0, 100);
  const results = await Promise.all(unique.map(async (u) => [u, await probeUrl(u)] as const));
  return Object.fromEntries(results);
}

export async function searchIconsAction(query: string, provider?: "dashboard" | "selfhst") {
  await requireUser();
  return searchIcons(query, provider);
}

/* Téléversement d'icônes ---------------------------------------------------- */

const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/gif": "gif",
};
const MAX_SIZE = 1024 * 1024;

export async function uploadIconAction(
  _: FormState & { icon?: UploadedIcon },
  fd: FormData,
): Promise<FormState & { icon?: UploadedIcon }> {
  await requireUser();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { errors: { file: "Choisis un fichier" } };
  const ext = ALLOWED[file.type];
  if (!ext) return { errors: { file: "Format non pris en charge (PNG, SVG, WebP, JPG, ICO, GIF)" } };
  if (file.size > MAX_SIZE) return { errors: { file: "1 Mo maximum" } };
  const buffer = Buffer.from(await file.arrayBuffer());
  if (ext === "svg" && /<script|on\w+\s*=|javascript:/i.test(buffer.toString("utf8"))) {
    return { errors: { file: "SVG refusé : contient du script" } };
  }
  const filename = `${crypto.randomBytes(8).toString("hex")}.${ext}`;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ UPLOADS_DIR, filename), buffer);
  const label = String(fd.get("label") || file.name.replace(/\.[^.]+$/, "")).slice(0, 80);
  addUploadedIcon(filename, label, file.type, file.size);
  refresh();
  return { ...success("Icône téléversée."), icon: listUploadedIcons().find((i) => i.filename === filename) };
}

export async function deleteUploadedIconAction(id: number) {
  await requireUser();
  const icon = deleteUploadedIcon(id);
  if (icon) await fs.rm(path.join(/*turbopackIgnore: true*/ UPLOADS_DIR, path.basename(icon.filename)), { force: true });
  refresh();
}

export async function listUploadedIconsAction() {
  await requireUser();
  return listUploadedIcons();
}
