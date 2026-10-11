export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";
export const LOCALE_COOKIE = "hm-lang";

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

/** Langue préférée : cookie, sinon Accept-Language (français → fr, le reste → en). */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return DEFAULT_LOCALE;
  return first.startsWith("fr") ? "fr" : "en";
}
