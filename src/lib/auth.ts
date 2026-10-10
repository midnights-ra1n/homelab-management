import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { get, run } from "./db";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "hm_session";
const SESSION_DAYS = 30;

export type User = { id: number; username: string };

/** Authentification désactivable si l'app est derrière un SSO (Authelia, Authentik…). */
export const AUTH_DISABLED = process.env.AUTH_DISABLED === "true";

export function hasUsers(): boolean {
  return !!get<{ id: number }>("SELECT id FROM users LIMIT 1");
}

export async function createSession(userId: number) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
    sha256(token),
    userId,
    expires.toISOString(),
  ]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE id = ?", [sha256(token)]);
  jar.delete(SESSION_COOKIE);
}

/** Utilisateur courant ou null. Lit le cookie : à appeler sous <Suspense>. */
export async function getCurrentUser(): Promise<User | null> {
  // Tout ce qui suit (session, dates, base) est rendu à la requête, jamais pré-rendu.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (AUTH_DISABLED) {
    return get<User>("SELECT id, username FROM users ORDER BY id LIMIT 1") ?? { id: 0, username: "admin" };
  }
  if (!token) return null;
  return (
    get<User>(
      `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
      [sha256(token), new Date().toISOString()],
    ) ?? null
  );
}

/** Garde d'accès pour pages et server actions. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(hasUsers() ? "/login" : "/setup");
  return user;
}
