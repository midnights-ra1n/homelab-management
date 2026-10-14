"use client";

import { useSyncExternalStore } from "react";
import { getChoice, getStyle, setStyle, setTheme, subscribeTheme, type ThemeChoice, type UiStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { LOCALE_COOKIE, type Locale } from "@/i18n/locales";

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
  const tr = useT();
  const theme = useThemeChoice();
  return (
    <div
      role="radiogroup"
      aria-label={tr("Thème")}
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
          {tr(o.label)}
        </button>
      ))}
    </div>
  );
}

const STYLES: { value: UiStyle; label: string }[] = [
  { value: "standard", label: "Midnights Classic" },
  { value: "mint", label: "Midnights Mint" },
];

/** Sélecteur de style d'interface : Midnights Classic (défaut) ou charte Midnights Mint. */
export function StyleSwitch({ className }: { className?: string }) {
  const tr = useT();
  const style = useSyncExternalStore(subscribeTheme, getStyle, () => "standard" as UiStyle);
  return (
    <div
      role="radiogroup"
      aria-label={tr("Style d'interface")}
      className={cn("inline-flex items-center gap-1 rounded-full border border-line bg-box p-1", className)}
    >
      {STYLES.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={style === o.value}
          onClick={() => setStyle(o.value)}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-xs transition-colors duration-200",
            style === o.value ? "bg-accent text-on-accent" : "text-body hover:text-h1",
          )}
        >
          {tr(o.label)}
        </button>
      ))}
    </div>
  );
}

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: "fr", label: "FR" },
  { value: "en", label: "EN" },
];

/** Sélecteur de langue : cookie lu par le proxy, puis rechargement (pages prérendues par langue). */
export function LanguageSwitch({ className }: { className?: string }) {
  const tr = useT();
  return (
    <div
      role="radiogroup"
      aria-label={tr("Langue")}
      className={cn("inline-flex items-center gap-1 rounded-full border border-line bg-box p-1", className)}
    >
      {LANGUAGES.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          lang={o.value}
          aria-checked={tr.locale === o.value}
          aria-label={o.value === "fr" ? "Français" : "English"}
          onClick={() => {
            if (o.value === tr.locale) return;
            document.cookie = `${LOCALE_COOKIE}=${o.value}; path=/; max-age=31536000; samesite=lax`;
            location.reload();
          }}
          className={cn(
            "rounded-full px-3.5 py-1.5 font-mono text-xs transition-colors duration-200",
            tr.locale === o.value ? "bg-accent text-on-accent" : "text-body hover:text-h1",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
