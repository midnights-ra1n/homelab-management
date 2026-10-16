// Types of homelab-management's lib/data/firewall.ts + client fetchers.
import { resource } from "../resource";
import { networkData } from "./network";
import type { FwProtocol, FwTarget } from "../constants";

export type FirewallRule = {
  id: number;
  position: number;
  name: string;
  enabled: number;
  action: "allow" | "deny";
  src_type: FwTarget;
  src_value: string;
  dst_type: FwTarget;
  dst_value: string;
  protocol: FwProtocol;
  ports: string;
  notes: string;
};


export const listRules = () => resource("net:rules", () => networkData().then((d) => d.rules as FirewallRule[]));
