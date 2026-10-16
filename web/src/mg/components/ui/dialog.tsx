
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
        // Charte : feuille en bas sous 640 px ; ≥ sm modale centrée 400 / 560 / 800 px, rayon 14
        "mx-0 mb-0 mt-auto w-full max-w-none rounded-t-[14px] border border-b-0 border-line bg-elevated p-0 text-h2 shadow-[var(--mm-shadow-lg)]",
        "sm:m-auto sm:w-[calc(100%-2rem)] sm:rounded-[14px] sm:border-b",
        { sm: "sm:max-w-[400px]", md: "sm:max-w-[560px]", lg: "sm:max-w-[800px]", xl: "sm:max-w-5xl" }[size],
      )}
    >
      {open && (
        <div className="max-h-[90dvh] overflow-y-auto overscroll-contain px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 sm:max-h-[85vh] sm:px-6 sm:pb-6 sm:pt-5">
          <div className="mm-sheet__grip mx-auto sm:hidden" aria-hidden />
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="mm-dialog__title">{title}</h2>
              {description && <p className="mm-help mt-0.5">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mm-btn mm-btn--ghost mm-btn--icon mm-btn--sm -mr-2 -mt-1"
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
