import "server-only";
import fs from "node:fs";
import path from "node:path";
import { all, db, UPLOADS_DIR } from "../db";
import { decrypt, encrypt } from "../crypto";
import { logActivity } from "./activity";

/** Tables sauvegardées, dans l'ordre d'insertion (dépendances d'abord). */
const TABLES = [
  "settings",
  "vlans",
  "subnets",
  "integrations",
  "ssh_keys",
  "assets",
  "ip_addresses",
  "deployments",
  "deployment_steps",
  "tasks",
  "shortcut_groups",
  "shortcuts",
  "uploaded_icons",
  "map_positions",
  "map_links",
  "vpn_tunnels",
  "firewall_rules",
  "domains",
  "activity",
] as const;

export type Backup = {
  app: "homelab-management";
  version: 1;
  exported_at: string;
  secrets: boolean;
  tables: Record<string, Record<string, unknown>[]>;
  files: Record<string, string>;
};

export function exportBackup(includeSecrets: boolean): Backup {
  const tables: Backup["tables"] = {};
  for (const t of TABLES) {
    tables[t] = all<Record<string, unknown>>(`SELECT * FROM ${t}`);
  }
  tables.integrations = tables.integrations.map((row) => {
    if (!includeSecrets) return { ...row, config: "" };
    try {
      return { ...row, config: JSON.parse(decrypt(String(row.config))) };
    } catch {
      return { ...row, config: "" };
    }
  });
  tables.ssh_keys = tables.ssh_keys.map((row) => {
    if (!includeSecrets) return { ...row, private_key: "" };
    try {
      return { ...row, private_key: decrypt(String(row.private_key)) };
    } catch {
      return { ...row, private_key: "" };
    }
  });
  const files: Record<string, string> = {};
  for (const icon of tables.uploaded_icons) {
    const file = path.join(/*turbopackIgnore: true*/ UPLOADS_DIR, path.basename(String(icon.filename)));
    if (fs.existsSync(file)) files[String(icon.filename)] = fs.readFileSync(file).toString("base64");
  }
  return { app: "homelab-management", version: 1, exported_at: new Date().toISOString(), secrets: includeSecrets, tables, files };
}

export function importBackup(backup: Backup) {
  if (backup?.app !== "homelab-management" || backup.version !== 1 || typeof backup.tables !== "object") {
    throw new Error("Fichier de sauvegarde invalide");
  }
  const conn = db();
  // Valide les noms de colonnes contre le schéma courant (pas d'injection via les clés JSON)
  const columns = (t: string) =>
    new Set(all<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name));

  conn.exec("PRAGMA foreign_keys = OFF");
  conn.exec("BEGIN");
  try {
    for (const t of [...TABLES].reverse()) conn.exec(`DELETE FROM ${t}`);
    for (const t of TABLES) {
      const rows = backup.tables[t] ?? [];
      const allowed = columns(t);
      for (const raw of rows) {
        const row: Record<string, unknown> = { ...raw };
        if (t === "integrations") {
          const c = row.config;
          row.config = c && typeof c === "object" ? encrypt(JSON.stringify(c)) : typeof c === "string" && c.startsWith("v1.") ? c : encrypt("{}");
        }
        if (t === "ssh_keys") {
          const k = String(row.private_key ?? "");
          if (!k) continue; // sauvegarde sans secrets : la clé est inutilisable
          if (!k.startsWith("v1.")) row.private_key = encrypt(k);
        }
        const keys = Object.keys(row).filter((k) => allowed.has(k));
        if (!keys.length) continue;
        const values = keys.map((k) => {
          const v = row[k];
          return v === undefined ? null : typeof v === "object" && v !== null ? JSON.stringify(v) : (v as string | number | null);
        });
        conn.prepare(`INSERT INTO ${t} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...values);
      }
    }
    conn.exec("COMMIT");
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  } finally {
    conn.exec("PRAGMA foreign_keys = ON");
  }
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const [name, b64] of Object.entries(backup.files ?? {})) {
    fs.writeFileSync(path.join(/*turbopackIgnore: true*/ UPLOADS_DIR, path.basename(name)), Buffer.from(b64, "base64"));
  }
  logActivity("system", null, "update", "Restauration d'une sauvegarde");
}
