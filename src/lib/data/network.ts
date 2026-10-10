import "server-only";
import { all, get, run } from "../db";
import type { IpStatus, Tone } from "../constants";
import { compareIp, intToIp, ipToInt, parseCidr, usableHosts } from "../ip";
import type { IpInput, SubnetInput, VlanInput } from "../validation";
import { logActivity } from "./activity";

export type Vlan = {
  id: number;
  vlan_id: number;
  name: string;
  description: string;
  color: Tone;
  subnet_count: number;
  asset_count: number;
};

export type Subnet = {
  id: number;
  name: string;
  cidr: string;
  vlan_id: number | null;
  vlan_number: number | null;
  vlan_name: string | null;
  vlan_color: Tone | null;
  gateway: string;
  dns: string;
  dhcp_start: string;
  dhcp_end: string;
  description: string;
  used: number;
  reserved: number;
  dhcp: number;
  capacity: number;
};

export type IpAddress = {
  id: number;
  address: string;
  subnet_id: number | null;
  asset_id: number | null;
  asset_name: string | null;
  asset_kind: string | null;
  mac: string;
  hostname: string;
  status: IpStatus;
  is_primary: number;
  description: string;
  updated_at: string;
};

/* VLANs ------------------------------------------------------------------- */

export function listVlans(): Vlan[] {
  return all<Vlan>(`
    SELECT v.*,
      (SELECT COUNT(*) FROM subnets s WHERE s.vlan_id = v.id) AS subnet_count,
      (SELECT COUNT(DISTINCT ip.asset_id) FROM ip_addresses ip JOIN subnets s ON s.id = ip.subnet_id
         WHERE s.vlan_id = v.id AND ip.asset_id IS NOT NULL) AS asset_count
    FROM vlans v ORDER BY v.vlan_id`);
}

export function createVlan(input: VlanInput) {
  const { lastId } = run("INSERT INTO vlans (vlan_id, name, description, color) VALUES (?, ?, ?, ?)", [
    input.vlan_id!,
    input.name,
    input.description,
    input.color,
  ]);
  logActivity("vlan", lastId, "create", `Création du VLAN ${input.vlan_id} « ${input.name} »`);
}

export function updateVlan(id: number, input: VlanInput) {
  run(
    "UPDATE vlans SET vlan_id = ?, name = ?, description = ?, color = ?, updated_at = datetime('now') WHERE id = ?",
    [input.vlan_id!, input.name, input.description, input.color, id],
  );
  logActivity("vlan", id, "update", `Modification du VLAN ${input.vlan_id}`);
}

export function deleteVlan(id: number) {
  const v = get<{ vlan_id: number }>("SELECT vlan_id FROM vlans WHERE id = ?", [id]);
  run("DELETE FROM vlans WHERE id = ?", [id]);
  if (v) logActivity("vlan", id, "delete", `Suppression du VLAN ${v.vlan_id}`);
}

/* Sous-réseaux ------------------------------------------------------------ */

const SUBNET_SELECT = `
  SELECT s.*, v.vlan_id AS vlan_number, v.name AS vlan_name, v.color AS vlan_color,
    (SELECT COUNT(*) FROM ip_addresses i WHERE i.subnet_id = s.id AND i.status = 'used') AS used,
    (SELECT COUNT(*) FROM ip_addresses i WHERE i.subnet_id = s.id AND i.status = 'reserved') AS reserved,
    (SELECT COUNT(*) FROM ip_addresses i WHERE i.subnet_id = s.id AND i.status = 'dhcp') AS dhcp
  FROM subnets s LEFT JOIN vlans v ON v.id = s.vlan_id`;

function withCapacity(s: Omit<Subnet, "capacity">): Subnet {
  return { ...s, capacity: usableHosts(s.cidr) };
}

export function listSubnets(): Subnet[] {
  return all<Omit<Subnet, "capacity">>(SUBNET_SELECT)
    .map(withCapacity)
    .sort((a, b) => compareIp(a.cidr.split("/")[0], b.cidr.split("/")[0]));
}

