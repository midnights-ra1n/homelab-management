"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const MARGIN = 8;
const subscribeNoop = () => () => {};

/**
 * Calque flottant rendu dans <body> (jamais rogné par un conteneur à défilement).
 * S'ouvre sous l'ancre, ou au-dessus si la place manque ; ne défile que si la
 * hauteur disponible à l'écran est insuffisante. Fondu d'entrée / de sortie.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  align = "start",
  className,
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  label?: string;
}) {
  const isClient = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      panel.style.maxHeight = "none";
      const natural = panel.scrollHeight;
      const below = vh - r.bottom - MARGIN * 2;
      const above = r.top - MARGIN * 2;
      const up = natural > below && above > below;
      const space = up ? above : below;
      panel.style.maxHeight = natural > space ? `${Math.max(space, 120)}px` : "none";
      panel.style.overflowY = natural > space ? "auto" : "visible";
      const width = panel.offsetWidth;
      let left = align === "end" ? r.right - width : r.left;
      left = Math.min(Math.max(MARGIN, left), vw - width - MARGIN);
      panel.style.left = `${left}px`;
      panel.style.top = up ? "auto" : `${r.bottom + 6}px`;
      panel.style.bottom = up ? `${vh - r.top + 6}px` : "auto";
      panel.style.transformOrigin = `${align === "end" ? "right" : "left"} ${up ? "bottom" : "top"}`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !anchorRef.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        anchorRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!isClient) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      inert={!open}
      className={cn(
        "fixed z-[90] rounded-[10px] border border-line bg-elevated p-1.5 shadow-[var(--mm-shadow-lg)]",
        "transition-[opacity,translate] duration-[180ms] ease-[cubic-bezier(0,0,0.2,1)]",
        open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
