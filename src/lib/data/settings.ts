import "server-only";
import { get, run } from "../db";

export function getSetting(key: string, fallback: string): string {
  return get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key])?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}

/** Politique appliquée au trafic routé quand aucune règle ne correspond. */
export function defaultFirewallPolicy(): "allow" | "deny" {
  return getSetting("fw_default_policy", "allow") === "deny" ? "deny" : "allow";
}

export const DEFAULT_TIME_ZONE = "Europe/Paris";

/** Fuseaux IANA proposés (Europe/Paris, America/New_York…), UTC compris. */
export function timeZones(): string[] {
  const list = Intl.supportedValuesOf("timeZone");
  return list.includes("UTC") ? list : ["UTC", ...list];
}

export function getTimeZone(): string {
  return getSetting("timezone", process.env.TZ || DEFAULT_TIME_ZONE);
}

/** Applique le fuseau au processus : Date et Intl de Node suivent process.env.TZ dès son affectation. */
export function applyTimeZone(tz = getTimeZone()) {
  process.env.TZ = tz;
}
