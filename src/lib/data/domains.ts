import "server-only";
import { all, get, run } from "../db";
import type { DomainExposure } from "../constants";
import type { DomainInput } from "../validation";
import { logActivity } from "./activity";

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

const primaryIp = (col: string) => `(SELECT address FROM ip_addresses WHERE asset_id = ${col} ORDER BY is_primary DESC, id LIMIT 1)`;

export function listDomains(): Domain[] {
  // Tri par domaine parent puis sous-domaine : app.example.fr → example.fr.app
  return all<Domain>(`
    SELECT d.*, p.display_name AS proxy_name, ${primaryIp("d.proxy_asset_id")} AS proxy_ip,
      t.display_name AS target_name, ${primaryIp("d.target_asset_id")} AS target_ip
    FROM domains d
    LEFT JOIN assets p ON p.id = d.proxy_asset_id
    LEFT JOIN assets t ON t.id = d.target_asset_id`).sort((a, b) =>
    a.fqdn.split(".").reverse().join(".").localeCompare(b.fqdn.split(".").reverse().join(".")),
  );
}

const values = (i: DomainInput) => [i.fqdn, i.exposure, i.proxy_asset_id, i.target_asset_id, i.upstream, i.notes];

export function createDomain(i: DomainInput) {
  const { lastId } = run(
    "INSERT INTO domains (fqdn, exposure, proxy_asset_id, target_asset_id, upstream, notes) VALUES (?, ?, ?, ?, ?, ?)",
    values(i),
  );
  logActivity("domain", lastId, "create", `Domaine « ${i.fqdn} » ajouté`);
}

export function updateDomain(id: number, i: DomainInput) {
  run(
    `UPDATE domains SET fqdn = ?, exposure = ?, proxy_asset_id = ?, target_asset_id = ?, upstream = ?, notes = ?,
       updated_at = datetime('now') WHERE id = ?`,
    [...values(i), id],
  );
  logActivity("domain", id, "update", `Domaine « ${i.fqdn} » modifié`);
}

export function deleteDomain(id: number) {
  const d = get<{ fqdn: string }>("SELECT fqdn FROM domains WHERE id = ?", [id]);
  run("DELETE FROM domains WHERE id = ?", [id]);
  if (d) logActivity("domain", id, "delete", `Domaine « ${d.fqdn} » supprimé`);
}
