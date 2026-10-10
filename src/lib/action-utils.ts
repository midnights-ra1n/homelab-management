import "server-only";
import type { z } from "zod";
import { formObject, zodErrors, type FormState } from "./validation";

type Parsed<T> = { ok: true; data: T } | { ok: false; state: FormState };

export function parseForm<S extends z.ZodType>(schema: S, fd: FormData): Parsed<z.infer<S>> {
  const result = schema.safeParse(formObject(fd));
  if (!result.success) {
    return {
      ok: false,
      state: { errors: zodErrors(result.error), message: "Certains champs sont invalides." },
    };
  }
  return { ok: true, data: result.data };
}

export function success(message?: string): FormState {
  return { ok: true, message, nonce: Date.now() };
}

/** Transforme une erreur SQLite (contrainte UNIQUE…) en message lisible. */
export function dbError(err: unknown, uniqueField?: string, uniqueMessage?: string): FormState {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("UNIQUE") && uniqueField) {
    return { errors: { [uniqueField]: uniqueMessage ?? "Cette valeur existe déjà" }, message: "Doublon détecté." };
  }
  console.error(err);
  return { message: msg };
}

export function idFrom(fd: FormData, key = "id"): number | null {
  const n = Number(fd.get(key));
  return Number.isInteger(n) && n > 0 ? n : null;
}
