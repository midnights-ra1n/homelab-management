// Types of homelab-management's lib/data/integrations.ts + client fetchers.
import { get, qs } from "../client";
import { resource } from "../resource";
import type { IntegrationType } from "../constants";

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



/* ---------------------------------------------------------------- fetchers */

/** Integrations without their secrets (the server never sends them). */
export const listIntegrations = (type?: IntegrationType, onlyEnabled = false) =>
  resource(`integrations:${type ?? ""}:${onlyEnabled}`, () =>
    get<IntegrationPublic[]>(`/api/mg/integrations${qs({ type })}`).then((l) => (onlyEnabled ? l.filter((i) => i.enabled) : l)),
  );
export const getIntegration = (id: number) =>
  resource(`integration:${id}`, () => listIntegrations().then((l) => l.find((i) => i.id === id)));
export const toPublic = (i: IntegrationPublic) => i;
