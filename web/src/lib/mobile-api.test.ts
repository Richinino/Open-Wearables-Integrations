import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as loginGet, POST as login, OPTIONS as loginOptions } from "@/app/api/mobile/login/route";
import { GET as session, HEAD as sessionHead, POST as sessionPost } from "@/app/api/mobile/session/route";
import { POST as logout, GET as logoutGet } from "@/app/api/mobile/logout/route";
import { TEST_ACCOUNT as ACCOUNT, TEST_CLAIMS as CLAIMS, TEST_NOW as NOW, TEST_SECRET as SECRET } from "./account-test-fixtures";
import { BROWSER_SESSION_LIFETIME_MS, createSessionToken, SESSION_COOKIE, SESSION_LIFETIME_MS, verifySessionToken } from "./session";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  set: vi.fn(), delete: vi.fn(), headers: new Headers(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === "owi_session" && mocks.cookie ? { value: mocks.cookie } : undefined,
    set: (name: string, value: string, options: unknown) => { mocks.set(name, value, options); mocks.cookie = value; },
    delete: (name: string) => { mocks.delete(name); mocks.cookie = undefined; },
  }),
  headers: async () => mocks.headers,
}));
const fetchMock = vi.fn<typeof fetch>();
const URL_BASE = "https://site.example.test";
const WRITE_SECRET = "synthetic-upstream-write-secret";

