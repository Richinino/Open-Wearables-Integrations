import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

const PUBLIC_FILES = new Set(["/robots.txt", "/favicon.ico", "/icon.svg"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_FILES.has(pathname)) return NextResponse.next();

  const authenticated = await verifySessionToken(
    process.env.SESSION_SECRET,
    request.cookies.get(SESSION_COOKIE)?.value,
    Date.now(),
  );

  if (pathname === "/login") {
    // Only navigations are bounced: the login form's Server Action is a POST to this same path.
    const isNavigation = request.method === "GET" || request.method === "HEAD";
    if (authenticated && isNavigation) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  if (authenticated) return NextResponse.next();

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
