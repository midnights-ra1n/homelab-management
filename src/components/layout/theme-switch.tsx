"use client";

import { useSyncExternalStore } from "react";
import { getChoice, setTheme, subscribeTheme, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { LOCALE_COOKIE, type Locale } from "@/i18n/locales";

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

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
];

/** Langue Français / English : cookie lu par le proxy, puis rechargement (pages prérendues par langue). */
export function LanguageSwitch({ className }: { className?: string }) {
  const tr = useT();
  return (
    <div role="radiogroup" aria-label={tr("Langue")} className={cn("mm-segmented", className)}>
      {LANGUAGES.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          lang={o.value}
          aria-checked={tr.locale === o.value}
          onClick={() => {
            if (o.value === tr.locale) return;
            document.cookie = `${LOCALE_COOKIE}=${o.value}; path=/; max-age=31536000; samesite=lax`;
            location.reload();
          }}
          className="mm-segmented__item"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
