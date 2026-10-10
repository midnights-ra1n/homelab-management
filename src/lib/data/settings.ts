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
