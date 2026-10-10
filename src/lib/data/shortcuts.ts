import "server-only";
import { all, get, run } from "../db";
import type { ShortcutInput } from "../validation";
import { logActivity } from "./activity";

export type IconType = "none" | "dashboard" | "selfhst" | "upload" | "url";

export type Shortcut = {
  id: number;
  name: string;
  url: string;
  description: string;
  group_id: number | null;
  icon_type: IconType;
  icon_value: string;
  asset_id: number | null;
  asset_name: string | null;
  new_tab: number;
  status_check: number;
  position: number;
};

export type ShortcutGroup = { id: number; name: string; position: number };

export type UploadedIcon = { id: number; filename: string; label: string; mime: string; size: number };

export function listGroups(): ShortcutGroup[] {
  return all<ShortcutGroup>("SELECT id, name, position FROM shortcut_groups ORDER BY position, id");
}

export function listShortcuts(): Shortcut[] {
  return all<Shortcut>(
    `SELECT s.*, a.display_name AS asset_name FROM shortcuts s LEFT JOIN assets a ON a.id = s.asset_id
     ORDER BY s.position, s.name COLLATE NOCASE`,
  );
}

export function getShortcut(id: number) {
  return get<Shortcut>("SELECT *, NULL AS asset_name FROM shortcuts WHERE id = ?", [id]);
}

export function createShortcut(input: ShortcutInput) {
  const { lastId } = run(
    `INSERT INTO shortcuts (name, url, description, group_id, icon_type, icon_value, asset_id, new_tab, status_check, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM shortcuts))`,
    [
      input.name,
      input.url,
      input.description,
      input.group_id,
      input.icon_type,
      input.icon_value,
      input.asset_id,
      input.new_tab ? 1 : 0,
      input.status_check ? 1 : 0,
    ],
  );
  logActivity("shortcut", lastId, "create", `Raccourci « ${input.name} » ajouté`);
}

export function updateShortcut(id: number, input: ShortcutInput) {
  run(
    `UPDATE shortcuts SET name = ?, url = ?, description = ?, group_id = ?, icon_type = ?, icon_value = ?, asset_id = ?,
       new_tab = ?, status_check = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      input.name,
      input.url,
      input.description,
      input.group_id,
      input.icon_type,
      input.icon_value,
      input.asset_id,
      input.new_tab ? 1 : 0,
      input.status_check ? 1 : 0,
      id,
    ],
  );
}

export function deleteShortcut(id: number) {
  const s = get<{ name: string }>("SELECT name FROM shortcuts WHERE id = ?", [id]);
  run("DELETE FROM shortcuts WHERE id = ?", [id]);
  if (s) logActivity("shortcut", id, "delete", `Raccourci « ${s.name} » supprimé`);
}

export function reorderShortcuts(groupId: number | null, orderedIds: number[]) {
  orderedIds.forEach((id, i) => run("UPDATE shortcuts SET position = ?, group_id = ? WHERE id = ?", [i, groupId, id]));
}

export function createGroup(name: string) {
  run("INSERT INTO shortcut_groups (name, position) VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM shortcut_groups))", [
    name,
  ]);
}

export function renameGroup(id: number, name: string) {
  run("UPDATE shortcut_groups SET name = ? WHERE id = ?", [name, id]);
}

export function deleteGroup(id: number) {
  run("DELETE FROM shortcut_groups WHERE id = ?", [id]);
}

export function moveGroup(id: number, direction: -1 | 1) {
  const groups = listGroups();
  const i = groups.findIndex((g) => g.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= groups.length) return;
  [groups[i], groups[j]] = [groups[j], groups[i]];
  groups.forEach((g, pos) => run("UPDATE shortcut_groups SET position = ? WHERE id = ?", [pos, g.id]));
}

/* Icônes téléversées ------------------------------------------------------ */

export function listUploadedIcons(): UploadedIcon[] {
  return all<UploadedIcon>("SELECT * FROM uploaded_icons ORDER BY id DESC");
}

export function addUploadedIcon(filename: string, label: string, mime: string, size: number) {
  run("INSERT INTO uploaded_icons (filename, label, mime, size) VALUES (?, ?, ?, ?)", [filename, label, mime, size]);
}

export function getUploadedIcon(filename: string) {
  return get<UploadedIcon>("SELECT * FROM uploaded_icons WHERE filename = ?", [filename]);
}

export function deleteUploadedIcon(id: number) {
  const icon = get<UploadedIcon>("SELECT * FROM uploaded_icons WHERE id = ?", [id]);
  if (!icon) return null;
  run("DELETE FROM uploaded_icons WHERE id = ?", [id]);
  run("UPDATE shortcuts SET icon_type = 'none', icon_value = '' WHERE icon_type = 'upload' AND icon_value = ?", [
    icon.filename,
  ]);
  return icon;
}
