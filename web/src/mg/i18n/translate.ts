/*
 * The interface is French only: tr() keeps homelab-management's API (the key is the French
 * text) and only fills the {name} placeholders.
 */
export type Params = Record<string, string | number | null | undefined>;
/** Only "fr" is used; "en" remains in the shared formatters' signatures. */
export type Locale = "fr" | "en";
export type Translate = ((text: string | null | undefined, params?: Params) => string) & { locale: Locale };

const fill = (s: string, params: Params) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k] ?? "") : m));

export const tr: Translate = Object.assign(
  (text: string | null | undefined, params?: Params) => (typeof text !== "string" ? "" : params ? fill(text, params) : text),
  { locale: "fr" as Locale },
);
