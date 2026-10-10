import "server-only";
import { assetOptions } from "@/lib/data/assets";
import { subnetOptions } from "@/lib/data/network";
import { listIntegrations } from "@/lib/data/integrations";

/** Données de référence pour le formulaire d'inventaire. */
export function assetFormOptions() {
  return {
    parents: assetOptions(["physical", "vm", "lxc", "network", "other"]),
    subnets: subnetOptions(),
    proxmox: listIntegrations("proxmox").map((i) => ({ id: i.id, name: i.name })),
  };
}
