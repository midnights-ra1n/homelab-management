import {
  Activity,
  AppWindow,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Network,
  Plug,
  Rocket,
  Server,
  Share2,
  Warehouse,
  ScrollText,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; short: string; icon: LucideIcon; description?: string };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tableau de bord", short: "Accueil", icon: LayoutDashboard },
  { href: "/applications", label: "Applications", short: "Apps", icon: AppWindow },
  { href: "/inventaire", label: "Inventaire", short: "Inventaire", icon: Boxes, description: "Serveurs, VM, conteneurs et équipements" },
  { href: "/stock", label: "Stock matériel", short: "Stock", icon: Warehouse, description: "Serveurs, PC, composants et leur état" },
  { href: "/reseau", label: "Réseau", short: "Réseau", icon: Network, description: "IPAM, VLAN, VPN et pare-feu" },
  { href: "/carte", label: "Carte", short: "Carte", icon: Share2, description: "Topologie interactive du homelab" },
  { href: "/deploiements", label: "Déploiements", short: "Déploiements", icon: Rocket, description: "Ce qui arrive et où ça en est" },
  { href: "/taches", label: "Tâches", short: "Tâches", icon: ClipboardList, description: "Kanban de maintenance et d'idées" },
  { href: "/proxmox", label: "Proxmox", short: "Proxmox", icon: Server, description: "Nœuds, invités et migrations" },
  { href: "/webmin", label: "Webmin", short: "Webmin", icon: SquareTerminal, description: "Instances et état système via SSH" },
  { href: "/monitoring", label: "Monitoring", short: "Monitoring", icon: Activity },
  { href: "/energie", label: "Énergie", short: "Énergie", icon: Plug, description: "Consommation des prises Meross, via le monitoring" },
  { href: "/journaux", label: "Journaux", short: "Journaux", icon: ScrollText, description: "Tout ce qui a été fait, sur 90 jours" },
];

const byHref = (href: string) => NAV_ITEMS.find((i) => i.href === href)!;

/** Sections de la barre latérale (label en capitales ; la première n'en a pas). */
export type NavSection = { label?: string; items: NavItem[] };
export const NAV_SECTIONS: NavSection[] = [
  { items: ["/", "/applications", "/monitoring", "/energie"].map(byHref) },
  { label: "Infrastructure", items: ["/inventaire", "/stock", "/reseau", "/carte"].map(byHref) },
  { label: "Suivi", items: ["/deploiements", "/taches", "/journaux"].map(byHref) },
  { label: "Serveurs", items: ["/proxmox", "/webmin"].map(byHref) },
];

/** Onglets principaux de la barre mobile (le reste est dans « Plus »). */
export const MOBILE_TABS = ["/", "/applications", "/inventaire", "/deploiements"];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}
