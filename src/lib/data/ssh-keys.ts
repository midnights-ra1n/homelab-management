import "server-only";
import crypto from "node:crypto";
import ssh2 from "ssh2";
import { all, get, run } from "../db";
import { decrypt, encrypt } from "../crypto";
import { logActivity } from "./activity";

const { utils } = ssh2;

/** Vue publique (jamais la clé privée). */
export type SshKey = { id: number; name: string; type: string; public_key: string; fingerprint: string; created_at: string };

const COLUMNS = "id, name, type, public_key, fingerprint, created_at";

export class SshKeyError extends Error {}

export function listSshKeys(): SshKey[] {
  return all<SshKey>(`SELECT ${COLUMNS} FROM ssh_keys ORDER BY name COLLATE NOCASE`);
}

export function getSshKey(id: number): SshKey | undefined {
  return get<SshKey>(`SELECT ${COLUMNS} FROM ssh_keys WHERE id = ?`, [id]);
}

export function getPrivateKey(id: number): string | undefined {
  const row = get<{ private_key: string }>("SELECT private_key FROM ssh_keys WHERE id = ?", [id]);
  return row ? decrypt(row.private_key) : undefined;
}

/** Empreinte au format OpenSSH (SHA256:…) d'une clé publique « type base64 ». */
export function fingerprint(publicKey: string): string {
  const blob = Buffer.from(publicKey.trim().split(/\s+/)[1] ?? "", "base64");
  return "SHA256:" + crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");
}

function save(name: string, privateKey: string, comment: string) {
  const parsed = utils.parseKey(privateKey);
  if (parsed instanceof Error) throw new SshKeyError(`Clé privée illisible : ${parsed.message}`);
  if (!parsed.isPrivateKey()) throw new SshKeyError("Ce n'est pas une clé privée");
  const publicKey = `${parsed.type} ${parsed.getPublicSSH().toString("base64")} ${comment}`.trim();
  const { lastId } = run(
    "INSERT INTO ssh_keys (name, type, public_key, private_key, fingerprint) VALUES (?, ?, ?, ?, ?)",
    [name, parsed.type, publicKey, encrypt(privateKey), fingerprint(publicKey)],
  );
  logActivity("system", lastId, "create", `Clé SSH « ${name} » ajoutée`);
  return lastId;
}

export function generateSshKey(name: string, type: "ed25519" | "rsa") {
  const pair =
    type === "rsa"
      ? utils.generateKeyPairSync("rsa", { bits: 4096, comment: `homelab-management:${name}` })
      : utils.generateKeyPairSync("ed25519", { comment: `homelab-management:${name}` });
  return save(name, pair.private, `homelab-management:${name}`);
}

/** Clé privée OpenSSH / PEM sans passphrase (une clé chiffrée est refusée par parseKey). */
export function importSshKey(name: string, privateKey: string) {
  return save(name, privateKey.trim() + "\n", `homelab-management:${name}`);
}

export function deleteSshKey(id: number) {
  const k = getSshKey(id);
  run("DELETE FROM ssh_keys WHERE id = ?", [id]);
  if (k) logActivity("system", id, "delete", `Clé SSH « ${k.name} » supprimée`);
}
