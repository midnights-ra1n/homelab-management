import "server-only";
import { assetOptions } from "@/lib/data/assets";
import { subnetOptions } from "@/lib/data/network";

export function deploymentFormOptions() {
  return {
    hosts: assetOptions(["physical", "vm", "lxc", "other"]),
    assets: assetOptions(),
    subnets: subnetOptions(),
  };
}
