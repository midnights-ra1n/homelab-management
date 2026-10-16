// Types of homelab-management's lib/data/shortcuts.ts + client fetchers.
import { get } from "../client";
import { resource } from "../resource";

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


/* ---------------------------------------------------------------- fetchers */

const home = () => get<{ groups: ShortcutGroup[]; shortcuts: Shortcut[]; icons: UploadedIcon[] }>("/api/mg/shortcuts");
export const listGroups = () => resource("home:groups", () => home().then((h) => h.groups));
export const listShortcuts = () => resource("home:shortcuts", () => home().then((h) => h.shortcuts));
export const listUploadedIcons = () => resource("home:icons", () => home().then((h) => h.icons));
