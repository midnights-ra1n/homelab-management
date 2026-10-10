"use client";

import { useSyncExternalStore } from "react";
import { getChoice, setTheme, subscribeTheme, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribeTheme, getChoice, () => "auto" as ThemeChoice);
}

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "dark", label: "Sombre" },
  { value: "light", label: "Clair" },
];

/** Sélecteur Auto / Sombre / Clair (pilule de la charte). */
export function ThemeSwitch({ className }: { className?: string }) {
  const theme = useThemeChoice();
  return (
    <div
      role="radiogroup"
      aria-label="Thème"
      className={cn("inline-flex items-center gap-1 rounded-full border border-line bg-box p-1", className)}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => setTheme(o.value)}
          className={cn(
            "rounded-full px-3.5 py-1.5 font-mono text-xs transition-colors duration-200",
            theme === o.value ? "bg-accent text-on-accent" : "text-body hover:text-h1",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
