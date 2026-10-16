import { use } from "react";
import { assetOptions } from "@/lib/data/assets";
import { subnetOptions } from "@/lib/data/network";

export function deploymentFormOptions() {
  return {
    hosts: use(assetOptions(["physical", "vm", "lxc", "other"])),
    assets: use(assetOptions()),
    subnets: use(subnetOptions()),
  };
}
