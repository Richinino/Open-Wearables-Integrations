import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { createSessionToken } from "./session";
import { TEST_SECRET as SECRET, TEST_CLAIMS as CLAIMS, TEST_NOW as NOW } from "./account-test-fixtures";
beforeEach(() => { vi.stubEnv("SESSION_SECRET", SECRET); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const request = (path: string, token?: string) => new NextRequest(`https://site.example.test${path}`, { headers: { ...(token ? { cookie: `owi_session=${token}` } : {}), "x-account-pathname": "/ucet" } });
describe("proxy", () => {
  it.each(["/login", "/registracia", "/zabudnute-heslo", "/nove-heslo/synthetic-token", "/icon.svg", "/robots.txt", "/api/mobile/login"])("keeps %s public", async (path) => { expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1"); });
  it("does not redirect login based on potentially revoked signed cookie", async () => { expect((await proxy(request("/login", await createSessionToken(SECRET, CLAIMS)))).headers.get("x-middleware-next")).toBe("1"); });
  it("denies protected paths and overwrites trusted pathname", async () => {
    expect((await proxy(request("/"))).headers.get("location")).toBe("https://site.example.test/login");
    expect((await proxy(request("/api/data"))).status).toBe(401);
    const allowed = await proxy(request("/kalendar", await createSessionToken(SECRET, CLAIMS)));
    expect(allowed.headers.get("x-middleware-request-x-account-pathname")).toBe("/kalendar");
  });
  it.each(["/api/mobile", "/api/mobile/", "/api/mobile/login/", "/api/mobile/login-extra", "/api/mobile/login/nested", "/api/mobile/session", "/api/mobile/logout", "/api/data", "/api/entries/2026-10-20", "/api/other"])("keeps %s protected", async (path) => {
    const response = await proxy(request(path));
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(await response.json()).toEqual(path.startsWith("/api/mobile") ? { error: "unauthorized", message: expect.any(String) } : { error: "unauthorized" });
    expect((await proxy(request(path, await createSessionToken(SECRET, CLAIMS)))).headers.get("x-middleware-next")).toBe("1");
  });
  it("adds no-store to mobile routes and rejects expired sessions before the handler", async () => {
    const login = await proxy(request("/api/mobile/login", "invalid-cookie"));
    expect(login.headers.get("x-middleware-next")).toBe("1"); expect(login.headers.get("cache-control")).toBe("private, no-store");
    const expired = await createSessionToken(SECRET, { ...CLAIMS, e: NOW });
    expect((await proxy(request("/api/mobile/session", expired))).status).toBe(401);
  });
});
