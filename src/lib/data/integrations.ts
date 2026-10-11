import "server-only";
import { all, get, run } from "../db";
import { decrypt, encrypt } from "../crypto";
import type { IntegrationType } from "../constants";
import type { IntegrationInput } from "../validation";
import { logActivity } from "./activity";

export type IntegrationConfig = {
  username?: string;
  password?: string;
  token_id?: string;
  token_secret?: string;
  auth_header?: string;
  verify_tls?: boolean;
  // Webmin : accès SSH par clé (hôte = celui de l'URL)
  ssh_key_id?: number;
  ssh_user?: string;
  ssh_port?: number;
  /** Empreinte SHA256 de la clé d'hôte, mémorisée à la première connexion (TOFU). */
  ssh_host_key?: string;
};

export type Integration = {
  id: number;
  type: IntegrationType;
  name: string;
  url: string;
  enabled: number;
  config: IntegrationConfig;
  created_at: string;
  updated_at: string;
};

/** Vue sans secrets, sûre à transmettre au client. */
export type IntegrationPublic = Omit<Integration, "config"> & {
  config: {
    username?: string;
    token_id?: string;
    verify_tls?: boolean;
    has_secret: boolean;
    has_header: boolean;
    ssh_key_id?: number;
    ssh_user?: string;
    ssh_port?: number;
    ssh_host_key?: string;
  };
};

type Row = Omit<Integration, "config"> & { config: string };

function hydrate(row: Row): Integration {
  let config: IntegrationConfig = {};
  try {
    config = row.config ? JSON.parse(decrypt(row.config)) : {};
  } catch {
    config = {};
  }
  return { ...row, config };
}

export function listIntegrations(type?: IntegrationType, onlyEnabled = false): Integration[] {
  const where: string[] = [];
  const params: string[] = [];
  if (type) {
    where.push("type = ?");
    params.push(type);
  }
  if (onlyEnabled) where.push("enabled = 1");
  return all<Row>(
    `SELECT * FROM integrations ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY type, name COLLATE NOCASE`,
    params,
  ).map(hydrate);
}

export function getIntegration(id: number): Integration | undefined {
  const row = get<Row>("SELECT * FROM integrations WHERE id = ?", [id]);
  return row ? hydrate(row) : undefined;
}

export function toPublic(i: Integration): IntegrationPublic {
  return {
    ...i,
    config: {
      username: i.config.username,
      token_id: i.config.token_id,
      verify_tls: i.config.verify_tls,
      has_secret: !!(i.config.password || i.config.token_secret),
      has_header: !!i.config.auth_header,
      ssh_key_id: i.config.ssh_key_id,
      ssh_user: i.config.ssh_user,
      ssh_port: i.config.ssh_port,
      ssh_host_key: i.config.ssh_host_key,
    },
  };
}

/** Fusionne la saisie avec la config existante : un secret laissé vide est conservé. */
export function buildConfig(input: IntegrationInput, previous?: IntegrationConfig, previousUrl?: string): IntegrationConfig {
  const sameHost = !!previousUrl && hostOf(previousUrl) === hostOf(input.url) && previous?.ssh_port === (input.ssh_port ?? undefined);
  return {
    username: input.username || undefined,
    password: input.password || previous?.password,
    token_id: input.token_id || undefined,
    token_secret: input.token_secret || previous?.token_secret,
    auth_header: input.auth_header || previous?.auth_header,
    verify_tls: input.verify_tls,
    ssh_key_id: input.ssh_key_id ?? undefined,
    ssh_user: input.ssh_user || undefined,
    ssh_port: input.ssh_port ?? undefined,
    // Changer d'hôte ou demander l'oubli réinitialise l'empreinte mémorisée.
    ssh_host_key: sameHost && !input.reset_host_key ? previous?.ssh_host_key : undefined,
  };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Mémorise l'empreinte SSH vue à la première connexion. */
export function rememberHostKey(id: number, fingerprint: string) {
  const i = getIntegration(id);
  if (!i || i.config.ssh_host_key) return;
  run("UPDATE integrations SET config = ? WHERE id = ?", [encrypt(JSON.stringify({ ...i.config, ssh_host_key: fingerprint })), id]);
}

export function createIntegration(input: IntegrationInput) {
  const config = buildConfig(input);
  const { lastId } = run("INSERT INTO integrations (type, name, url, config, enabled) VALUES (?, ?, ?, ?, ?)", [
    input.type,
    input.name,
    input.url,
    encrypt(JSON.stringify(config)),
    input.enabled ? 1 : 0,
  ]);
  logActivity("integration", lastId, "create", `Intégration ${input.type} « ${input.name} » ajoutée`);
  return lastId;
}

export function updateIntegration(id: number, input: IntegrationInput, clearHeader = false) {
  const previous = getIntegration(id);
  const config = buildConfig(input, previous?.config, previous?.url);
  if (clearHeader) delete config.auth_header;
  run(
    "UPDATE integrations SET name = ?, url = ?, config = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?",
    [input.name, input.url, encrypt(JSON.stringify(config)), input.enabled ? 1 : 0, id],
  );
  logActivity("integration", id, "update", `Intégration « ${input.name} » modifiée`);
}

export function deleteIntegration(id: number) {
  const i = get<{ name: string }>("SELECT name FROM integrations WHERE id = ?", [id]);
  run("DELETE FROM integrations WHERE id = ?", [id]);
  if (i) logActivity("integration", id, "delete", `Intégration « ${i.name} » supprimée`);
}
