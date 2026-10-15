import type { Asset } from "@/lib/data/assets";
import { ASSET_STATUSES } from "@/lib/constants";
import { ipToInt } from "@/lib/ip";
import { resourceWeight } from "./summary";

export const SORT_KEYS = ["name", "status", "ip", "host", "resources"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = { key: SortKey; desc: boolean } | null;

/** « -ip » → { key: "ip", desc: true } ; valeur inconnue → ordre par défaut (type puis nom). */
export function parseSort(value: string | null): Sort {
  if (!value) return null;
  const desc = value.startsWith("-");
  const key = (desc ? value.slice(1) : value) as SortKey;
  return SORT_KEYS.includes(key) ? { key, desc } : null;
}

const VALUE: Record<SortKey, (a: Asset) => string | number | null> = {
  name: (a) => a.display_name.toLowerCase(),
  status: (a) => ASSET_STATUSES.indexOf(a.status),
  // IP numérique : 10.0.0.9 avant 10.0.0.10
  ip: (a) => (a.primary_ip ? ipToInt(a.primary_ip) : null),
  host: (a) => a.parent_name?.toLowerCase() ?? null,
  resources: (a) => resourceWeight(a) || null,
};

/** Tri stable ; les valeurs vides vont toujours à la fin. Sans tri : ordre du serveur. */
export function sortAssets<T extends Asset>(assets: T[], sort: Sort): T[] {
  if (!sort) return assets;
  const get = VALUE[sort.key];
  return [...assets].sort((x, y) => {
    const a = get(x);
    const b = get(y);
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    const c = a < b ? -1 : a > b ? 1 : 0;
    return sort.desc ? -c : c;
  });
}

export type Row = { asset: Asset; depth: number; hasChildren: boolean };

/** Lignes de la vue arbre : chaque élément sous son hôte ; un hôte filtré fait remonter ses invités à la racine. */
export function treeRows(assets: Asset[], collapsed: Set<number>): Row[] {
  const ids = new Set(assets.map((a) => a.id));
  const byParent = new Map<number | null, Asset[]>();
  for (const a of assets) {
    const key = a.parent_id && ids.has(a.parent_id) ? a.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), a]);
  }
  const rows: Row[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number) => {
    for (const a of byParent.get(parent) ?? []) {
      if (seen.has(a.id)) continue; // garde-fou contre une boucle parent ↔ enfant
      seen.add(a.id);
      const hasChildren = byParent.has(a.id);
      rows.push({ asset: a, depth, hasChildren });
      if (hasChildren && !collapsed.has(a.id)) walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

