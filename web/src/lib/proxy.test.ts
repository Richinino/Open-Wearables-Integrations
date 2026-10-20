import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { createSessionToken } from "./session";
import { TEST_SECRET as SECRET, TEST_CLAIMS as CLAIMS, TEST_NOW as NOW } from "./account-test-fixtures";
beforeEach(() => { vi.stubEnv("SESSION_SECRET", SECRET); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const request = (path: string, token?: string) => new NextRequest(`https://site.example.test${path}`, { headers: { ...(token ? { cookie: `owi_session=${token}` } : {}), "x-account-pathname": "/ucet" } });
describe("proxy", () => {
  it.each(["/login", "/registracia", "/zabudnute-heslo", "/nove-heslo/synthetic-token", "/icon.svg", "/robots.txt"])("keeps %s public", async (path) => { expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1"); });
  it("does not redirect login based on potentially revoked signed cookie", async () => { expect((await proxy(request("/login", await createSessionToken(SECRET, CLAIMS)))).headers.get("x-middleware-next")).toBe("1"); });
  it("denies protected paths and overwrites trusted pathname", async () => {
    expect((await proxy(request("/"))).headers.get("location")).toBe("https://site.example.test/login");
    expect((await proxy(request("/api/data"))).status).toBe(401);
    const allowed = await proxy(request("/kalendar", await createSessionToken(SECRET, CLAIMS)));
    expect(allowed.headers.get("x-middleware-request-x-account-pathname")).toBe("/kalendar");
  });
});
