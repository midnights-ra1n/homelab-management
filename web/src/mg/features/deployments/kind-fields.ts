import type { AssetKind, DeploymentKind } from "@/lib/constants";

/** Ce que chaque type de déploiement demande : où il tourne, son identifiant et ce qu'il consomme. */
export const KIND_FIELDS: Record<
  DeploymentKind,
  { host?: { label: string; kinds: AssetKind[] }; id?: string; cpu?: string; disk?: string; stock?: boolean; help: string }
> = {
  physical: {
    stock: true,
    cpu: "Cœurs",
    disk: "Stockage (Go)",
    help: "Une machine du stock matériel : ses composants donnent la mémoire et le stockage.",
  },
  vm: {
    host: { label: "Hyperviseur", kinds: ["physical"] },
    id: "VMID",
    cpu: "vCPU",
    disk: "Disque virtuel (Go)",
    help: "Ressources réservées sur l'hyperviseur.",
  },
  lxc: {
    host: { label: "Nœud Proxmox", kinds: ["physical"] },
    id: "CTID",
    cpu: "Cœurs",
    disk: "Disque racine (Go)",
    help: "Ressources allouées au conteneur sur le nœud.",
  },
  docker: {
    host: { label: "Hôte Docker", kinds: ["physical", "vm", "lxc"] },
    help: "Un conteneur partage les ressources de son hôte : pas de réservation propre.",
  },
  application: {
    host: { label: "Serveur", kinds: ["physical", "vm", "lxc", "docker"] },
    help: "Une application tourne sur un serveur existant et en partage les ressources.",
  },
  other: {
    host: { label: "Hôte", kinds: ["physical", "vm", "lxc", "network", "other"] },
    id: "ID",
    cpu: "CPU / cœurs",
    disk: "Disque (Go)",
    help: "Où il sera déployé et ce qu'il consommera.",
  },
};
