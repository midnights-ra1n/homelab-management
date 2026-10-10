import "server-only";
import { all } from "../db";
import { listSubnets } from "../data/network";
import { listTunnels } from "../data/vpn";
import { listRules } from "../data/firewall";
import { defaultFirewallPolicy } from "../data/settings";
import type { NetAsset, NetIp, NetSnapshot } from "./engine";

/** Instantané de l'IPAM pour le moteur réseau. */
export function loadSnapshot(): NetSnapshot {
  return {
    subnets: listSubnets().map((s) => ({
      id: s.id,
      name: s.name,
      cidr: s.cidr,
      gateway: s.gateway,
      dhcp_start: s.dhcp_start,
      dhcp_end: s.dhcp_end,
      vlan_id: s.vlan_id,
      vlan_number: s.vlan_number,
      vlan_name: s.vlan_name,
      used: s.used,
      reserved: s.reserved,
      dhcp: s.dhcp,
      capacity: s.capacity,
    })),
    ips: all<NetIp>(
      `SELECT i.id, i.address, i.subnet_id, i.asset_id, a.display_name AS asset_name, i.mac, i.status
       FROM ip_addresses i LEFT JOIN assets a ON a.id = i.asset_id ORDER BY i.is_primary DESC, i.id`,
    ),
    assets: all<NetAsset>("SELECT id, display_name, hostname, kind, status, role, docker_ports FROM assets"),
    tunnels: listTunnels(),
    rules: listRules(),
    defaultPolicy: defaultFirewallPolicy(),
  };
}
