"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { TONE_VAR } from "@/lib/constants";

type Toast = { id: number; kind: "success" | "error" | "info"; message: string };
const ToastContext = createContext<(kind: Toast["kind"], message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const STYLE = {
  success: { tone: TONE_VAR.green, glyph: "✓" },
  error: { tone: TONE_VAR.red, glyph: "✕" },
  info: { tone: TONE_VAR.blue, glyph: "i" },
};

/** Notifications éphémères (en bas à droite), annoncées aux lecteurs d'écran. */
export function Toaster({ children }: { children: ReactNode }) {
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
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[80] flex flex-col gap-2 sm:inset-x-auto sm:left-5 sm:w-[24rem] xl:bottom-5">
        {toasts.map((t) => {
          const s = STYLE[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className="rise pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-[var(--mm-shadow-popover)]"
              style={{
                background: `color-mix(in srgb, ${s.tone} 10%, var(--mm-bg-elevated))`,
                borderColor: `color-mix(in srgb, ${s.tone} 40%, var(--mm-border))`,
              }}
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold"
                style={{ background: s.tone, color: "var(--mm-bg-box)" }}
              >
                {s.glyph}
              </span>
              <p className="min-w-0 flex-1 break-words text-sm text-h2">{t.message}</p>
              <button type="button" onClick={() => dismiss(t.id)} className="text-meta hover:text-h1" aria-label="Fermer">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}
