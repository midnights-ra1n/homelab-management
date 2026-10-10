import { NextResponse, type NextRequest } from "next/server";

/**
 * Contrôle optimiste : sans cookie de session, redirection vers /login.
 * La validation réelle de la session est faite côté serveur (requireUser).
 */
export function proxy(request: NextRequest) {
  if (process.env.AUTH_DISABLED === "true") return NextResponse.next();
  if (request.cookies.has("hm_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|setup|api/health|api/uploads|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|offline.html|icons/|.*\\.(?:svg|png|ico|webp)$).*)"],
};
