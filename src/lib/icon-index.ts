import "server-only";

/** Index des icônes disponibles, mis en cache 24 h en mémoire. */
type Entry = { provider: "dashboard" | "selfhst"; name: string; label: string };

let cache: { at: number; entries: Entry[] } | null = null;
const TTL = 24 * 3600_000;

async function load(): Promise<Entry[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.entries;
  const [dash, selfhst] = await Promise.allSettled([
    fetch("https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/tree.json", { signal: AbortSignal.timeout(8000) }).then(
      (r) => r.json() as Promise<{ svg?: string[] }>,
    ),
    fetch("https://cdn.jsdelivr.net/gh/selfhst/icons/index.json", { signal: AbortSignal.timeout(8000) }).then(
      (r) => r.json() as Promise<{ Name: string; Reference: string; SVG: string }[]>,
    ),
  ]);
  const entries: Entry[] = [];
  if (dash.status === "fulfilled") {
    for (const file of dash.value.svg ?? []) {
      const name = file.replace(/\.svg$/, "");
      entries.push({ provider: "dashboard", name, label: name.replace(/-/g, " ") });
    }
  }
  if (selfhst.status === "fulfilled") {
    for (const i of selfhst.value) {
      if (i.SVG === "Yes") entries.push({ provider: "selfhst", name: i.Reference, label: i.Name });
    }
  }
  if (entries.length) cache = { at: Date.now(), entries };
  return entries;
}

export async function searchIcons(query: string, provider?: string, limit = 60): Promise<Entry[]> {
  const q = query.trim().toLowerCase();
  const entries = (await load()).filter((e) => !provider || e.provider === provider);
  if (!q) return entries.slice(0, limit);
  const scored: { e: Entry; score: number }[] = [];
  for (const e of entries) {
    const n = e.name.toLowerCase();
    const l = e.label.toLowerCase();
    const score = n === q ? 0 : n.startsWith(q) ? 1 : l.startsWith(q) ? 2 : n.includes(q) || l.includes(q) ? 3 : -1;
    if (score >= 0) scored.push({ e, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.e.name.length - b.e.name.length)
    .slice(0, limit)
    .map((s) => s.e);
}
