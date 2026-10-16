// Types of homelab-management's lib/data/network.ts + client fetchers.
import { get, qs } from "../client";
import { resource } from "../resource";
import type { VpnTunnel } from "./vpn";
import type { FirewallRule } from "./firewall";
import type { Domain } from "./domains";
import type { IpStatus, Tone } from "../constants";

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


/* ---------------------------------------------------------------- fetchers */

/** The whole IPAM in one request (the network page and the browser-side engine use it). */
export type NetworkData = {
  vlans: Vlan[];
  subnets: Subnet[];
  ips: (IpAddress & { asset_kind: string | null })[];
  assets: { id: number; display_name: string; hostname: string; kind: string; status: string; role: string; docker_ports: string }[];
  tunnels: VpnTunnel[];
  rules: FirewallRule[];
  domains: Domain[];
  subnet_options: { id: number; name: string; cidr: string; vlan_number: number | null }[];
  default_policy: "allow" | "deny";
};
export const networkData = () => get<NetworkData>("/api/mg/network");
const pick = <K extends keyof NetworkData>(k: K) => resource(`net:${k}`, () => networkData().then((d) => d[k]));

export const listVlans = () => pick("vlans");
export const listSubnets = () => pick("subnets");
export const subnetOptions = () => pick("subnet_options");
export const getSubnet = (id: number) => resource(`subnet:${id}`, () => listSubnets().then((l) => l.find((s) => s.id === id)));
export const listIps = (subnetId?: number | "none") => get<IpAddress[]>(`/api/mg/ips${qs({ subnet: subnetId })}`);
export const ipsForAsset = (assetId: number) =>
  resource(`ips:${assetId}`, () => get<{ ips: IpAddress[] }>(`/api/mg/assets/${assetId}`).then((d) => d.ips));
export const ipamTotals = () =>
  resource("net:totals", () =>
    networkData().then((d) => ({
      subnets: d.subnets.length,
      vlans: d.vlans.length,
      capacity: d.subnets.reduce((n, s) => n + s.capacity, 0),
      used: d.subnets.reduce((n, s) => n + s.used + s.reserved + s.dhcp, 0),
    })),
  );
