import "server-only";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const insecure = new Agent({ connect: { rejectUnauthorized: false } });
const secure = new Agent();

export type ProbeResult = { up: boolean; ms: number | null; status: number | null; error: string };

export async function probeHttp(url: string, opts: { timeoutMs: number; verifyTls: boolean; accept: "2xx3xx" | "lt500" }): Promise<ProbeResult> {
  const start = performance.now();
  const dispatcher = opts.verifyTls ? secure : insecure;
  try {
    let res = await undiciFetch(url, { method: "HEAD", redirect: "manual", dispatcher, signal: AbortSignal.timeout(opts.timeoutMs) });
    if (res.status === 405 || res.status === 501) {
      res = await undiciFetch(url, { method: "GET", redirect: "manual", dispatcher, signal: AbortSignal.timeout(opts.timeoutMs) });
      await res.body?.cancel();
    }
    const ms = Math.round(performance.now() - start);
    const up = opts.accept === "2xx3xx" ? res.status >= 200 && res.status < 400 : res.status < 500;
    return { up, ms, status: res.status, error: up ? "" : `HTTP ${res.status}` };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const reason =
      e.name === "TimeoutError" ? "Délai dépassé" : e.cause?.code === "ECONNREFUSED" ? "Connexion refusée" : e.cause?.code ?? e.message;
    return { up: false, ms: null, status: null, error: String(reason).slice(0, 200) };
  }
}

export function probeTcp(target: string, timeoutMs: number): Promise<ProbeResult> {
  const i = target.lastIndexOf(":");
  const host = target.slice(0, i);
  const port = Number(target.slice(i + 1));
  const start = performance.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (r: ProbeResult) => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(timeoutMs, () => done({ up: false, ms: null, status: null, error: "Délai dépassé" }));
    socket.once("connect", () => done({ up: true, ms: Math.round(performance.now() - start), status: null, error: "" }));
    socket.once("error", (e: NodeJS.ErrnoException) =>
      done({ up: false, ms: null, status: null, error: e.code === "ECONNREFUSED" ? "Connexion refusée" : (e.code ?? e.message) }),
    );
  });
}
