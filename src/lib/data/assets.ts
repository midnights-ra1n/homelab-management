import "server-only";
import { all, get, run, transaction } from "../db";
import type { AssetKind, AssetStatus } from "../constants";
import { parseJson } from "../utils";
import type { AssetInput } from "../validation";
import { logActivity } from "./activity";

export type Disk = { name: string; type: string; capacity_gb: number | null; usage: string };
export type Nic = { name: string; mac: string; speed: string };

type AssetRow = Omit<Asset, "tags" | "disks" | "nics"> & { tags: string; disks: string; nics: string };

export type Asset = {
  id: number;
  kind: AssetKind;
  display_name: string;
  hostname: string;
  status: AssetStatus;
  role: string;
  description: string;
  tags: string[];
  parent_id: number | null;
  os: string;
  os_version: string;
  location: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  cpu_model: string;
  cpu_sockets: number | null;
  cpu_cores: number | null;
  cpu_threads: number | null;
  ram_gb: number | null;
  ram_type: string;
  gpu: string;
  disks: Disk[];
  nics: Nic[];
  power_watts: number | null;
  management_url: string;
  docker_image: string;
  docker_ports: string;
  docker_compose: string;
  proxmox_integration_id: number | null;
  proxmox_node: string;
  proxmox_vmid: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
  // Jointures
  parent_name: string | null;
  parent_kind: AssetKind | null;
  primary_ip: string | null;
  primary_mac: string | null;
  subnet_id: number | null;
  subnet_name: string | null;
  subnet_cidr: string | null;
  vlan_number: number | null;
  vlan_name: string | null;
  children_count: number;
};

const SELECT = `
  SELECT a.*,
    p.display_name AS parent_name, p.kind AS parent_kind,
    ip.address AS primary_ip, ip.mac AS primary_mac,
    s.id AS subnet_id, s.name AS subnet_name, s.cidr AS subnet_cidr,
    v.vlan_id AS vlan_number, v.name AS vlan_name,
    (SELECT COUNT(*) FROM assets c WHERE c.parent_id = a.id) AS children_count
  FROM assets a
  LEFT JOIN assets p ON p.id = a.parent_id
  LEFT JOIN ip_addresses ip ON ip.id = (
    SELECT id FROM ip_addresses WHERE asset_id = a.id ORDER BY is_primary DESC, id LIMIT 1)
  LEFT JOIN subnets s ON s.id = ip.subnet_id
  LEFT JOIN vlans v ON v.id = s.vlan_id
`;

function hydrate(row: AssetRow): Asset {
  return {
    ...row,
    tags: parseJson<string[]>(row.tags, []),
    disks: parseJson<Disk[]>(row.disks, []),
    nics: parseJson<Nic[]>(row.nics, []),
  };
}

export type AssetFilters = { kind?: string; status?: string; q?: string; tag?: string; vlan?: string };

export function listAssets(filters: AssetFilters = {}): Asset[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.kind) {
    where.push("a.kind = ?");
    params.push(filters.kind);
  }
  if (filters.status) {
    where.push("a.status = ?");
    params.push(filters.status);
  }
  if (filters.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(a.tags) WHERE value = ?)");
    params.push(filters.tag);
  }
  if (filters.vlan) {
    where.push("v.vlan_id = ?");
    params.push(Number(filters.vlan));
  }
  if (filters.q) {
    where.push(
      "(a.display_name LIKE ? OR a.hostname LIKE ? OR a.role LIKE ? OR a.os LIKE ? OR ip.address LIKE ? OR a.tags LIKE ? OR a.model LIKE ?)",
    );
    const like = `%${filters.q}%`;
    params.push(like, like, like, like, like, like, like);
  }
  const sql = `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY
    CASE a.kind WHEN 'network' THEN 0 WHEN 'physical' THEN 1 WHEN 'vm' THEN 2 WHEN 'lxc' THEN 3 WHEN 'docker' THEN 4 ELSE 5 END,
    a.display_name COLLATE NOCASE`;
  return all<AssetRow>(sql, params).map(hydrate);
}

export function getAsset(id: number): Asset | undefined {
  const row = get<AssetRow>(`${SELECT} WHERE a.id = ?`, [id]);
  return row ? hydrate(row) : undefined;
}

export function childrenOf(id: number): Asset[] {
  return all<AssetRow>(`${SELECT} WHERE a.parent_id = ? ORDER BY a.kind, a.display_name COLLATE NOCASE`, [id]).map(
    hydrate,
  );
}

export type AssetOption = { id: number; display_name: string; kind: AssetKind; hostname: string };

