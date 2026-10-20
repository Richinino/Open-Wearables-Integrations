import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, sessionKey, verifySessionToken } from "@/lib/session";

const PUBLIC_FILES = new Set(["/robots.txt", "/favicon.ico", "/icon.svg"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-account-pathname", pathname);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  if (PUBLIC_FILES.has(pathname)) return next();

  const authenticated = await verifySessionToken(
    sessionKey(process.env.SESSION_SECRET),
    request.cookies.get(SESSION_COOKIE)?.value,
    Date.now(),
  );

  if (["/login", "/registracia", "/zabudnute-heslo"].includes(pathname) || /^\/nove-heslo\/[^/]+$/.test(pathname)) {
    // Public login also accepts revoked cookies, so final backend validation cannot create a redirect loop.
    return next();
  }

  if (authenticated) return next();

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except framework assets. Must stay a literal: Next.js reads it at build time.
  matcher: ["/((?!_next/).*)"],
};
