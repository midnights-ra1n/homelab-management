
import { useSyncExternalStore } from "react";
import { getChoice, setTheme, subscribeTheme, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribeTheme, getChoice, () => "auto" as ThemeChoice);
}

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "dark", label: "Sombre" },
  { value: "light", label: "Clair" },
  { value: "auto", label: "Auto" },
];

/** Thème Sombre / Clair / Auto : contrôle segmenté de la charte (.mm-segmented). */
export function ThemeSwitch({ className }: { className?: string }) {
  const tr = useT();
  const theme = useThemeChoice();
  return (
    <div role="radiogroup" aria-label={tr("Thème")} className={cn("mm-segmented", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => setTheme(o.value)}
          className="mm-segmented__item"
        >
          {tr(o.label)}
        </button>
      ))}
    </div>
  );
}
