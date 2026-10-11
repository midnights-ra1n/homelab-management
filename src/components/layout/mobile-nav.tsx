"use client";

import Link from "next/link";
import { LayoutGrid, Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MOBILE_TABS, NAV_ITEMS, isActive } from "./nav-items";
import { LanguageSwitch, ThemeSwitch } from "./theme-switch";
import { usePathname, useT } from "@/i18n/client";

/**
 * Navigation mobile / PWA : barre d'onglets flottante en bas (zone du pouce),
 * onglet « Plus » qui ouvre une feuille glissante (glisser vers le bas pour fermer).
 */
export function MobileNav({ accountSlot }: { accountSlot: ReactNode }) {
  const tr = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const tabs = NAV_ITEMS.filter((i) => MOBILE_TABS.includes(i.href));
  const more = NAV_ITEMS.filter((i) => !MOBILE_TABS.includes(i.href));
  const moreActive = more.some((i) => isActive(pathname, i.href)) || isActive(pathname, "/parametres");

  return (
    <div className="xl:hidden">
      {/* Voile */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-[70] bg-[var(--mm-overlay)] backdrop-blur-sm transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Feuille « Plus » */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr("Plus de pages")}
        inert={!open}
        onTouchStart={(e) => (startY.current = e.touches[0].clientY)}
        onTouchMove={(e) => {
          if (startY.current === null) return;
          setDrag(Math.max(0, e.touches[0].clientY - startY.current));
        }}
        onTouchEnd={() => {
          if (drag > 90) setOpen(false);
          setDrag(0);
          startY.current = null;
        }}
        className={cn(
          "fixed inset-x-0 bottom-0 z-[75] max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-4xl border border-b-0 border-line bg-page px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 nav-glow",
          drag === 0 && "transition-[translate,transform,visibility] duration-300 ease-[var(--ease-soft)]",
          !open && "invisible translate-y-full",
        )}
        style={open && drag ? { transform: `translateY(${drag}px)` } : undefined}
      >
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />
        <nav aria-label={tr("Autres pages")} className="grid grid-cols-3 gap-2">
          {[...more, { href: "/parametres", label: tr("Paramètres"), short: tr("Paramètres"), icon: Settings }].map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-3xl px-2 py-4 text-sm font-medium transition-colors active:scale-[0.97]",
                  active ? "bg-accent-soft text-accent-text" : "bg-box text-h2",
                )}
              >
                <Icon size={22} aria-hidden className={active ? "" : "text-meta"} />
                {tr(item.short)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-5 flex items-center justify-between gap-3 rounded-full border border-line px-4 py-2">
          <span className="text-sm text-body">{tr("Thème")}</span>
          <ThemeSwitch />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-full border border-line px-4 py-2">
          <span className="text-sm text-body">{tr("Langue")}</span>
          <LanguageSwitch />
        </div>
        <div className="mt-3">{accountSlot}</div>
      </div>

      {/* Barre d'onglets */}
      <nav
        aria-label={tr("Navigation principale")}
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] mx-auto flex h-16 max-w-md items-center justify-around rounded-full border border-line bg-page/95 px-2 backdrop-blur-md nav-glow"
      >
        {tabs.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="group flex h-full flex-1 flex-col items-center justify-center gap-1 [-webkit-tap-highlight-color:transparent]"
            >
              <span
                className={cn(
                  "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200",
                  active ? "bg-accent-soft text-accent-text" : "text-meta group-active:bg-box",
                )}
              >
                <Icon size={20} aria-hidden />
              </span>
              <span className={cn("text-[0.68rem] font-medium leading-none", active ? "text-h1" : "text-meta")}>{tr(item.short)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="group flex h-full flex-1 flex-col items-center justify-center gap-1 [-webkit-tap-highlight-color:transparent]"
        >
          <span
            className={cn(
              "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200",
              moreActive ? "bg-accent-soft text-accent-text" : "text-meta group-active:bg-box",
            )}
          >
            <LayoutGrid size={20} aria-hidden />
          </span>
          <span className={cn("text-[0.68rem] font-medium leading-none", moreActive ? "text-h1" : "text-meta")}>{tr("Plus")}</span>
        </button>
      </nav>
    </div>
  );
}
