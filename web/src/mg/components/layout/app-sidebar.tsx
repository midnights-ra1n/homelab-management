
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, Search, Settings } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { isRail, subscribeTheme, toggleRail } from "@/lib/theme";
import { openSearch } from "./command-palette";
import { Logo } from "./logo";
import { NAV_SECTIONS, isActive, type NavItem } from "./nav-items";
import { usePathname, useT } from "@/i18n/client";
import { useSession } from "@/session";
import { ArrowUpRight } from "lucide-react";

/**
 * Barre latérale de la charte (.mm-sidebar) : 248 px, rail 64 px (tablette ou replié, :root[data-sidebar="rail"]),
 * masquée sous 640 px au profit de la barre basse. Pied fixe : Paramètres puis compte.
 */
export function AppSidebar({ userSlot }: { userSlot: ReactNode }) {
  const tr = useT();
  const pathname = usePathname();
  return (
    <aside className="mm-sidebar" aria-label={tr("Navigation principale")}>
      <SideHead />
      <nav className="mm-sidebar__nav">
        <button type="button" onClick={openSearch} title={tr("Rechercher (⌘K)")} className="mm-nav-item">
          <Search size={16} aria-hidden="true" className="shrink-0" />
          <span className="mm-nav-item__label">{tr("Rechercher")}</span>
          <kbd className="mm-nav-item__count font-mono">⌘K</kbd>
        </button>
        {NAV_SECTIONS.map((section, i) => (
          <div key={i} className="mm-sidebar__section">
            {section.label && <div className="mm-label-caps">{tr(section.label)}</div>}
            {section.items.map((item) => (
              <SideLink key={item.href} item={item} active={isActive(pathname, item.href)} />
            ))}
            {i === 0 && <MonitoringLink />}
          </div>
        ))}
      </nav>
      <div className="mm-sidebar__foot">
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
      <item.icon size={16} aria-hidden="true" className="shrink-0" />
      <span className="mm-nav-item__label">{label}</span>
    </Link>
  );
}

function SideHead() {
  const tr = useT();
  const VERSION = useSession().version;
  const rail = useSyncExternalStore(subscribeTheme, isRail, () => false);
  const version = /^\d/.test(VERSION) ? `v${VERSION}` : VERSION;
  const label = rail ? tr("Déplier la barre latérale") : tr("Replier la barre latérale");
  return (
    <div className="mm-sidebar__head">
      <Link href="/" aria-label={tr("Tableau de bord")} className="mm-sidebar__brand">
        <span className="flex size-6 shrink-0 items-center justify-center [&_svg]:h-6">
          <Logo compact />
        </span>
        <span className="grid min-w-0 leading-none">
          <span>Homelab</span>
          <span className="mt-1 flex items-baseline gap-1.5 text-[11px] font-medium text-meta">
            Management
            <span className="font-mono font-normal text-accent-text tabular-nums">{version}</span>
          </span>
        </span>
      </Link>
      <button type="button" onClick={toggleRail} aria-label={label} title={label} className="mm-btn mm-btn--ghost mm-btn--sm mm-btn--icon mm-sidebar__collapse">
        {rail ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

/** Shortcut to the monitoring instance (first Homelab Monitoring integration). */
export function MonitoringLink() {
  const { monitoringUrl } = useSession();
  if (!monitoringUrl) return null;
  return (
    <a href={monitoringUrl} target="_blank" rel="noopener" title="Ouvrir le tableau de bord du monitoring" className="mm-nav-item">
      <ArrowUpRight size={16} aria-hidden="true" className="shrink-0" />
      <span className="mm-nav-item__label">Ouvrir le monitoring</span>
    </a>
  );
}

/** Rendu statique avant que le chemin courant ne soit connu : même gabarit, sans navigation. */
export function AppSidebarFallback() {
  return <aside className="mm-sidebar" />;
}