export function assetOptions(kinds?: AssetKind[]): AssetOption[] {
  const filter = kinds?.length ? `WHERE kind IN (${kinds.map(() => "?").join(",")})` : "";
  return all<AssetOption>(
    `SELECT id, display_name, kind, hostname FROM assets ${filter} ORDER BY display_name COLLATE NOCASE`,
    kinds ?? [],
  );
}

export function allTags(): { tag: string; count: number }[] {
  return all(
    `SELECT value AS tag, COUNT(*) AS count FROM assets, json_each(assets.tags)
     GROUP BY value ORDER BY count DESC, value`,
  );
}

export function assetCounts() {
  const rows = all<{ kind: AssetKind; status: AssetStatus; n: number }>(
    "SELECT kind, status, COUNT(*) AS n FROM assets GROUP BY kind, status",
  );
  const byKind: Partial<Record<AssetKind, number>> = {};
  const byStatus: Partial<Record<AssetStatus, number>> = {};
  let total = 0;
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + r.n;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
    total += r.n;
  }
  return { total, byKind, byStatus };
}

/** Capacité matérielle cumulée des serveurs physiques en service. */
export function hardwareTotals() {
  return get<{ servers: number; cores: number; threads: number; ram_gb: number; watts: number }>(
    `SELECT COUNT(*) AS servers, COALESCE(SUM(cpu_cores),0) AS cores, COALESCE(SUM(cpu_threads),0) AS threads,
       COALESCE(SUM(ram_gb),0) AS ram_gb, COALESCE(SUM(power_watts),0) AS watts
     FROM assets WHERE kind = 'physical' AND status != 'decommissioned'`,
  )!;
}

export function storageTotalGb(): number {
  return (
    get<{ total: number }>(
      `SELECT COALESCE(SUM(json_extract(d.value, '$.capacity_gb')), 0) AS total
       FROM assets a, json_each(a.disks) d WHERE a.kind = 'physical' AND a.status != 'decommissioned'`,
    )?.total ?? 0
  );
}

/* ------------------------------------------------------------------------- */

function columns(input: AssetInput) {
  return {
    kind: input.kind,
    display_name: input.display_name,
    hostname: input.hostname,
    status: input.status,
    role: input.role,
    description: input.description,
    tags: JSON.stringify(input.tags),
    parent_id: input.parent_id,
    os: input.os,
    os_version: input.os_version,
    location: input.location,
    manufacturer: input.manufacturer,
    model: input.model,
    serial_number: input.serial_number,
    cpu_model: input.cpu_model,
    cpu_sockets: input.cpu_sockets,
    cpu_cores: input.cpu_cores,
    cpu_threads: input.cpu_threads,
    ram_gb: input.ram_gb,
    ram_type: input.ram_type,
    gpu: input.gpu,
    disks: JSON.stringify(input.disks),
    nics: JSON.stringify(input.nics),
    power_watts: input.power_watts,
    management_url: input.management_url,
    docker_image: input.docker_image,
    docker_ports: input.docker_ports,
    docker_compose: input.docker_compose,
    proxmox_integration_id: input.proxmox_integration_id,
    proxmox_node: input.proxmox_node,
    proxmox_vmid: input.proxmox_vmid,
    notes: input.notes,
  };
}

export class AssetError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}

/** Crée / met à jour / supprime l'IP principale liée à l'actif. */
function syncPrimaryIp(assetId: number, input: AssetInput) {
  const current = get<{ id: number; address: string }>(
    "SELECT id, address FROM ip_addresses WHERE asset_id = ? AND is_primary = 1",
    [assetId],
  );
  if (!input.primary_ip) {
    if (current) run("DELETE FROM ip_addresses WHERE id = ?", [current.id]);
    return;
  }
  const taken = get<{ id: number; asset_id: number | null }>(
    "SELECT id, asset_id FROM ip_addresses WHERE address = ?",
    [input.primary_ip],
  );
  if (taken && taken.id !== current?.id) {
    if (taken.asset_id && taken.asset_id !== assetId) {
      throw new AssetError("primary_ip", "Cette adresse est déjà attribuée à un autre élément");
    }
    // Adresse réservée / libre dans l'IPAM : on se l'approprie
    if (current) run("DELETE FROM ip_addresses WHERE id = ?", [current.id]);
    run(
      `UPDATE ip_addresses SET asset_id = ?, is_primary = 1, status = 'used', subnet_id = COALESCE(?, subnet_id),
       mac = ?, hostname = ?, updated_at = datetime('now') WHERE id = ?`,
      [assetId, input.primary_subnet_id, input.primary_mac, input.hostname, taken.id],
    );
    return;
  }
  if (current) {
    run(
      `UPDATE ip_addresses SET address = ?, subnet_id = ?, mac = ?, hostname = ?, updated_at = datetime('now') WHERE id = ?`,
      [input.primary_ip, input.primary_subnet_id, input.primary_mac, input.hostname, current.id],
    );
  } else {
    run(
      `INSERT INTO ip_addresses (address, subnet_id, asset_id, mac, hostname, status, is_primary)
       VALUES (?, ?, ?, ?, ?, 'used', 1)`,
      [input.primary_ip, input.primary_subnet_id, assetId, input.primary_mac, input.hostname],
    );
  }
}

