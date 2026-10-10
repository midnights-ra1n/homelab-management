import "server-only";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { migrations } from "./migrations";

export const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.DATA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data"),
);
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

type Params = Record<string, SQLInputValue> | SQLInputValue[];

function open(): DatabaseSync {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "homelab.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < migrations.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

// Connexion unique et paresseuse (survit au rechargement à chaud en dev).
const globalForDb = globalThis as unknown as { __homelabDb?: DatabaseSync };
export function db(): DatabaseSync {
  return (globalForDb.__homelabDb ??= open());
}

function stmt(sql: string) {
  return db().prepare(sql);
}

function exec<R>(sql: string, params: Params | undefined, method: "all" | "get" | "run"): R {
  const s = stmt(sql);
  if (params === undefined) return s[method]() as R;
  return (Array.isArray(params) ? s[method](...params) : s[method](params)) as R;
}

// node:sqlite renvoie des objets sans prototype : on les convertit en objets
// ordinaires, sérialisables vers les composants client.
export function all<T>(sql: string, params?: Params): T[] {
  return exec<object[]>(sql, params, "all").map((row) => ({ ...row }) as T);
}

export function get<T>(sql: string, params?: Params): T | undefined {
  const row = exec<object | undefined>(sql, params, "get");
  return row ? ({ ...row } as T) : undefined;
}

export function run(sql: string, params?: Params) {
  const r = exec<{ changes: number | bigint; lastInsertRowid: number | bigint }>(sql, params, "run");
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

export function transaction<T>(fn: () => T): T {
  db().exec("BEGIN");
  try {
    const result = fn();
    db().exec("COMMIT");
    return result;
  } catch (err) {
    db().exec("ROLLBACK");
    throw err;
  }
}
