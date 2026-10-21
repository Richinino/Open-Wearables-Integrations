import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/data/route";
import { PUT } from "@/app/api/entries/[date]/route";
import { createSessionToken } from "./session";
import { IDENTITY_HEADER } from "./account-identity";
import { TEST_ACCOUNT, TEST_CLAIMS, TEST_NOW, TEST_SECRET } from "./account-test-fixtures";

const mocks = vi.hoisted(() => ({ cookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));

const fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(TEST_NOW);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  vi.stubEnv("OWI_API_URL", "https://owi.example.test");
  vi.stubEnv("OWI_WRITE_TOKEN", "synthetic-write-token");
  vi.stubEnv("OWI_API_TOKEN", "synthetic-read-token");
  mocks.cookie.mockReturnValue({ value: await createSessionToken(TEST_SECRET, TEST_CLAIMS) });
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("old signed session after an established pairing changes", () => {
  it("rejects old data and form identity after another tab re-logs into the same account", async () => {
    const version = TEST_CLAIMS.v + 1;
    mocks.cookie.mockReturnValue({ value: await createSessionToken(TEST_SECRET, { ...TEST_CLAIMS, v: version }) });
    fetchMock.mockImplementation(async (url) => {
      expect(String(url)).toBe(`https://owi.example.test/v1/accounts/${TEST_ACCOUNT.id}`);
      return Response.json({ ...TEST_ACCOUNT, session_version: version });
    });
    const oldIdentity = JSON.stringify({ actorId: TEST_ACCOUNT.id, dataAccountId: TEST_ACCOUNT.id, viewOnly: false, sessionVersion: TEST_CLAIMS.v });
    const read = await GET(new Request("https://site.example.test/api/data", { headers: { [IDENTITY_HEADER]: oldIdentity } }));
    const write = await PUT(new Request("https://site.example.test/api/entries/2026-10-15", {
      method: "PUT", headers: { host: "site.example.test", origin: "https://site.example.test", [IDENTITY_HEADER]: oldIdentity, "content-type": "application/json" },
      body: JSON.stringify({ steps: 1234 }),
    }), { params: Promise.resolve({ date: "2026-10-15" }) });
    for (const response of [read, write]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "session_changed" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["unpaired", "re-paired", "direct replacement"])("blocks both data and entry saves when %s", async (state) => {
    // Python pairing tests establish that both mutation paths increment this version.
    // Keep the actual old signed claims; only the fresh backend account changes.
    const freshAccount = { ...TEST_ACCOUNT, session_version: TEST_CLAIMS.v + 1,
      ...(state === "unpaired" ? { paired: false, status: "pending" } : {}) };
    fetchMock.mockImplementation(async (url) => {
      expect(String(url)).toBe(`https://owi.example.test/v1/accounts/${TEST_ACCOUNT.id}`);
      return Response.json(freshAccount);
    });
    const identity = JSON.stringify({ actorId: TEST_ACCOUNT.id, dataAccountId: TEST_ACCOUNT.id, viewOnly: false, sessionVersion: 0 });
    const read = await GET(new Request("https://site.example.test/api/data", { headers: { [IDENTITY_HEADER]: identity } }));
    const write = await PUT(new Request("https://site.example.test/api/entries/2026-10-15", {
      method: "PUT", headers: { host: "site.example.test", origin: "https://site.example.test", [IDENTITY_HEADER]: identity, "content-type": "application/json" },
      body: JSON.stringify({ steps: 1234 }),
    }), { params: Promise.resolve({ date: "2026-10-15" }) });
    for (const response of [read, write]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // No /v1/days or /v1/entries request can resolve the replacement OW folder.
  });
});
