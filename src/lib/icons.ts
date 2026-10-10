import type { IconType } from "./data/shortcuts";

/** Fournisseurs d'icônes : Dashboard Icons (homarr-labs) et selfh.st, via jsDelivr. */
export const ICON_PROVIDERS = {
  dashboard: {
    label: "Dashboard Icons",
    homepage: "https://dashboardicons.com",
    url: (name: string) => `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${name}.svg`,
  },
  selfhst: {
    label: "selfh.st Icons",
    homepage: "https://selfh.st/icons",
    url: (name: string) => `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${name}.svg`,
  },
} as const;

export function iconSrc(type: IconType, value: string): string | null {
  if (!value) return null;
  switch (type) {
    case "dashboard":
    case "selfhst":
      return ICON_PROVIDERS[type].url(value);
    case "upload":
      return `/api/uploads/${encodeURIComponent(value)}`;
    case "url":
      return value;
    default:
      return null;
  }
}
