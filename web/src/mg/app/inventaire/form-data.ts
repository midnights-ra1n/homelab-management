import { use } from "react";
import { allTags, assetOptions } from "@/lib/data/assets";
import { subnetOptions } from "@/lib/data/network";
import { listIntegrations } from "@/lib/data/integrations";

/** Données de référence pour le formulaire d'inventaire. */
export function assetFormOptions() {
  return {
    parents: use(assetOptions(["physical", "vm", "lxc", "network", "other"])),
    subnets: use(subnetOptions()),
    proxmox: use(listIntegrations("proxmox")).map((i) => ({ id: i.id, name: i.name })),
    tags: use(allTags()).map((t) => t.tag),
  };
}
