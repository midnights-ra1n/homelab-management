"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";
import { createSession, destroySession, hasUsers, requireUser } from "@/lib/auth";
import { get, run } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { consumeChallenge, findPasskey, listPasskeys, relyingParty, storeChallenge } from "@/lib/passkeys";
import { banRemaining, clearFailures, clientIp, lockRemaining, recordFailure } from "@/lib/security";
import { formObject, zodErrors, type FormState } from "@/lib/validation";

const credentials = z.object({
  username: z.string().trim().min(3, "3 caractères minimum").max(40),
  password: z.string().min(8, "8 caractères minimum").max(200),
});

// Hash factice : un identifiant inconnu coûte le même temps qu'un mauvais mot de passe (pas d'énumération).
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

/** Chemin interne uniquement : refuse « //evil », « /\evil », « /%5Cevil »… (open redirect). */
function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "/");
  try {
    const url = new URL(next, "http://app.local");
    return next.startsWith("/") && url.origin === "http://app.local" ? url.pathname + url.search : "/";
  } catch {
    return "/";
  }
}

function lockedMessage(seconds: number) {
  return { message: `Trop de tentatives. Réessaie dans ${seconds < 120 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`}.` };
}

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  if (hasUsers()) redirect("/login");
  const data = formObject(fd);
  const parsed = credentials
    .extend({ confirm: z.string() })
    .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Les mots de passe ne correspondent pas" })
    .safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const { lastId } = run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [
    parsed.data.username,
    hashPassword(parsed.data.password),
  ]);
  await createSession(lastId);
  redirect("/");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const ip = clientIp(await headers());
  const username = String(fd.get("username") ?? "").trim().slice(0, 40);
  const password = String(fd.get("password") ?? "");
  const userKey = username.toLowerCase();
  const locked = Math.max(banRemaining(ip), lockRemaining(`ip:${ip}`), lockRemaining(`user:${userKey}`));
  if (locked) return lockedMessage(locked);

  const user = get<{ id: number; password_hash: string }>("SELECT id, password_hash FROM users WHERE username = ?", [
    username,
  ]);
  const valid = verifyPassword(password.slice(0, 200), user?.password_hash ?? DUMMY_HASH) && !!user && password.length <= 200;
  if (!valid) {
    const seconds = Math.max(recordFailure("user", userKey), recordFailure("ip", ip));
    console.warn(`[auth] échec de connexion ip=${ip} user=${JSON.stringify(userKey)}${seconds ? ` verrouillé ${seconds}s` : ""}`);
    return seconds ? lockedMessage(seconds) : { message: "Identifiant ou mot de passe incorrect." };
  }
  clearFailures("user", userKey);
  clearFailures("ip", ip);
  await createSession(user.id);
  redirect(safeNext(fd.get("next")));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      current: z.string().min(1, "Requis"),
      password: credentials.shape.password,
      confirm: z.string(),
    })
    .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Les mots de passe ne correspondent pas" })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [user.id]);
  const userKey = user.username.toLowerCase();
  const locked = lockRemaining(`user:${userKey}`);
  if (locked) return lockedMessage(locked);
  if (!row || !verifyPassword(parsed.data.current, row.password_hash)) {
    recordFailure("user", userKey);
    return { errors: { current: "Mot de passe actuel incorrect" } };
  }
  run("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(parsed.data.password), user.id]);
  run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
  await createSession(user.id);
  return { ok: true, message: "Mot de passe modifié. Les autres sessions ont été déconnectées.", nonce: Date.now() };
}

/* ----------------------------------------------------------------------------
 * Passkeys (WebAuthn), uniquement en HTTPS. Vérification par l'utilisateur
 * (biométrie, PIN) exigée : la passkey remplace le mot de passe, pas un 2e facteur.
 * -------------------------------------------------------------------------- */

export async function passkeyLoginOptionsAction() {
  const rp = relyingParty(await headers());
  if (!rp) return null;
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
  storeChallenge(options.challenge, null);
  return options;
}

export async function passkeyLoginAction(response: AuthenticationResponseJSON, next: string): Promise<FormState> {
  const h = await headers();
  const ip = clientIp(h);
  const locked = Math.max(banRemaining(ip), lockRemaining(`ip:${ip}`));
  if (locked) return lockedMessage(locked);
  const rp = relyingParty(h);
  if (!rp) return { message: "Les passkeys nécessitent HTTPS." };

  const key = typeof response?.id === "string" ? findPasskey(response.id) : undefined;
  let verified = false;
  if (key) {
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: (c) => consumeChallenge(c, null),
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        credential: {
          id: key.id,
          publicKey: new Uint8Array(key.public_key),
          counter: key.counter,
          transports: key.transports ? key.transports.split(",") : undefined,
        },
      });
      verified = result.verified;
      if (verified) {
        run("UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?", [
          result.authenticationInfo.newCounter,
          key.id,
        ]);
      }
    } catch (err) {
      console.warn(`[auth] passkey refusée ip=${ip} : ${err instanceof Error ? err.message : err}`);
    }
  }
  if (!key || !verified) {
    const seconds = recordFailure("ip", ip);
    return seconds ? lockedMessage(seconds) : { message: "Passkey non reconnue." };
  }
  clearFailures("ip", ip);
  await createSession(key.user_id);
  redirect(safeNext(next));
}

export async function passkeyRegisterOptionsAction() {
  const user = await requireUser();
  const rp = relyingParty(await headers());
  if (!rp) return null;
  const options = await generateRegistrationOptions({
    rpName: "Homelab",
    rpID: rp.rpID,
    userName: user.username,
    userID: new TextEncoder().encode(String(user.id)),
    attestationType: "none",
    excludeCredentials: listPasskeys(user.id).map((p) => ({ id: p.id })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  storeChallenge(options.challenge, user.id);
  return options;
}

export async function passkeyRegisterAction(response: RegistrationResponseJSON, name: string): Promise<FormState> {
  const user = await requireUser();
  const rp = relyingParty(await headers());
  if (!rp) return { message: "Les passkeys nécessitent HTTPS." };
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response,
      expectedChallenge: (c) => consumeChallenge(c, user.id),
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
    });
    if (!verified) return { message: "Enregistrement de la passkey refusé." };
    const { credential } = registrationInfo;
    run("INSERT INTO passkeys (id, user_id, public_key, counter, transports, name) VALUES (?, ?, ?, ?, ?, ?)", [
      credential.id,
      user.id,
      credential.publicKey,
      credential.counter,
      (credential.transports ?? []).join(","),
      String(name ?? "").trim().slice(0, 60) || "Passkey",
    ]);
  } catch (err) {
    console.warn(`[auth] enregistrement passkey échoué : ${err instanceof Error ? err.message : err}`);
    return { message: "Enregistrement de la passkey refusé." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Passkey ajoutée.", nonce: Date.now() };
}

export async function deletePasskeyAction(id: string) {
  const user = await requireUser();
  run("DELETE FROM passkeys WHERE id = ? AND user_id = ?", [id, user.id]);
  revalidatePath("/", "layout");
}
