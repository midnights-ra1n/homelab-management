import "server-only";
import { cookies } from "next/headers";

/**
 * Préférence d'affichage mémorisée (cookie lu côté serveur : pas de flash).
 * Priorité : paramètre d'URL explicite > choix mémorisé > valeur par défaut.
 */
export async function resolveView<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
  fromUrl?: string | string[],
): Promise<T> {
  if (typeof fromUrl === "string" && allowed.includes(fromUrl as T)) return fromUrl as T;
  const saved = (await cookies()).get(`hm-view-${name}`)?.value;
  return saved && allowed.includes(saved as T) ? (saved as T) : fallback;
}
