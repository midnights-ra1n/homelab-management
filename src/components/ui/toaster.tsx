"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useT } from "@/i18n/client";

type Toast = { id: number; kind: "success" | "error" | "info"; message: string };
const ToastContext = createContext<(kind: Toast["kind"], message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const GLYPH = { success: ["✓", "--mm-success-solid"], error: ["✕", "--mm-danger-solid"], info: ["i", "--mm-info-solid"] } as const;

/** Notifications éphémères, annoncées aux lecteurs d'écran. Charte : en bas à droite, 360 px (au-dessus de la barre basse sur mobile). */
export function Toaster({ children }: { children: ReactNode }) {
  const tr = useT();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((kind: Toast["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 9000 : 5000);
  }, []);

  return (
    <ToastContext value={push}>
      {children}
      <div aria-live="polite" className="mm-toast-region pointer-events-none">
        {toasts.map((t) => {
          const [glyph, color] = GLYPH[t.kind];
          return (
            <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className="mm-toast pointer-events-auto">
              <span className="mm-alert__glyph" style={{ background: `var(${color})` }} aria-hidden="true">
                {glyph}
              </span>
              <p className="mm-toast__body break-words">{tr(t.message)}</p>
              <button type="button" onClick={() => dismiss(t.id)} className="mm-btn mm-btn--ghost mm-btn--icon mm-btn--sm -my-1.5" aria-label={tr("Fermer")}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}
