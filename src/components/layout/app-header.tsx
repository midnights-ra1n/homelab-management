"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { NAV_ITEMS, isActive } from "./nav-items";
import { useScrollVisibility } from "./use-scroll-visibility";
import { usePathname, useT } from "@/i18n/client";

/**
 * Navbar flottante en pilule, reprise du portfolio : séparateurs « • »,
 * indicateur unique qui glisse sous le lien actif, masquage au défilement
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
      const active = NAV_ITEMS.find((i) => isActive(pathname, i.href));
      const link = active ? list.querySelector<HTMLElement>(`[data-nav-href="${active.href}"] a`) : null;
      bar.style.transition = animate
        ? "transform 0.55s cubic-bezier(0.34, 1.25, 0.64, 1), width 0.55s cubic-bezier(0.34, 1.25, 0.64, 1), opacity 0.2s ease"
        : "none";
      if (!link) {
        bar.style.opacity = "0";
        return;
      }
      const width = link.offsetWidth * 0.7;
      const x = link.offsetLeft + (link.offsetWidth - width) / 2;
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
            {NAV_ITEMS.map((item, i) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href} data-nav-href={item.href} className="flex items-center">
                  {i > 0 && <span className="select-none px-1 text-xs text-meta 2xl:px-2">•</span>}
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className="group relative whitespace-nowrap rounded-full px-2.5 py-2 transition-all duration-200"
                  >
                    <span className="absolute inset-0 rounded-full bg-[rgba(63,191,166,0.08)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                    <span className={cn("relative transition-colors duration-300 group-hover:text-h1", active ? "text-h1" : "text-body")}>
                      {tr(item.label)}
                    </span>
                  </Link>
                </li>
              );
            })}
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
          {NAV_ITEMS.map((item, i) => (
            <li key={item.href} className="flex items-center">
              {i > 0 && <span className="select-none px-1 text-xs text-meta 2xl:px-2">•</span>}
              <Link href={item.href} className="whitespace-nowrap rounded-lg px-2.5 py-2 text-body">
                {tr(item.label)}
              </Link>
            </li>
          ))}
        </ul>
        <span className="h-10 w-10" />
      </nav>
    </header>
  );
}
