"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { NAV_DESKTOP, NAV_ITEMS, isActive, isGroup, type NavGroup, type NavItem } from "./nav-items";
import { useScrollVisibility } from "./use-scroll-visibility";
import { usePathname, useT } from "@/i18n/client";

/**
 * Navbar flottante en pilule, reprise du portfolio : séparateurs « • »,
 * entrées regroupées en sous-menus, indicateur unique qui glisse sous l'entrée active, masquage au défilement
 * (réapparition au survol du haut de l'écran), fondus d'entrée / de sortie.
 */
export function AppHeader({ userSlot }: { userSlot: ReactNode }) {
  const tr = useT();
  const pathname = usePathname();
  const { visible, forceShow, forceHide } = useScrollVisibility();
  const current = NAV_ITEMS.find((i) => isActive(pathname, i.href)) ?? (isActive(pathname, "/parametres") ? { label: tr("Paramètres") } : null);

  // Indicateur d'activité : positionné impérativement (dépend de la largeur réelle des liens)
  const listRef = useRef<HTMLUListElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const firstPlacement = useRef(true);

  useEffect(() => {
    const place = (animate: boolean) => {
      const list = listRef.current;
      const bar = indicatorRef.current;
      if (!list || !bar) return;
      const active = NAV_DESKTOP.find((e) => entryActive(e, pathname));
      const link = active ? list.querySelector<HTMLElement>(`[data-nav-key="${entryKey(active)}"] :is(a, button)`) : null;
      bar.style.transition = animate
        ? "transform 0.55s cubic-bezier(0.34, 1.25, 0.64, 1), width 0.55s cubic-bezier(0.34, 1.25, 0.64, 1), opacity 0.2s ease"
        : "none";
      if (!link) {
        bar.style.opacity = "0";
        return;
      }
      // Mesure relative à la liste (les <li> sont positionnés pour accueillir les sous-menus)
      const width = link.offsetWidth * 0.7;
      const x = link.getBoundingClientRect().left - list.getBoundingClientRect().left + (link.offsetWidth - width) / 2;
      bar.style.width = `${width}px`;
      bar.style.transform = `translateX(${x}px)`;
      bar.style.opacity = "1";
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    place(!firstPlacement.current && !reduced);
    firstPlacement.current = false;

    // Polices chargées / redimensionnement : recalage sans animation
    const list = listRef.current;
    if (!list) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      place(false);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <>
      <div aria-hidden className="fixed left-0 right-0 top-0 z-[60] h-4" onMouseEnter={forceShow} />

      <header
        className={cn(
          "fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] sm:top-[max(1.25rem,env(safe-area-inset-top))] z-50 w-full max-w-[84rem] -translate-x-1/2 px-3 sm:px-5",
          "transition-[translate,opacity]",
          visible
            ? "translate-y-0 opacity-100 duration-300 ease-out"
            : "pointer-events-none -translate-y-40 opacity-0 duration-700 ease-in-out",
        )}
        onMouseEnter={forceShow}
        onMouseLeave={forceHide}
      >
        <nav
          aria-label={tr("Navigation principale")}
          className="flex h-14 items-center justify-between rounded-full border border-line bg-page/95 px-5 backdrop-blur-md nav-glow sm:h-16 sm:px-6 xl:h-22 xl:bg-page xl:px-8"
        >
          <Link href="/" aria-label={tr("Tableau de bord")} className="flex shrink-0 items-center justify-center">
            <Logo />
          </Link>

          <ul ref={listRef} className="relative hidden items-center text-sm font-medium xl:flex 2xl:text-base">
            <span
              ref={indicatorRef}
              aria-hidden
              className="pointer-events-none absolute bottom-[2px] left-0 h-[2px] w-0 rounded-full bg-accent opacity-0"
            />
            {NAV_DESKTOP.map((entry, i) => (
              <li key={entryKey(entry)} data-nav-key={entryKey(entry)} className="relative flex items-center">
                {i > 0 && <span className="select-none px-2.5 text-xs text-meta 2xl:px-4">•</span>}
                {isGroup(entry) ? (
                  <NavMenu group={entry} pathname={pathname} />
                ) : (
                  <Link
                    href={entry.href}
                    aria-current={isActive(pathname, entry.href) ? "page" : undefined}
                    className="group relative whitespace-nowrap rounded-full px-3.5 py-2 2xl:px-4 transition-all duration-200"
                  >
                    <span className="absolute inset-0 rounded-full bg-[rgba(63,191,166,0.08)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                    <span className={cn("relative transition-colors duration-300 group-hover:text-h1", isActive(pathname, entry.href) ? "text-h1" : "text-body")}>
                      {tr(entry.label)}
                    </span>
                  </Link>
                )}
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-4">
            <div className="hidden xl:block">{userSlot}</div>
            {current && (
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-accent-text xl:hidden">{tr(current.label)}</span>
            )}
          </div>
        </nav>
      </header>
    </>
  );
}

/** Rendu statique (pré-rendu) avant que le chemin courant ne soit connu. */
export function AppHeaderFallback() {
  const tr = useT();
  return (
    <header className="fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] sm:top-[max(1.25rem,env(safe-area-inset-top))] z-50 w-full max-w-[84rem] -translate-x-1/2 px-3 sm:px-5">
      <nav
        aria-label={tr("Navigation principale")}
        className="flex h-14 items-center justify-between rounded-full border border-line bg-page px-5 nav-glow sm:h-16 sm:px-6 xl:h-22 xl:px-8"
      >
        <Link href="/" aria-label={tr("Tableau de bord")} className="shrink-0">
          <Logo />
        </Link>
        <ul className="hidden items-center text-sm font-medium xl:flex 2xl:text-base">
          {NAV_DESKTOP.map((entry, i) => (
            <li key={entryKey(entry)} className="flex items-center">
              {i > 0 && <span className="select-none px-2.5 text-xs text-meta 2xl:px-4">•</span>}
              <span className="flex items-center gap-1 whitespace-nowrap px-3.5 py-2 text-body 2xl:px-4">
                {tr(entry.label)}
                {isGroup(entry) && <ChevronDown size={14} aria-hidden="true" className="text-meta" />}
              </span>
            </li>
          ))}
        </ul>
        <span className="h-10 w-10" />
      </nav>
    </header>
  );
}

const entryKey = (e: NavItem | NavGroup) => (isGroup(e) ? e.id : e.href);
const entryActive = (e: NavItem | NavGroup, pathname: string) =>
  isGroup(e) ? e.items.some((i) => isActive(pathname, i.href)) : isActive(pathname, e.href);

/** Sous-menu : survol (avec délai de fermeture) ou clic / clavier ; Échap et clic extérieur ferment. */
function NavMenu({ group, pathname }: { group: NavGroup; pathname: string }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panelId = useId();
  const active = group.items.some((i) => isActive(pathname, i.href));

  // Navigation : le menu se referme (ajustement d'état pendant le rendu, sans effet)
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const show = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  return (
    <div
      ref={ref}
      className="contents"
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
      onBlur={(e) => !ref.current?.contains(e.relatedTarget as Node) && setOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => document.getElementById(panelId)?.querySelector("a")?.focus());
        }}
        className="group relative flex items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-2 2xl:px-4 transition-all duration-200"
      >
        <span className="absolute inset-0 rounded-full bg-[rgba(63,191,166,0.08)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        <span className={cn("relative transition-colors duration-300 group-hover:text-h1", active || open ? "text-h1" : "text-body")}>
          {tr(group.label)}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn("relative text-meta transition-transform duration-200", open && "rotate-180 text-accent-text")}
        />
      </button>

      <div
        id={panelId}
        inert={!open}
        className={cn(
          // pont invisible (pt-4) : la souris passe du bouton au panneau sans le refermer
          "absolute left-1/2 top-full z-10 w-80 -translate-x-1/2 pt-4",
          "transition-[opacity,translate] duration-200 ease-out",
          open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0",
        )}
      >
        <ul className="grid gap-0.5 rounded-2xl border border-line bg-elevated p-2 shadow-[var(--mm-shadow-popover)]">
          {group.items.map((item) => {
            const current = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "group/item flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-accent-soft focus-visible:bg-accent-soft",
                    current && "bg-accent-soft",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-subtle bg-box transition-colors",
                      current ? "text-accent-text" : "text-meta group-hover/item:text-accent-text",
                    )}
                  >
                    <item.icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-sm font-medium", current ? "text-accent-text" : "text-h1")}>{tr(item.label)}</span>
                    {item.description && <span className="mt-0.5 block text-xs font-normal leading-snug text-meta">{tr(item.description)}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