function mutation(path = "login", body: unknown = { email: " TEST@example.test ", password: "synthetic-password", remember: false }, headers: Record<string, string> = {}): Request {
  return new Request(`${URL_BASE}/api/mobile/${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}
function upstreamAccount(patch: Record<string, unknown> = {}) {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith("/v1/auth/attempt")) return Response.json({ allowed: true });
    return Response.json({ ...ACCOUNT, ...patch });
  });
}
function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.has("access-control-allow-origin")).toBe(false);
  expect(response.headers.has("access-control-allow-credentials")).toBe(false);
}
async function signed(claims = CLAIMS) { mocks.cookie = await createSessionToken(SECRET, claims); }

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubEnv("SESSION_SECRET", SECRET); vi.stubEnv("OWI_API_URL", "https://owi.example.test/owi");
  vi.stubEnv("OWI_WRITE_TOKEN", WRITE_SECRET); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL", "1");
  mocks.cookie = undefined;
  mocks.headers = new Headers({ "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "untrusted-address" });
  vi.stubGlobal("fetch", fetchMock);
  upstreamAccount();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("mobile login and shared session cookie", () => {
  it.each([false, true])("logs in with persistent=%s and returns the signed expiry without a token", async (persistent) => {
    const response = await login(mutation("login", { email: " TEST@example.test ", password: "synthetic-password", remember: persistent }));
    expect(response.status).toBe(200); expectPrivate(response);
    const expectedExpiry = NOW + (persistent ? SESSION_LIFETIME_MS : BROWSER_SESSION_LIFETIME_MS);
    expect(await response.json()).toEqual({
      account: ACCOUNT, identity: { actorId: ACCOUNT.id, dataAccountId: ACCOUNT.id, viewOnly: false, sessionVersion: 0 },
      expiresAt: expectedExpiry, persistent,
    });
    expect(mocks.set).toHaveBeenCalledWith(SESSION_COOKIE, expect.any(String), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", ...(persistent ? { maxAge: SESSION_LIFETIME_MS / 1000 } : {}),
    });
    expect(await verifySessionToken(SECRET, mocks.cookie, NOW)).toEqual({ ...CLAIMS, p: persistent, e: expectedExpiry });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://owi.example.test/owi/v1/auth/attempt", "https://owi.example.test/owi/v1/accounts/login", `https://owi.example.test/owi/v1/accounts/${ACCOUNT.id}`,
    ]);
    const quotaBody = String(fetchMock.mock.calls[0][1]?.body);
    expect(JSON.parse(quotaBody)).toEqual({ client_key: expect.stringMatching(/^[a-f0-9]{64}$/) });
    for (const marker of ["synthetic-password", "203.0.113.9", "untrusted-address"]) expect(quotaBody).not.toContain(marker);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ email: "test@example.test", password: "synthetic-password" });
    const read = await session(); expect(read.status).toBe(200); expectPrivate(read);
    expect((await read.json()).expiresAt).toBe(expectedExpiry);
  });

  it("allows pending accounts and uses only the actor in the returned identity", async () => {
    upstreamAccount({ status: "pending", paired: false });
    const response = await login(mutation());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ account: { status: "pending", paired: false }, identity: { actorId: ACCOUNT.id, dataAccountId: ACCOUNT.id, viewOnly: false } });
  });

  it("never echoes upstream extensions, password, cookie, service URL or secrets", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    upstreamAccount({ password: "backend-password", password_hash: "backend-hash", token: WRITE_SECRET,
      settings: { ...ACCOUNT.settings, token: WRITE_SECRET }, private_url: "https://owi.example.test/owi" });
    const response = await login(mutation());
    const body = await response.text();
    expect(response.status).toBe(200);
    for (const marker of ["backend-password", "backend-hash", "synthetic-password", SECRET, WRITE_SECRET, "https://owi.example.test", mocks.cookie!]) expect(body).not.toContain(marker);
    expect(logger).not.toHaveBeenCalled();
  });

  it.each([
    { email: "bad", password: "synthetic-password", remember: false },
    { email: "a@b.test", password: "", remember: false },
    { email: "a@b.test", password: "x".repeat(257), remember: false },
    { email: "a@b.test", password: "synthetic-password", remember: "true" },
    { email: "a@b.test", password: "synthetic-password" },
    { email: "a@b.test", password: "synthetic-password", remember: false, viewAs: "victim" },
  ])("counts invalid credential input against the shared quota: %o", async (body) => {
    const response = await login(mutation("login", body));
    expect(response.status).toBe(400); expectPrivate(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v1/auth/attempt"); expect(mocks.set).not.toHaveBeenCalled();
  });

  it.each([429, 503])("fails closed before authentication when shared quota returns %s", async (status) => {
    fetchMock.mockResolvedValue(Response.json({ error: "private-upstream-content" }, { status }));
    const response = await login(mutation());
    expect(response.status).toBe(status); expectPrivate(response); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.set).not.toHaveBeenCalled(); expect(await response.text()).not.toContain("private-upstream-content");
    if (status === 429) expect(response.headers.get("retry-after")).toBe("900");
  });

  it.each([
    [401, "invalid_credentials", 401], [403, "suspended", 401], [429, "too_many_attempts", 429],
    [500, "invalid_credentials", 503], [400, "private_backend_code", 503],
  ])("maps upstream login %s/%s to public status %s", async (status, code, expected) => {
    fetchMock.mockResolvedValueOnce(Response.json({ allowed: true })).mockResolvedValueOnce(Response.json({ error: code, message: WRITE_SECRET, retry_after_s: 45 }, { status }));
    const response = await login(mutation());
    expect(response.status).toBe(expected); expectPrivate(response); expect(mocks.set).not.toHaveBeenCalled();
    const body = await response.json(); expect(body.message).toEqual(expect.any(String)); expect(JSON.stringify(body)).not.toContain(WRITE_SECRET);
    if (expected === 429) { expect(response.headers.get("retry-after")).toBe("45"); expect(body.retryAfterS).toBe(45); }
  });

  it.each([{ status: "suspended" }, { role: "owner" }, { session_version: -1 }, { settings: { theme: "invalid" } }])("does not issue a valid cookie for rejected upstream account %o", async (patch) => {
    upstreamAccount(patch);
    const response = await login(mutation()); expect(response.status).toBe(patch.status === "suspended" ? 401 : 503);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("clears a newly issued cookie if the account was invalidated during login", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ allowed: true })).mockResolvedValueOnce(Response.json(ACCOUNT))
      .mockResolvedValueOnce(Response.json({ ...ACCOUNT, session_version: 1 }));
    const response = await login(mutation());
    expect(response.status).toBe(401); expect(mocks.delete).toHaveBeenCalledWith(SESSION_COOKIE); expect(mocks.cookie).toBeUndefined();
  });

  it("clears a new cookie and returns 503 if fresh validation fails", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ allowed: true })).mockResolvedValueOnce(Response.json(ACCOUNT)).mockRejectedValueOnce(new Error(WRITE_SECRET));
    const response = await login(mutation()); expect(response.status).toBe(503); expect(mocks.cookie).toBeUndefined();
    expect(await response.text()).not.toContain(WRITE_SECRET);
  });
});

