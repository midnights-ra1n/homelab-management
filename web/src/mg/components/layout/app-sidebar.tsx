
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, Search, Settings } from "../../../shared/icons";
import { useSyncExternalStore, type ReactNode } from "react";
import { isRail, subscribeTheme, toggleRail } from "@/lib/theme";
import { openSearch } from "./command-palette";
import { Logo } from "./logo";
import { NAV_SECTIONS, NAV_TABS, isActive, type NavItem } from "./nav-items";
import { usePathname, useT } from "@/i18n/client";
import { IconButton, SEARCH_KEY, navActive } from "../../../ui";
import { NotificationsButton } from "../alert-banner";

/**
 * Barre latérale de la charte (.mm-sidebar) : 264 px, rail 76 px (tablette ou replié, :root[data-sidebar="rail"]),
 * masquée sous 640 px au profit de la barre basse. Pied fixe : Notifications, Paramètres puis compte.
 */
export function AppSidebar({ userSlot }: { userSlot: ReactNode }) {
  const tr = useT();
  const pathname = usePathname();
  return (
    <aside className="mm-sidebar" aria-label={tr("Navigation principale")}>
      <SideHead />
      <nav className="mm-sidebar__nav">
        {NAV_SECTIONS.map((section, i) => (
          <div key={i} className="mm-sidebar__section">
            {section.label && <div className="mm-label-caps">{tr(section.label)}</div>}
            {section.items.map((item) => (
              <SideLink key={item.href} item={item} active={navActive(pathname, item.href, NAV_TABS)} />
            ))}
          </div>
        ))}
      </nav>
      <div className="mm-sidebar__foot">
        <NotificationsButton />
        <SideLink item={{ href: "/parametres", label: "Paramètres", short: "", icon: Settings }} active={isActive(pathname, "/parametres")} />
        {userSlot}
      </div>
    </aside>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const tr = useT();
  const label = tr(item.label);
  return (
    <Link href={item.href} title={label} aria-current={active ? "page" : undefined} className="mm-nav-item">
      <item.icon size={20} aria-hidden="true" className="shrink-0" />
      <span className="mm-nav-item__label">{label}</span>
    </Link>
  );
}

function SideHead() {
  const tr = useT();
  const rail = useSyncExternalStore(subscribeTheme, isRail, () => false);
  const label = rail ? tr("Déplier la barre latérale") : tr("Replier la barre latérale");
  return (
    <div className="mm-sidebar__head">
      <Link href="/" aria-label={tr("Tableau de bord")} className="mm-sidebar__brand">
        <span className="flex size-6 shrink-0 items-center justify-center [&_svg]:h-6">
          <Logo compact />
        </span>
        <span className="grid min-w-0 leading-none">
          <span className="uppercase">Midnights</span>
          <span className="mt-1 text-xs font-medium text-meta">Management</span>
        </span>
      </Link>
      <span className="flex shrink-0 items-center gap-1 [:root[data-sidebar=rail]_&]:flex-col">
        <IconButton label={`${tr("Rechercher")} (${SEARCH_KEY})`} title={`${tr("Rechercher")} (${SEARCH_KEY})`} icon={<Search size={18} />} onClick={openSearch} />
        <IconButton label={label} title={label} icon={rail ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />} onClick={toggleRail} className="mm-sidebar__collapse" />
      </span>
    </div>
  );
}

/** Rendu statique avant que le chemin courant ne soit connu : même gabarit, sans navigation. */
export function AppSidebarFallback() {
  return <aside className="mm-sidebar" />;
}
