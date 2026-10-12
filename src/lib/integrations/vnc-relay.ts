import "server-only";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import { AUTH_DISABLED, SESSION_COOKIE, userForToken } from "../auth";
import { getIntegration } from "../data/integrations";
import { authHeader, type GuestType } from "./proxmox";

/**
 * Relais WebSocket navigateur ↔ Proxmox pour la console noVNC.
 * Le navigateur ne peut pas envoyer l'en-tête du jeton API sur un WebSocket :
 * l'app rejoue la poignée de main vers /vncwebsocket avec le jeton, puis relaie les octets tels quels.
 */

export const VNC_PATH = "/api/vnc";
const TTL_MS = 30_000;

type Pending = { integrationId: number; node: string; type: GuestType; vmid: number; port: string; ticket: string; expires: number };

// Partagé entre le bundle des server actions et celui de l'instrumentation.
const g = globalThis as unknown as { __hmVnc?: Map<string, Pending>; __hmVncRelay?: boolean };
const pending = (g.__hmVnc ??= new Map());

export function registerVncSession(p: Omit<Pending, "expires">): string {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  const token = randomBytes(24).toString("base64url");
  pending.set(token, { ...p, expires: now + TTL_MS });
  return token;
}

function cookie(header: string | undefined, name: string) {
  return header?.split(/;\s*/).find((c) => c.startsWith(name + "="))?.slice(name.length + 1);
}

function reject(socket: Duplex, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function relay(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
  socket.on("error", () => socket.destroy());
  const token = new URL(req.url ?? "", "http://x").searchParams.get("token") ?? "";
  const s = pending.get(token);
  pending.delete(token); // usage unique
  const session = cookie(req.headers.cookie, SESSION_COOKIE);
  if (!AUTH_DISABLED && !(session && userForToken(decodeURIComponent(session)))) return reject(socket, "401 Unauthorized");
  if (!s || s.expires < Date.now()) return reject(socket, "403 Forbidden");
  const i = getIntegration(s.integrationId);
  if (!i || i.type !== "proxmox") return reject(socket, "404 Not Found");

  const u = new URL(i.url);
  const secure = u.protocol === "https:";
  const port = Number(u.port || (secure ? 8006 : 80));
  const upstream = secure
    ? tls.connect({
        host: u.hostname,
        port,
        servername: net.isIP(u.hostname) ? undefined : u.hostname,
        rejectUnauthorized: i.config.verify_tls ?? false,
      })
    : net.connect({ host: u.hostname, port });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.setTimeout(10_000, close);
  upstream.on("error", (e) => {
    console.warn(`[vnc] ${i.name} : ${e.message}`);
    if (!socket.destroyed) reject(socket, "502 Bad Gateway");
  });
  upstream.once(secure ? "secureConnect" : "connect", () => {
    upstream.setTimeout(0);
    const path = `/api2/json/nodes/${encodeURIComponent(s.node)}/${s.type}/${s.vmid}/vncwebsocket?port=${encodeURIComponent(s.port)}&vncticket=${encodeURIComponent(s.ticket)}`;
    const h = req.headers;
    const lines = [
      `GET ${path} HTTP/1.1`,
      `Host: ${u.host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${h["sec-websocket-key"]}`,
      `Sec-WebSocket-Version: ${h["sec-websocket-version"] ?? "13"}`,
      `Sec-WebSocket-Protocol: ${h["sec-websocket-protocol"] ?? "binary"}`,
      `Authorization: ${authHeader(i).Authorization}`,
    ];
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
    socket.on("close", close);
    upstream.on("close", close);
  });
}

/**
 * Next ne gère pas les WebSockets dans ses routes : on intercepte l'évènement « upgrade »
 * du serveur HTTP (dev comme standalone) avant Next, uniquement pour VNC_PATH.
 */
export function installVncRelay() {
  if (g.__hmVncRelay) return;
  g.__hmVncRelay = true;
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (this: http.Server, event: string, ...args: unknown[]) {
    if (event === "upgrade") {
      const [req, socket, head] = args as [http.IncomingMessage, Duplex, Buffer];
      if (req.url?.split("?")[0] === VNC_PATH) {
        try {
          relay(req, socket, head);
        } catch (e) {
          console.error("[vnc]", e);
          socket.destroy();
        }
        return true;
      }
    }
    return emit.apply(this, [event, ...args] as Parameters<typeof emit>);
  } as typeof emit;
}
