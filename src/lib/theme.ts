/** Thème côté client : "auto" = pas d'attribut data-theme (suit le système). */
export type ThemeChoice = "auto" | "dark" | "light";
export type Theme = "dark" | "light";

const KEY = "hm-theme";
const STYLE_KEY = "hm-style";
const COLORS: Record<UiStyle, Record<Theme, string>> = {
  standard: { dark: "#111214", light: "#f6f7f9" },
  mint: { dark: "#191e27", light: "#e4e8ef" },
};

/** Style d'interface : "standard" (défaut, pas d'attribut) ou "mint" (charte Midnights Mint, data-style="mint"). */
export type UiStyle = "standard" | "mint";

export function getStyle(): UiStyle {
  return document.documentElement.dataset.style === "mint" ? "mint" : "standard";
}

export function setStyle(style: UiStyle) {
  try {
    if (style === "mint") localStorage.setItem(STYLE_KEY, style);
    else localStorage.removeItem(STYLE_KEY);
  } catch {}
  const root = document.documentElement;
  root.classList.add("theme-transition");
  window.setTimeout(() => root.classList.remove("theme-transition"), 400);
  if (style === "mint") root.dataset.style = "mint";
  else delete root.dataset.style;
  syncThemeColor();
  window.dispatchEvent(new Event("hm-theme"));
}

function syncThemeColor() {
  const color = COLORS[getStyle()][getEffectiveTheme()];
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => (m.content = color));
}

export function getChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "dark" || t === "light" ? t : "auto";
  } catch {
    return "auto";
  }
}

export function getEffectiveTheme(): Theme {
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark" || forced === "light") return forced;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Applique un thème avec un fondu des couleurs (classe .theme-transition). */
export function setTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  root.classList.add("theme-transition");
  window.setTimeout(() => root.classList.remove("theme-transition"), 400);
  try {
    if (choice === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {}
  if (choice === "auto") delete root.dataset.theme;
  else root.dataset.theme = choice;
  syncThemeColor();
  window.dispatchEvent(new Event("hm-theme"));
}

/** Abonnement : changement manuel ou changement du thème système. */
export function subscribeTheme(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  window.addEventListener("hm-theme", callback);
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("hm-theme", callback);
    media.removeEventListener("change", callback);
  };
}
