// Types of homelab-management's lib/data/domains.ts + client fetchers.
import { resource } from "../resource";
import { networkData } from "./network";
import type { DomainExposure } from "../constants";

export type Domain = {
  id: number;
  fqdn: string;
  exposure: DomainExposure;
  proxy_asset_id: number | null;
  proxy_name: string | null;
  proxy_ip: string | null;
  target_asset_id: number | null;
  target_name: string | null;
  target_ip: string | null;
  upstream: string;
  notes: string;
};


export const listDomains = () => resource("net:domains", () => networkData().then((d) => d.domains as Domain[]));
