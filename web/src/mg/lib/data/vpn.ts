// Types of homelab-management's lib/data/vpn.ts + client fetchers.
import { resource } from "../resource";
import { networkData } from "./network";
import type { VpnStatus, VpnType } from "../constants";

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



export const listTunnels = () => resource("net:tunnels", () => networkData().then((d) => d.tunnels as VpnTunnel[]));
