import "server-only";
import { all, get } from "./db";

export type Passkey = { id: string; name: string; created_at: string; last_used_at: string | null };

export function listPasskeys(userId: number): Passkey[] {
  return all<Passkey>("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at", [userId]);
}

export function findPasskey(id: string) {
  return get<{ id: string; user_id: number; public_key: Uint8Array; counter: number; transports: string }>(
    "SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?",
    [id],
  );
}

/**
 * Relying party déduite de l'en-tête Origin (Next.js le compare déjà à l'hôte pour
 * les server actions). WebAuthn exige un contexte sécurisé : null hors HTTPS.
 */
export function relyingParty(headers: Headers): { origin: string; rpID: string } | null {
  const origin = headers.get("origin");
  if (!origin?.startsWith("https://")) return null;
  try {
    return { origin, rpID: new URL(origin).hostname };
  } catch {
    return null;
  }
}

/* Défis à usage unique, valables 5 min. userId null = connexion, sinon enregistrement.
 * shortcut: en mémoire comme lib/security.ts ; un redémarrage invalide les défis en cours. */
const TTL = 5 * 60_000;
const challenges: Map<string, { userId: number | null; expires: number }> = ((
  globalThis as { __hmPasskeyChallenges?: Map<string, { userId: number | null; expires: number }> }
).__hmPasskeyChallenges ??= new Map());

export function storeChallenge(challenge: string, userId: number | null, now = Date.now()) {
  if (challenges.size > 1000) for (const [k, v] of challenges) if (v.expires <= now) challenges.delete(k);
  if (challenges.size > 1000) challenges.clear();
  challenges.set(challenge, { userId, expires: now + TTL });
}

/** Consomme le défi : vrai une seule fois, s'il n'a pas expiré et appartient au bon utilisateur. */
export function consumeChallenge(challenge: string, userId: number | null, now = Date.now()): boolean {
  const c = challenges.get(challenge);
  challenges.delete(challenge);
  return !!c && c.expires > now && c.userId === userId;
}
