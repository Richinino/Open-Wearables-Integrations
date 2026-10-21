import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, sessionKey, verifySessionToken } from "@/lib/session";

const PUBLIC_FILES = new Set(["/robots.txt", "/favicon.ico", "/icon.svg"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const mobile = pathname === "/api/mobile" || pathname.startsWith("/api/mobile/");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-account-pathname", pathname);
  const next = () => NextResponse.next({ request: { headers: requestHeaders }, ...(mobile ? { headers: { "Cache-Control": "private, no-store" } } : {}) });
  if (PUBLIC_FILES.has(pathname)) return next();

  const authenticated = await verifySessionToken(
    sessionKey(process.env.SESSION_SECRET),
    request.cookies.get(SESSION_COOKIE)?.value,
    Date.now(),
  );

  if (pathname === "/api/mobile/login" || ["/login", "/registracia", "/zabudnute-heslo"].includes(pathname) || /^\/nove-heslo\/[^/]+$/.test(pathname)) {
    // Public login also accepts revoked cookies, so final backend validation cannot create a redirect loop.
    return next();
  }

  if (authenticated) return next();

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "unauthorized", ...(mobile ? { message: "Relácia vypršala alebo už nie je platná. Prihlás sa znova." } : {}) },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except framework assets. Must stay a literal: Next.js reads it at build time.
  matcher: ["/((?!_next/).*)"],
};