export function getSubnet(id: number): Subnet | undefined {
  const s = get<Omit<Subnet, "capacity">>(`${SUBNET_SELECT} WHERE s.id = ?`, [id]);
  return s ? withCapacity(s) : undefined;
}

export function subnetOptions() {
  return all<{ id: number; name: string; cidr: string; vlan_number: number | null }>(
    "SELECT s.id, s.name, s.cidr, v.vlan_id AS vlan_number FROM subnets s LEFT JOIN vlans v ON v.id = s.vlan_id ORDER BY s.name",
  );
}

/** Rattache automatiquement les IP orphelines au sous-réseau qui les contient. */
function attachOrphanIps() {
  const subnets = all<{ id: number; cidr: string }>("SELECT id, cidr FROM subnets");
  const orphans = all<{ id: number; address: string }>("SELECT id, address FROM ip_addresses WHERE subnet_id IS NULL");
  for (const ip of orphans) {
    const n = ipToInt(ip.address);
    const s = subnets.find((s) => {
      const c = parseCidr(s.cidr);
      return c && n !== null && n >= c.network && n < c.network + c.size;
    });
    if (s) run("UPDATE ip_addresses SET subnet_id = ? WHERE id = ?", [s.id, ip.id]);
  }
}

export function createSubnet(input: SubnetInput) {
  const { lastId } = run(
    `INSERT INTO subnets (name, cidr, vlan_id, gateway, dns, dhcp_start, dhcp_end, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.name, input.cidr, input.vlan_id, input.gateway, input.dns, input.dhcp_start, input.dhcp_end, input.description],
  );
  attachOrphanIps();
  logActivity("subnet", lastId, "create", `Création du sous-réseau ${input.cidr} « ${input.name} »`);
}

export function updateSubnet(id: number, input: SubnetInput) {
  run(
    `UPDATE subnets SET name = ?, cidr = ?, vlan_id = ?, gateway = ?, dns = ?, dhcp_start = ?, dhcp_end = ?,
       description = ?, updated_at = datetime('now') WHERE id = ?`,
    [input.name, input.cidr, input.vlan_id, input.gateway, input.dns, input.dhcp_start, input.dhcp_end, input.description, id],
  );
  attachOrphanIps();
  logActivity("subnet", id, "update", `Modification du sous-réseau ${input.cidr}`);
}

export function deleteSubnet(id: number) {
  const s = get<{ cidr: string }>("SELECT cidr FROM subnets WHERE id = ?", [id]);
  run("DELETE FROM subnets WHERE id = ?", [id]);
  if (s) logActivity("subnet", id, "delete", `Suppression du sous-réseau ${s.cidr}`);
}

/** Trouve le sous-réseau contenant une IP. */
export function findSubnetFor(address: string): number | null {
  const n = ipToInt(address);
  if (n === null) return null;
  let best: { id: number; prefix: number } | null = null;
  for (const s of all<{ id: number; cidr: string }>("SELECT id, cidr FROM subnets")) {
    const c = parseCidr(s.cidr);
    if (c && n >= c.network && n < c.network + c.size && (!best || c.prefix > best.prefix)) best = { id: s.id, prefix: c.prefix };
  }
  return best?.id ?? null;
}

/* Adresses ---------------------------------------------------------------- */

const IP_SELECT = `
  SELECT i.*, a.display_name AS asset_name, a.kind AS asset_kind
  FROM ip_addresses i LEFT JOIN assets a ON a.id = i.asset_id`;

export function listIps(subnetId?: number | "none"): IpAddress[] {
  const rows =
    subnetId === "none"
      ? all<IpAddress>(`${IP_SELECT} WHERE i.subnet_id IS NULL`)
      : subnetId
        ? all<IpAddress>(`${IP_SELECT} WHERE i.subnet_id = ?`, [subnetId])
        : all<IpAddress>(IP_SELECT);
  return rows.sort((a, b) => compareIp(a.address, b.address));
}

export function ipsForAsset(assetId: number): IpAddress[] {
  return all<IpAddress>(`${IP_SELECT} WHERE i.asset_id = ? ORDER BY i.is_primary DESC, i.id`, [assetId]);
}

export class IpConflictError extends Error {}

export function createIp(input: IpInput) {
  if (get("SELECT id FROM ip_addresses WHERE address = ?", [input.address])) {
    throw new IpConflictError("Cette adresse existe déjà dans l'IPAM");
  }
  const subnetId = input.subnet_id ?? findSubnetFor(input.address);
  const isPrimary = input.asset_id
    ? !get("SELECT id FROM ip_addresses WHERE asset_id = ? AND is_primary = 1", [input.asset_id])
    : false;
  const { lastId } = run(
    `INSERT INTO ip_addresses (address, subnet_id, asset_id, mac, hostname, status, is_primary, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.address, subnetId, input.asset_id, input.mac, input.hostname, input.status, isPrimary ? 1 : 0, input.description],
  );
  logActivity("ip", lastId, "create", `Attribution de ${input.address}`);
}

