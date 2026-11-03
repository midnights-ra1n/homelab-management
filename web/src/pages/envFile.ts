/**
 * .env file of a node-app, as rows for the variables editor (same rules as node-app-ui). The host
 * reads it with bash (set -a; . file): typed values are single-quoted, and a variable left alone
 * keeps its original form (quotes, $VAR). Comments are kept, at the top.
 */
export type EnvRow = { id: number; k: string; v: string; raw: string | null };
export type EnvDoc = { rows: EnvRow[]; other: string[] };

const ENV_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
let nextId = 1;

export const blankRow = (): EnvRow => ({ id: nextId++, k: "", v: "", raw: null });

function unquote(raw: string) {
  const r = raw.trim();
  let m: RegExpExecArray | null;
  if ((m = /^'(.*)'$/.exec(r))) return m[1].replace(/'\\''/g, "'");
  if ((m = /^"(.*)"$/.exec(r))) return m[1].replace(/\\(["\\$`])/g, "$1");
  return r.replace(/\s+#.*$/, "");
}

const quote = (v: string) => (/^[\w@%+=:,./-]*$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);

export function parseEnv(text: string): EnvDoc {
  const doc: EnvDoc = { rows: [], other: [] };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const m = ENV_RE.exec(line);
    if (m) doc.rows.push({ id: nextId++, k: m[1], v: unquote(m[2]), raw: m[2] });
    else if (line.trim()) doc.other.push(line);
  }
  return doc;
}

/** False when the file cannot be shown as rows without loss (value on several lines...). */
export const envTabular = (d: EnvDoc) =>
  d.other.every((l) => l.trim().startsWith("#")) && !d.rows.some((r) => /^\s*["']/.test(r.raw ?? "") && !/^\s*(["']).*\1\s*(#.*)?$/.test(r.raw ?? ""));

export const serializeEnv = (d: EnvDoc) => [...d.other, ...d.rows.filter((r) => r.k).map((r) => `${r.k}=${r.raw ?? quote(r.v)}`)].join("\n");

/** Adds the variables of `add` to `d`; one that already exists takes the new value. */
export function mergeEnv(d: EnvDoc, add: EnvDoc): EnvDoc {
  const rows = d.rows.filter((r) => r.k || r.v);
  for (const v of add.rows) {
    const i = rows.findIndex((r) => r.k === v.k);
    if (i >= 0) rows[i] = { ...v, id: rows[i].id };
    else rows.push(v);
  }
  return { rows, other: [...d.other, ...add.other] };
}

/** What is wrong with each row, by id: empty when the variables can be saved. */
export function envProblems(rows: EnvRow[]) {
  const count = new Map<string, number>();
  for (const r of rows) if (r.k) count.set(r.k, (count.get(r.k) ?? 0) + 1);
  const out = new Map<number, string>();
  for (const r of rows) {
    if (!r.k) { if (r.v) out.set(r.id, "Nom manquant"); }
    else if (!KEY_RE.test(r.k)) out.set(r.id, "Lettres, chiffres et _ (pas de chiffre au début)");
    else if ((count.get(r.k) ?? 0) > 1) out.set(r.id, "Nom en double");
  }
  return out;
}
