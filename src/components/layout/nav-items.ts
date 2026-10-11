import {
  Activity,
  AppWindow,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Network,
  Rocket,
  Server,
  Share2,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; short: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tableau de bord", short: "Accueil", icon: LayoutDashboard },
  { href: "/applications", label: "Applications", short: "Apps", icon: AppWindow },
  { href: "/inventaire", label: "Inventaire", short: "Inventaire", icon: Boxes },
  { href: "/reseau", label: "Réseau", short: "Réseau", icon: Network },
  { href: "/deploiements", label: "Déploiements", short: "Déploiements", icon: Rocket },
  { href: "/taches", label: "Tâches", short: "Tâches", icon: ClipboardList },
  { href: "/carte", label: "Carte", short: "Carte", icon: Share2 },
  { href: "/proxmox", label: "Proxmox", short: "Proxmox", icon: Server },
  { href: "/webmin", label: "Webmin", short: "Webmin", icon: SquareTerminal },
  { href: "/monitoring", label: "Monitoring", short: "Monitoring", icon: Activity },
];

/** Onglets principaux de la barre mobile (le reste est dans « Plus »). */
export const MOBILE_TABS = ["/", "/applications", "/inventaire", "/deploiements"];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}