export function createAsset(input: AssetInput): number {
  return transaction(() => {
    const cols = columns(input);
    const keys = Object.keys(cols);
    const { lastId } = run(
      `INSERT INTO assets (${keys.join(",")}) VALUES (${keys.map((k) => ":" + k).join(",")})`,
      cols,
    );
    syncPrimaryIp(lastId, input);
    logActivity("asset", lastId, "create", `Ajout de « ${input.display_name} » à l'inventaire`);
    return lastId;
  });
}

export function updateAsset(id: number, input: AssetInput) {
  if (input.parent_id === id) throw new AssetError("parent_id", "Un élément ne peut pas être son propre hôte");
  transaction(() => {
    const cols = columns(input);
    run(
      `UPDATE assets SET ${Object.keys(cols)
        .map((k) => `${k} = :${k}`)
        .join(", ")}, updated_at = datetime('now') WHERE id = :id`,
      { ...cols, id },
    );
    syncPrimaryIp(id, input);
    logActivity("asset", id, "update", `Modification de « ${input.display_name} »`);
  });
}

export function setAssetStatus(id: number, status: AssetStatus) {
  run("UPDATE assets SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, id]);
}

export function deleteAsset(id: number) {
  const asset = get<{ display_name: string }>("SELECT display_name FROM assets WHERE id = ?", [id]);
  if (!asset) return;
  run("DELETE FROM assets WHERE id = ?", [id]);
  logActivity("asset", id, "delete", `Suppression de « ${asset.display_name} »`);
}

export function duplicateAsset(id: number): number | null {
  const a = getAsset(id);
  if (!a) return null;
  return transaction(() => {
    const cols = columns({
      ...a,
      display_name: `${a.display_name} (copie)`,
      hostname: a.hostname ? `${a.hostname}-copie` : "",
      primary_ip: "",
      primary_subnet_id: null,
      primary_mac: "",
    } as AssetInput);
    const keys = Object.keys(cols);
    const { lastId } = run(
      `INSERT INTO assets (${keys.join(",")}) VALUES (${keys.map((k) => ":" + k).join(",")})`,
      cols,
    );
    logActivity("asset", lastId, "create", `Duplication de « ${a.display_name} »`);
    return lastId;
  });
}

/** Importe / met à jour un invité Proxmox dans l'inventaire. Retourne true si créé. */
export function upsertProxmoxGuest(g: {
  integrationId: number;
  node: string;
  vmid: number;
  kind: "vm" | "lxc";
  name: string;
  running: boolean;
  cores: number | null;
  ramGb: number | null;
  diskGb: number | null;
  tags: string[];
  parentId: number | null;
}): boolean {
  const existing = get<{ id: number }>(
    "SELECT id FROM assets WHERE proxmox_integration_id = ? AND proxmox_vmid = ?",
    [g.integrationId, g.vmid],
  );
  const status = g.running ? "online" : "offline";
  if (existing) {
    run(
      `UPDATE assets SET proxmox_node = ?, status = CASE WHEN status IN ('maintenance','decommissioned') THEN status ELSE ? END,
         cpu_cores = COALESCE(?, cpu_cores), ram_gb = COALESCE(?, ram_gb),
         parent_id = COALESCE(parent_id, ?), updated_at = datetime('now') WHERE id = ?`,
      [g.node, status, g.cores, g.ramGb, g.parentId, existing.id],
    );
    return false;
  }
  const disks = g.diskGb ? [{ name: "rootfs", type: "virtual", capacity_gb: g.diskGb, usage: "" }] : [];
  const { lastId } = run(
    `INSERT INTO assets (kind, display_name, hostname, status, tags, parent_id, cpu_cores, ram_gb, disks,
       proxmox_integration_id, proxmox_node, proxmox_vmid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      g.kind,
      g.name,
      g.name.toLowerCase().replace(/[^a-z0-9.-]/g, "-"),
      status,
      JSON.stringify(g.tags),
      g.parentId,
      g.cores,
      g.ramGb,
      JSON.stringify(disks),
      g.integrationId,
      g.node,
      g.vmid,
    ],
  );
  logActivity("asset", lastId, "create", `Import Proxmox de « ${g.name} » (${g.vmid})`);
  return true;
}
