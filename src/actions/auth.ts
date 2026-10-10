"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, hasUsers, requireUser } from "@/lib/auth";
import { get, run } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { formObject, zodErrors, type FormState } from "@/lib/validation";

const credentials = z.object({
  username: z.string().trim().min(3, "3 caractères minimum").max(40),
  password: z.string().min(8, "8 caractères minimum").max(200),
});

// Ralentit les tentatives de force brute (par processus).
const failures = new Map<string, { count: number; until: number }>();

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
  const username = String(fd.get("username") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const key = username.toLowerCase();
  const f = failures.get(key);
  if (f && f.until > Date.now()) {
    return { message: `Trop de tentatives. Réessaie dans ${Math.ceil((f.until - Date.now()) / 1000)} s.` };
  }
  const user = get<{ id: number; password_hash: string }>("SELECT id, password_hash FROM users WHERE username = ?", [
    username,
  ]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    const count = (f?.count ?? 0) + 1;
    failures.set(key, { count, until: count >= 5 ? Date.now() + Math.min(300, 2 ** (count - 4) * 15) * 1000 : 0 });
    return { message: "Identifiant ou mot de passe incorrect." };
  }
  failures.delete(key);
  await createSession(user.id);
  const next = String(fd.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
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
  if (!row || !verifyPassword(parsed.data.current, row.password_hash)) {
    return { errors: { current: "Mot de passe actuel incorrect" } };
  }
  run("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(parsed.data.password), user.id]);
  run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
  await createSession(user.id);
  return { ok: true, message: "Mot de passe modifié. Les autres sessions ont été déconnectées.", nonce: Date.now() };
}