describe("fresh mobile session authority", () => {
  it.each(["missing", "tampered", "expired"])("rejects %s cookie before calling backend", async (kind) => {
    if (kind === "tampered") mocks.cookie = "invalid.signature";
    if (kind === "expired") await signed({ ...CLAIMS, e: NOW });
    const response = await session(); expect(response.status).toBe(401); expectPrivate(response); expect(fetchMock).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "unauthorized", message: expect.any(String) });
  });
  it.each([{ status: "suspended" }, { session_version: 1 }])("rejects invalidated account %o", async (patch) => {
    await signed(); upstreamAccount(patch);
    const response = await session(); expect(response.status).toBe(401); expectPrivate(response);
  });
  it("rejects deleted accounts with 401 and backend failures with 503", async () => {
    await signed();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "not_found" }, { status: 404 }));
    expect((await session()).status).toBe(401);
    fetchMock.mockResolvedValueOnce(new Response("private-gateway-content", { status: 503 }));
    const unavailable = await session(); expect(unavailable.status).toBe(503); expectPrivate(unavailable);
    expect(await unavailable.json()).toEqual({ error: "unavailable", message: expect.any(String) });
    expect(mocks.cookie).toBeDefined(); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("reports the current role without granting a stale signed admin role", async () => {
    await signed({ ...CLAIMS, r: "admin" });
    const response = await session(); expect(response.status).toBe(200); expect((await response.json()).account.role).toBe("user");
  });
  it.each(["target-account", ACCOUNT.id])("rejects view-as session even for target %s", async (target) => {
    await signed({ ...CLAIMS, r: "admin", x: target }); upstreamAccount({ role: "admin" });
    const response = await session(); expect(response.status).toBe(401); expectPrivate(response);
    expect(await response.json()).toEqual({ error: "unauthorized", message: expect.any(String) });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(String(fetchMock.mock.calls[0][0]).endsWith(`/accounts/${ACCOUNT.id}`)).toBe(true);
  });
  it("returns a pending session, fetches it each time and never renews its expiry", async () => {
    await signed(); upstreamAccount({ status: "pending", paired: false });
    for (let i = 0; i < 2; i++) { const response = await session(); expect((await response.json()).expiresAt).toBe(CLAIMS.e); }
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(mocks.set).not.toHaveBeenCalled();
    const head = await sessionHead(); expect(head.status).toBe(200); expect(await head.text()).toBe(""); expectPrivate(head);
  });
});

