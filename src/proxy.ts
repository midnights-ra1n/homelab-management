import { NextResponse, type NextRequest } from "next/server";
import { banRemaining, clientIp, recordFailure, wafInspect } from "@/lib/security";

const PUBLIC = /^\/(?:login|setup|api\/health|api\/uploads|manifest\.webmanifest|sw\.js|offline\.html|robots\.txt|icons\/|icon|apple-icon)|\.(?:svg|png|ico|webp)$/;

function blocked(status: number, retryAfter?: number) {
  return new NextResponse(status === 429 ? "Trop de requêtes : accès temporairement bloqué." : "Requête refusée.", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
  });
}

/**
 * 1. WAF + bannissement temporaire des IP fautives (toutes les routes).
 * 2. Contrôle optimiste : sans cookie de session, redirection vers /login.
 *    La validation réelle de la session est faite côté serveur (requireUser).
 */
export function proxy(request: NextRequest) {
  // Sonde Docker/Proxmox : jamais bannie (une IP 127.0.0.1 usurpée ne doit pas rendre le conteneur « unhealthy »).
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
  const ip = clientIp(request.headers);
  const ban = banRemaining(ip);
  if (ban) return blocked(429, ban);
  const rule = wafInspect(request);
  if (rule) {
    const seconds = recordFailure("waf", ip);
    console.warn(`[waf] ${ip} ${request.method} ${request.nextUrl.pathname} règle=${rule}${seconds ? ` banni ${seconds}s` : ""}`);
    return blocked(403);
  }

  const { pathname } = request.nextUrl;
  if (process.env.AUTH_DISABLED === "true" || PUBLIC.test(pathname) || request.cookies.has("hm_session")) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
