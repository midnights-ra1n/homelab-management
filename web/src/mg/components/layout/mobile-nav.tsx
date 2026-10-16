
import Link from "next/link";
import { Ellipsis, Search, Settings, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { openSearch } from "./command-palette";
import { MOBILE_TABS, NAV_ITEMS, isActive, type NavItem } from "./nav-items";
import { usePathname, useT } from "@/i18n/client";

/**
 * Mobile (< 640 px) : barre basse de la charte (.mm-bottomnav), 4 entrées + « Plus »
 * qui ouvre une feuille avec les autres pages, Paramètres et le compte.
 */
export function MobileNav({ accountSlot }: { accountSlot: ReactNode }) {
  const tr = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const tabs = NAV_ITEMS.filter((i) => MOBILE_TABS.includes(i.href));
  const more: NavItem[] = [...NAV_ITEMS.filter((i) => !MOBILE_TABS.includes(i.href)), { href: "/parametres", label: "Paramètres", short: "Paramètres", icon: Settings }];
  const moreActive = more.some((i) => isActive(pathname, i.href));

  return (
    <>
      {open && <div className="mm-sheet-scrim sm:hidden" onClick={() => setOpen(false)} aria-hidden />}
      {open && (
        <div className="mm-sheet sm:hidden" role="dialog" aria-modal="true" aria-label={tr("Plus")}>
          <div className="mm-sheet__grip" aria-hidden="true" />
          <button
            type="button"
            className="mm-nav-item"
            onClick={() => {
              setOpen(false);
              openSearch();
            }}
          >
            <Search size={20} aria-hidden="true" className="shrink-0" />
            <span className="mm-nav-item__label">{tr("Rechercher")}</span>
          </button>
          {more.map((item) => (
            <Link key={item.href} href={item.href} className="mm-nav-item" aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              <item.icon size={20} aria-hidden="true" className="shrink-0" />
              <span className="mm-nav-item__label">{tr(item.label)}</span>
            </Link>
          ))}
          <div className="mm-sheet__sep" />
          {accountSlot}
        </div>
      )}
      <nav className="mm-bottomnav" aria-label={tr("Navigation principale")}>
        {tabs.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="mm-bottomnav__item"
            aria-current={isActive(pathname, item.href) && !open ? "page" : undefined}
          >
            <span className="mm-bottomnav__pill">
              <item.icon size={22} aria-hidden="true" />
            </span>
            <span className="mm-bottomnav__label">{tr(item.short)}</span>
          </Link>
        ))}
        <button
          type="button"
          className="mm-bottomnav__item"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-current={moreActive && !open ? "page" : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="mm-bottomnav__pill">{open ? <X size={22} aria-hidden="true" /> : <Ellipsis size={22} aria-hidden="true" />}</span>
          <span className="mm-bottomnav__label">{tr("Plus")}</span>
        </button>
      </nav>
    </>
  );
}
