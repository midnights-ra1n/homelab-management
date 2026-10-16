import { resolved } from "./resource";

/** Display preference: explicit URL parameter > remembered choice (cookie set by ViewSwitch) > default. */
export function resolveView<T extends string>(name: string, allowed: readonly T[], fallback: T, fromUrl?: string | string[] | null) {
  if (typeof fromUrl === "string" && allowed.includes(fromUrl as T)) return resolved(fromUrl as T);
  const saved = document.cookie.match(new RegExp(`(?:^|; )hm-view-${name}=([^;]+)`))?.[1];
  return resolved(saved && allowed.includes(saved as T) ? (saved as T) : fallback);
}