export function updateIp(id: number, input: IpInput) {
  const dup = get<{ id: number }>("SELECT id FROM ip_addresses WHERE address = ? AND id != ?", [input.address, id]);
  if (dup) throw new IpConflictError("Cette adresse existe déjà dans l'IPAM");
  const subnetId = input.subnet_id ?? findSubnetFor(input.address);
  run(
    `UPDATE ip_addresses SET address = ?, subnet_id = ?, asset_id = ?, mac = ?, hostname = ?, status = ?,
       description = ?, is_primary = CASE WHEN ? IS NULL THEN 0 ELSE is_primary END, updated_at = datetime('now') WHERE id = ?`,
    [input.address, subnetId, input.asset_id, input.mac, input.hostname, input.status, input.description, input.asset_id, id],
  );
  logActivity("ip", id, "update", `Modification de ${input.address}`);
}

export function deleteIp(id: number) {
  const ip = get<{ address: string }>("SELECT address FROM ip_addresses WHERE id = ?", [id]);
  run("DELETE FROM ip_addresses WHERE id = ?", [id]);
  if (ip) logActivity("ip", id, "delete", `Libération de ${ip.address}`);
}

export function setPrimaryIp(id: number) {
  const ip = get<{ asset_id: number | null }>("SELECT asset_id FROM ip_addresses WHERE id = ?", [id]);
  if (!ip?.asset_id) return;
  run("UPDATE ip_addresses SET is_primary = 0 WHERE asset_id = ?", [ip.asset_id]);
  run("UPDATE ip_addresses SET is_primary = 1 WHERE id = ?", [id]);
}

/** Première adresse libre du sous-réseau (hors passerelle et plage DHCP). */
export function nextFreeIp(subnetId: number): string | null {
  const s = getSubnet(subnetId);
  const c = s && parseCidr(s.cidr);
  if (!s || !c) return null;
  const taken = new Set(
    all<{ address: string }>("SELECT address FROM ip_addresses WHERE subnet_id = ? AND status != 'free'", [subnetId]).map(
      (r) => ipToInt(r.address),
    ),
  );
  const gw = ipToInt(s.gateway);
  const ds = ipToInt(s.dhcp_start);
  const de = ipToInt(s.dhcp_end);
  for (let n = c.first; n <= c.last; n++) {
    if (taken.has(n) || n === gw) continue;
    if (ds !== null && de !== null && n >= ds && n <= de) continue;
    return intToIp(n);
  }
  return null;
}

export function ipamTotals() {
  const subnets = listSubnets();
  const capacity = subnets.reduce((n, s) => n + s.capacity, 0);
  const used = subnets.reduce((n, s) => n + s.used + s.reserved + s.dhcp, 0);
  const vlans = get<{ n: number }>("SELECT COUNT(*) AS n FROM vlans")!.n;
  return { subnets: subnets.length, vlans, capacity, used };
}
