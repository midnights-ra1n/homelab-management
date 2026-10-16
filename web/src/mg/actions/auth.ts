/* Account actions of the management UI (sign-in and passkeys are shared: ../../shared/system.tsx). */
import { api, ApiError } from "../lib/client";
import type { FormState } from "../lib/validation";

export async function logoutAction() {
  await api.post("/api/auth/logout").catch(() => {});
  location.assign("/");
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  if (fd.get("password") !== fd.get("confirm")) return { errors: { confirm: "Les mots de passe ne correspondent pas" } };
  try {
    await api.post("/api/auth/password", { current: String(fd.get("current") ?? ""), new: String(fd.get("password") ?? "") });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return { errors: { current: e.message } };
    return { message: e instanceof ApiError ? e.message : "Erreur réseau" };
  }
  return { ok: true, message: "Mot de passe modifié. Les autres sessions ont été déconnectées.", nonce: Date.now() };
}
