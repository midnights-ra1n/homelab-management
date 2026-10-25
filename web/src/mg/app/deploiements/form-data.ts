import { use } from "react";
import { assetOptions } from "@/lib/data/assets";
import { subnetOptions } from "@/lib/data/network";
import { listHardware } from "@/lib/data/hardware";

export function deploymentFormOptions() {
  return {
    assets: use(assetOptions()),
    hardware: use(listHardware()),
    subnets: use(subnetOptions()),
  };
}
