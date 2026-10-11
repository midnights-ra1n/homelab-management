"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/** Modale native <dialog> : focus piégé, Échap pour fermer, fond flouté. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const tr = useT();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        // Mobile : feuille glissante ancrée en bas ; ≥ sm : modale centrée
        "mx-0 mb-0 mt-auto w-full max-w-none rounded-t-4xl border border-b-0 border-line bg-elevated p-0 text-h2 shadow-[var(--mm-shadow-popover)]",
        "sm:m-auto sm:w-[calc(100%-2rem)] sm:rounded-3xl sm:border-b",
        { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" }[size],
      )}
    >
      {open && (
        <div className="max-h-[90dvh] overflow-y-auto overscroll-contain px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 sm:max-h-[85vh] sm:p-8">
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-h1">{title}</h2>
              {description && <p className="mt-1 text-sm text-meta">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 -mt-1 rounded-full p-2 text-meta transition-colors hover:bg-box hover:text-h1"
              aria-label={tr("Fermer")}
            >
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
