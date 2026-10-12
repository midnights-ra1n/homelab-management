"use client";

import { ArrowUp, Moon, Sun } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { getEffectiveTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/** Rond teinté qui se déplie vers la gauche au survol pour afficher son libellé. */
function FloatingButton({ label, icon, onClick, hidden = false }: { label: string; icon: ReactNode; onClick: () => void; hidden?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={hidden ? -1 : 0}
      onClick={onClick}
      className={cn(
        "group flex h-12 items-center rounded-full border border-[var(--mm-border-mint)] bg-accent-soft text-accent-text backdrop-blur-md",
        "transition-[opacity,translate,border-color] duration-300 hover:border-accent",
        hidden ? "pointer-events-none translate-y-4 opacity-0" : "translate-y-0 opacity-100",
      )}
    >
      <span className="max-w-0 overflow-hidden whitespace-nowrap pl-0 text-sm font-medium opacity-0 transition-[max-width,opacity,padding] duration-300 ease-out group-hover:max-w-40 group-hover:pl-5 group-hover:opacity-100 group-focus-visible:max-w-40 group-focus-visible:pl-5 group-focus-visible:opacity-100">
        {label}
      </span>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center">{icon}</span>
    </button>
  );
}

function BackToTop() {
  const tr = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.6);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <FloatingButton
      label={tr("Retour en haut")}
      hidden={!visible}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      icon={<ArrowUp size={16} className="transition-transform duration-300 group-hover:-translate-y-0.5" />}
    />
  );
}

function ThemeToggle() {
  const tr = useT();
  const theme = useSyncExternalStore<Theme>(subscribeTheme, getEffectiveTheme, () => "dark");
  const toLight = theme === "dark";
  return (
    <FloatingButton
      label={toLight ? tr("Thème clair") : tr("Thème sombre")}
      onClick={() => setTheme(toLight ? "light" : "dark")}
      icon={
        toLight ? (
          <Sun size={18} className="transition-transform duration-500 group-hover:rotate-45" />
        ) : (
          <Moon size={18} className="transition-transform duration-500 group-hover:-rotate-12" />
        )
      }
    />
  );
}

export function FloatingActions() {
  return (
    <div className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-40 hidden flex-col items-end gap-3 mint:xl:flex">
      <BackToTop />
      <ThemeToggle />
    </div>
  );
}
