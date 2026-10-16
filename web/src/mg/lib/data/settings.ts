// Types of homelab-management's lib/data/settings.ts + client fetchers.
import { api } from "../client";
import { resource } from "../resource";
import { networkData } from "./network";




export const DEFAULT_TIME_ZONE = "Europe/Paris";

type Settings = { settings: Record<string, string>; db_size: number; version: string };
export const getSettings = () => resource("settings", () => api.get<Settings>("/api/settings"));
export const getSetting = (key: string, fallback: string) => resource(`setting:${key}`, () => getSettings().then((s) => s.settings[key] ?? fallback));
export const getTimeZone = () => getSetting("timezone", DEFAULT_TIME_ZONE);
export const defaultFirewallPolicy = () => resource("net:policy", () => networkData().then((d) => d.default_policy));

/** IANA time zones (Europe/Paris, America/New_York…), UTC included. */
export function timeZones(): string[] {
  const list = Intl.supportedValuesOf("timeZone");
  return list.includes("UTC") ? list : ["UTC", ...list];
}
