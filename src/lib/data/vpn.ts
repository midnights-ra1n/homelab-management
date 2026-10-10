import "server-only";
import { all, get, run } from "../db";
import type { VpnStatus, VpnType } from "../constants";
import { parseJson } from "../utils";
import type { VpnInput } from "../validation";
import { logActivity } from "./activity";

export type VpnTunnel = {
  id: number;
  name: string;
  type: VpnType;
  status: VpnStatus;
  endpoint_a_id: number | null;
  endpoint_a_name: string | null;
  endpoint_a_ip: string | null;
  endpoint_b_id: number | null;
  endpoint_b_name: string | null;
  endpoint_b_ip: string | null;
  endpoint_b_label: string;
  tunnel_cidr: string;
  ip_a: string;
  ip_b: string;
  routes_a: string[];
  routes_b: string[];
  listen_port: number | null;
  public_endpoint: string;
  notes: string;
  updated_at: string;
};

type Row = Omit<VpnTunnel, "routes_a" | "routes_b"> & { routes_a: string; routes_b: string };

const SELECT = `
  SELECT t.*,
    a.display_name AS endpoint_a_name,
    (SELECT address FROM ip_addresses WHERE asset_id = t.endpoint_a_id ORDER BY is_primary DESC, id LIMIT 1) AS endpoint_a_ip,
    b.display_name AS endpoint_b_name,
    (SELECT address FROM ip_addresses WHERE asset_id = t.endpoint_b_id ORDER BY is_primary DESC, id LIMIT 1) AS endpoint_b_ip
  FROM vpn_tunnels t
  LEFT JOIN assets a ON a.id = t.endpoint_a_id
  LEFT JOIN assets b ON b.id = t.endpoint_b_id`;

function hydrate(r: Row): VpnTunnel {
  return { ...r, routes_a: parseJson<string[]>(r.routes_a, []), routes_b: parseJson<string[]>(r.routes_b, []) };
}

export function listTunnels(): VpnTunnel[] {
  return all<Row>(`${SELECT} ORDER BY t.name COLLATE NOCASE`).map(hydrate);
}

export function getTunnel(id: number) {
  const r = get<Row>(`${SELECT} WHERE t.id = ?`, [id]);
  return r ? hydrate(r) : undefined;
}

function values(i: VpnInput) {
  return [
    i.name,
    i.type,
    i.status,
    i.endpoint_a_id,
    i.endpoint_b_id,
    i.endpoint_b_label,
    i.tunnel_cidr,
    i.ip_a,
    i.ip_b,
    JSON.stringify(i.routes_a),
    JSON.stringify(i.routes_b),
    i.listen_port,
    i.public_endpoint,
    i.notes,
  ];
}

export function createTunnel(i: VpnInput) {
  const { lastId } = run(
    `INSERT INTO vpn_tunnels (name, type, status, endpoint_a_id, endpoint_b_id, endpoint_b_label, tunnel_cidr, ip_a, ip_b,
       routes_a, routes_b, listen_port, public_endpoint, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values(i),
  );
  logActivity("vpn", lastId, "create", `Tunnel VPN « ${i.name} » ajouté`);
}

export function updateTunnel(id: number, i: VpnInput) {
  run(
    `UPDATE vpn_tunnels SET name = ?, type = ?, status = ?, endpoint_a_id = ?, endpoint_b_id = ?, endpoint_b_label = ?,
       tunnel_cidr = ?, ip_a = ?, ip_b = ?, routes_a = ?, routes_b = ?, listen_port = ?, public_endpoint = ?, notes = ?,
       updated_at = datetime('now') WHERE id = ?`,
    [...values(i), id],
  );
  logActivity("vpn", id, "update", `Tunnel VPN « ${i.name} » modifié`);
}

export function deleteTunnel(id: number) {
  const t = get<{ name: string }>("SELECT name FROM vpn_tunnels WHERE id = ?", [id]);
  run("DELETE FROM vpn_tunnels WHERE id = ?", [id]);
  if (t) logActivity("vpn", id, "delete", `Tunnel VPN « ${t.name} » supprimé`);
}
