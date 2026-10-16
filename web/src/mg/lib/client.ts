/* Calls to the management API. Writes invalidate the data cache, as the server actions revalidated the pages. */
import { api, ApiError } from "../../api";
import { navigate } from "../../ui";
import type { FormState } from "./validation";
import { invalidate, resource } from "./resource";

export { api, ApiError };

/** GET through the cache: the same promise until the next write. */
export function get<T>(path: string): Promise<T> {
  return resource(path, () => api.get<T>(path));
}

export function qs(params: Record<string, string | number | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.size ? `?${p}` : "";
}

/** Posts a form (FormData) and returns the FormState; follows the redirect the server asks for. */
export async function postForm(path: string, fd: FormData): Promise<FormState & { redirect?: string; id?: number }> {
  const res = await fetch(path, { method: "POST", body: fd, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("hlm:unauthorized"));
    return { message: data.error || `Erreur ${res.status}` };
  }
  if (data.ok) invalidate();
  if (data.redirect) navigate(data.redirect);
  return data;
}

/** JSON write (POST/PUT/DELETE) followed by a refresh of the displayed data. */
export async function write<T = void>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const out = method === "DELETE" ? await api.del(path) : method === "PUT" ? await api.put<T>(path, body ?? {}) : await api.post<T>(path, body ?? {});
  invalidate();
  return out as T;
}

/** Same as write, reporting errors as { ok: false, message } like the old actions. */
export async function act(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await write<{ ok?: boolean; message?: string } | undefined>(method, path, body);
    return { ok: r?.ok ?? true, message: r?.message ?? "" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
