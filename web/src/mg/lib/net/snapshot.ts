import { networkData } from "../data/network";
import { resource } from "../resource";
import type { NetSnapshot } from "./engine";

/** IPAM snapshot for the network engine, which runs in the browser. */
export const loadSnapshot = () =>
  resource("net:snapshot", () =>
    networkData().then(
      (d): NetSnapshot => ({
        subnets: d.subnets,
        ips: d.ips,
        assets: d.assets,
        tunnels: d.tunnels,
        rules: d.rules,
        defaultPolicy: d.default_policy,
      }),
    ),
  );
