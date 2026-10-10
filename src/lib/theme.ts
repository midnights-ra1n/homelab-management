/** Thème côté client : "auto" = pas d'attribut data-theme (suit le système). */
export type ThemeChoice = "auto" | "dark" | "light";
export type Theme = "dark" | "light";

const KEY = "hm-theme";
const COLORS: Record<Theme, string> = { dark: "#191e27", light: "#e4e8ef" };

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
  const color = COLORS[getEffectiveTheme()];
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => (m.content = color));
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
