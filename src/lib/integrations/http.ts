import "server-only";
import { Agent, fetch as undiciFetch, type RequestInit } from "undici";

/** Agent qui accepte les certificats auto-signés (Proxmox par défaut). */
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
const secureAgent = new Agent();

export class IntegrationError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export type HttpOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  verifyTls?: boolean;
  timeoutMs?: number;
};

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: { Accept: "application/json", ...opts.headers },
    body: opts.body,
    dispatcher: opts.verifyTls === false ? insecureAgent : secureAgent,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
  };
  let res;
  try {
    res = await undiciFetch(url, init);
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    if (e.name === "TimeoutError") throw new IntegrationError("Délai dépassé (pas de réponse)");
    const code = e.cause?.code;
    if (code === "ECONNREFUSED") throw new IntegrationError("Connexion refusée");
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") throw new IntegrationError("Hôte introuvable (DNS)");
    if (code === "EHOSTUNREACH" || code === "ENETUNREACH") throw new IntegrationError("Hôte injoignable");
    if (code?.includes("CERT") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
      throw new IntegrationError("Certificat TLS non reconnu — désactive la vérification TLS pour un certificat auto-signé");
    }
    throw new IntegrationError(e.cause?.message ?? e.message);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint =
      res.status === 401 ? "Authentification refusée" : res.status === 403 ? "Permissions insuffisantes" : `HTTP ${res.status}`;
    throw new IntegrationError(`${hint}${text ? ` — ${text.slice(0, 160)}` : ""}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Vérifie qu'une URL répond (pour les raccourcis de la page d'accueil). */
export async function probeUrl(url: string, timeoutMs = 4000): Promise<{ up: boolean; status?: number; ms: number }> {
  const start = performance.now();
  try {
    let res = await undiciFetch(url, {
      method: "HEAD",
      redirect: "manual",
      dispatcher: insecureAgent,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 405 || res.status === 501) {
      res = await undiciFetch(url, {
        method: "GET",
        redirect: "manual",
        dispatcher: insecureAgent,
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.body?.cancel();
    }
    // Toute réponse HTTP < 500 signifie que le service est joignable (401/403 inclus).
    return { up: res.status < 500, status: res.status, ms: Math.round(performance.now() - start) };
  } catch {
    return { up: false, ms: Math.round(performance.now() - start) };
  }
}

/** Interprète un en-tête saisi sous la forme « Nom: valeur ». */
export function parseHeader(raw?: string): Record<string, string> {
  if (!raw) return {};
  const i = raw.indexOf(":");
  if (i <= 0) return {};
  return { [raw.slice(0, i).trim()]: raw.slice(i + 1).trim() };
}
