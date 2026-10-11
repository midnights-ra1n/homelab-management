import { en } from "./en";
import type { Locale } from "./locales";

/**
 * Traduction façon gettext : la clé est la phrase française, la langue par défaut.
 * Une phrase absente du dictionnaire reste en français (jamais de texte vide).
 * Les messages dynamiques venus du serveur (« Ajout de « X » à l'inventaire ») sont
 * reconnus via les clés à paramètres ({name}) du dictionnaire.
 */

export type Params = Record<string, string | number | null | undefined>;
export type Translate = ((text: string | null | undefined, params?: Params) => string) & { locale: Locale };

const DICTS: Record<Locale, Record<string, string> | null> = { fr: null, en };

const fill = (s: string, params: Params) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k] ?? "") : m));

type Pattern = { re: RegExp; names: string[]; value: string };
const patternCache = new Map<Locale, Pattern[]>();
function patterns(locale: Locale): Pattern[] {
  let list = patternCache.get(locale);
  if (list) return list;
  list = [];
  for (const [key, value] of Object.entries(DICTS[locale] ?? {})) {
    const names: string[] = [];
    if (!/\{\w+\}/.test(key)) continue;
    const src = key
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = part.match(/^\{(\w+)\}$/);
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(m[1]);
        return "(.+?)";
      })
      .join("");
    list.push({ re: new RegExp(`^${src}$`, "s"), names, value });
  }
  // Les clés les plus longues (les plus spécifiques) d'abord
  list.sort((a, b) => b.re.source.length - a.re.source.length);
  patternCache.set(locale, list);
  return list;
}

export function translate(locale: Locale, text: string | null | undefined, params?: Params): string {
  if (typeof text !== "string") return "";
  const dict = DICTS[locale];
  if (!dict) return params ? fill(text, params) : text;
  const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  const hit = dict[core];
  if (hit !== undefined) return lead + (params ? fill(hit, params) : hit) + trail;
  if (params) return fill(text, params);
  if (core.length > 300) return text;
  for (const p of patterns(locale)) {
    const m = core.match(p.re);
    if (!m) continue;
    const values: Params = {};
    p.names.forEach((n, i) => (values[n] = dict[m[i + 1]] ?? m[i + 1]));
    return lead + fill(p.value, values) + trail;
  }
  return text;
}

const cache = new Map<Locale, Translate>();
export function createT(locale: Locale): Translate {
  let t = cache.get(locale);
  if (!t) {
    t = Object.assign((text: string | null | undefined, params?: Params) => translate(locale, text, params), { locale });
    cache.set(locale, t);
  }
  return t;
}