describe("mutation request boundaries", () => {
  it.each(["127.0.0.1", "[::1]"])("preserves a same-origin loopback Host %s after Next URL normalization", async (host) => {
    const origin = `http://${host}:3132`;
    const request = new NextRequest(`${origin}/api/mobile/logout`, {
      method: "POST", headers: { host: `${host}:3132`, origin, "content-type": "application/json" }, body: "{}",
    });
    expect(new URL(request.url).hostname).toBe("localhost");
    const response = await logout(request); expect(response.status).toBe(204); expectPrivate(response);
  });
  it.each(["attacker.example:3132", "127.0.0.1:3133", "127.0.0.1:3132/path", "user@127.0.0.1:3132", "127.0.0.1:3132, attacker.example"])("rejects invalid or mismatched loopback Host %s", async (host) => {
    const request = new NextRequest("http://127.0.0.1:3132/api/mobile/logout", {
      method: "POST", headers: { host, origin: "http://127.0.0.1:3132", "x-forwarded-host": "127.0.0.1:3132", "content-type": "application/json" }, body: "{}",
    });
    expect((await logout(request)).status).toBe(403); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("does not treat distinct localhost and loopback wire Origins as interchangeable", async () => {
    const request = new NextRequest("http://127.0.0.1:3132/api/mobile/logout", {
      method: "POST", headers: { host: "127.0.0.1:3132", origin: "http://localhost:3132", "content-type": "application/json" }, body: "{}",
    });
    expect((await logout(request)).status).toBe(403); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it.each([login, logout])("allows native missing Origin and exact same Origin", async (handler) => {
    for (const headers of [{}, { origin: URL_BASE }] as Record<string, string>[]) {
      const response = await handler(handler === login ? mutation("login", undefined, headers) : mutation("logout", {}, headers));
      expect(response.status).toBe(handler === login ? 200 : 204); expectPrivate(response);
    }
  });
  it.each(["https://attacker.example", "http://site.example.test", "https://site.example.test:444", "null", "", "https://site.example.test/path"])("rejects Origin %s without changing cookies", async (origin) => {
    for (const handler of [login, logout]) {
      const response = await handler(mutation(handler === login ? "login" : "logout", handler === login ? undefined : {}, { origin, host: "attacker.example", "x-forwarded-host": "attacker.example" }));
      expect(response.status).toBe(403); expectPrivate(response);
    }
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it.each(["text/plain", "application/x-www-form-urlencoded", "application/jsonp", "application/merge-patch+json"])("rejects non-JSON content type %s", async (contentType) => {
    for (const handler of [login, logout]) {
      const response = await handler(mutation("login", {}, { "content-type": contentType })); expect(response.status).toBe(415); expectPrivate(response);
    }
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("requires content type, handles invalid JSON and enforces Content-Length", async () => {
    const missingType = mutation(); missingType.headers.delete("content-type"); expect((await login(missingType)).status).toBe(415);
    for (const body of ["", "{broken-json", "null", "[]", '"text"']) {
      const response = await login(new Request(`${URL_BASE}/api/mobile/login`, { method: "POST", headers: { "content-type": "application/json" }, body }));
      expect(response.status).toBe(400); expectPrivate(response);
    }
    for (const length of ["-1", "NaN", "1", "9007199254740992"]) expect((await login(mutation("login", {}, { "content-length": length }))).status).toBe(400);
    const response = await login(mutation("login", {}, { "content-length": "4097" })); expect(response.status).toBe(413); expectPrivate(response);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("bounds bytes even without Content-Length and with multibyte characters", async () => {
    for (const extra of ["x".repeat(4_097), "ž".repeat(2_049)]) {
      const response = await login(mutation("login", { extra })); expect(response.status).toBe(413); expectPrivate(response);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("logs out by deleting the existing cookie and returns an empty 204", async () => {
    await signed();
    const response = await logout(mutation("logout", {}, { "content-type": "application/json; charset=utf-8", "content-length": "2" }));
    expect(response.status).toBe(204); expect(await response.text()).toBe(""); expectPrivate(response);
    expect(mocks.delete).toHaveBeenCalledWith(SESSION_COOKIE); expect(mocks.cookie).toBeUndefined(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects logout payload extensions before touching the session", async () => {
    const response = await logout(mutation("logout", { accountId: "another-account" })); expect(response.status).toBe(400); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it.each([loginGet, loginOptions, logoutGet, sessionPost])("returns private JSON 405 without a CORS preflight exemption", async (handler) => {
    const response = handler(); expect(response.status).toBe(405); expectPrivate(response);
    expect(response.headers.get("allow")).toEqual(expect.stringMatching(/^(POST|GET, HEAD)$/));
    expect(await response.json()).toEqual({ error: "method_not_allowed", message: expect.any(String) }); expect(fetchMock).not.toHaveBeenCalled();
  });
});
