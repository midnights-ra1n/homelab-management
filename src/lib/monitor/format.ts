import type { Locale } from "@/i18n/locales";

/** Formatage partagé serveur / client des données de disponibilité. */

export function uptimeTone(u: number | null) {
  if (u === null) return null;
  if (u >= 99.9) return "green" as const;
  if (u >= 99) return "yellow" as const;
  return "red" as const;
}

export function formatPct(u: number | null, digits = 2, locale: Locale = "fr") {
  if (u === null) return "—";
  const v = u >= 99.995 && u < 100 ? "99.99" : u.toFixed(u === 100 ? 0 : digits);
  return locale === "en" ? `${v}%` : `${v.replace(".", ",")} %`;
}
