import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "@/proxy";

import { SESSION_COOKIE, createSessionToken, sessionKey } from "./session";

const SECRET = "unit-test-secret-0123456789-abcdefghij";
const ORIGIN = "http://localhost:3100";

function request(path: string, options: { cookie?: string; method?: string } = {}): NextRequest {
  const headers = new Headers();
  if (options.cookie !== undefined) headers.set("cookie", `${SESSION_COOKIE}=${options.cookie}`);
  return new NextRequest(`${ORIGIN}${path}`, { method: options.method ?? "GET", headers });
}

const passedThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

function redirectTarget(response: Response): string | null {
  const location = response.headers.get("location");
  return response.status >= 300 && response.status < 400 && location
    ? new URL(location).pathname
    : null;
}

let valid: string;

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("SITE_PASSWORD", "test-site-password");
  valid = await createSessionToken(sessionKey(SECRET, "test-site-password")!, Date.now());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy without a session", () => {
  it("redirects every page to the login page", async () => {
    for (const path of ["/", "/spanok", "/treningy", "/den/2026-10-12", "/anything/else", "/loginx"]) {
      const response = await proxy(request(path));
      expect(redirectTarget(response), path).toBe("/login");
      expect(passedThrough(response), path).toBe(false);
    }
  });

  it("answers API routes with 401 JSON instead of a redirect", async () => {
    for (const path of ["/api/data", "/api", "/api/anything/else"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(401);
      expect(await response.json(), path).toEqual({ error: "unauthorized" });
      expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    }
  });

  it("does not mistake a page whose name starts with 'api' for an API route", async () => {
    expect(redirectTarget(await proxy(request("/apidocs")))).toBe("/login");
  });

  it("lets the login page and the two public files through", async () => {
    for (const path of ["/login", "/robots.txt", "/favicon.ico"]) {
      expect(passedThrough(await proxy(request(path))), path).toBe(true);
    }
  });

  it("lets the login form's Server Action POST through", async () => {
    expect(passedThrough(await proxy(request("/login", { method: "POST" })))).toBe(true);
  });

  it("protects paths below /login", async () => {
    expect(redirectTarget(await proxy(request("/login/anything")))).toBe("/login");
  });

  it("blocks other methods too", async () => {
    const page = await proxy(request("/", { method: "POST" }));
    expect(redirectTarget(page)).toBe("/login");
    const api = await proxy(request("/api/data", { method: "POST" }));
    expect(api.status).toBe(401);
  });
});

describe("proxy with a session", () => {
  it("lets pages and API routes through", async () => {
    for (const path of ["/", "/spanok", "/den/2026-10-12", "/api/data"]) {
      expect(passedThrough(await proxy(request(path, { cookie: valid }))), path).toBe(true);
    }
  });

  it("sends a visit to the login page on to the overview", async () => {
    expect(redirectTarget(await proxy(request("/login", { cookie: valid })))).toBe("/");
  });

  it("still lets a Server Action POST to /login through", async () => {
    const response = await proxy(request("/login", { cookie: valid, method: "POST" }));
    expect(passedThrough(response)).toBe(true);
  });
});

describe("proxy with an unusable session", () => {
  it("treats an expired token like no token", async () => {
    const expired = await createSessionToken(SECRET, Date.now(), -1000);
    expect(redirectTarget(await proxy(request("/", { cookie: expired })))).toBe("/login");
    expect((await proxy(request("/api/data", { cookie: expired }))).status).toBe(401);
    expect(passedThrough(await proxy(request("/login", { cookie: expired })))).toBe(true);
  });

  it("rejects a tampered token and one signed with another secret", async () => {
    const [expiresAt, signature] = valid.split(".");
    const extended = `${Number(expiresAt) + 1000}.${signature}`;
    const foreign = await createSessionToken("some-other-secret-0123456789-abcdefghij", Date.now());
    for (const cookie of [extended, foreign, "garbage", ""]) {
      expect(redirectTarget(await proxy(request("/", { cookie }))), cookie).toBe("/login");
      expect((await proxy(request("/api/data", { cookie }))).status, cookie).toBe(401);
    }
  });

  it("locks everything when SESSION_SECRET is not set", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(redirectTarget(await proxy(request("/", { cookie: valid })))).toBe("/login");
    expect((await proxy(request("/api/data", { cookie: valid }))).status).toBe(401);
    expect(passedThrough(await proxy(request("/login", { cookie: valid })))).toBe(true);
  });
});

describe("proxy matcher", () => {
  const runsOn = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("covers pages, API routes and public files", () => {
    for (const url of ["/", "/login", "/spanok", "/den/2026-10-12", "/api/data", "/robots.txt", "/_nextish"]) {
      expect(runsOn(url), url).toBe(true);
    }
  });

  it("skips framework assets", () => {
    for (const url of ["/_next/static/chunks/main.js", "/_next/image?url=%2Fa.png&w=64&q=75"]) {
      expect(runsOn(url), url).toBe(false);
    }
  });
});
