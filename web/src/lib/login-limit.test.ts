import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reserveLoginAttempt } from "./login-limit";

const fetchMock = vi.fn<typeof fetch>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers({
    "x-vercel-forwarded-for": "203.0.113.9",
    "x-forwarded-for": "attacker-controlled",
  }),
}));
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("OWI_API_URL", "https://owi.example.test/owi");
  vi.stubEnv("OWI_WRITE_TOKEN", "test-write-token");
  vi.stubEnv("SESSION_SECRET", "test-secret-with-at-least-32-characters");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("persistent login quota", () => {
  it("reserves an attempt without sending the password or raw IP", async () => {
    fetchMock.mockResolvedValue(Response.json({ allowed: true }));
    expect(await reserveLoginAttempt()).toBe("allowed");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://owi.example.test/owi/v1/auth/attempt");
    expect(JSON.parse(String(options?.body)).client_key).toMatch(/^[a-f0-9]{64}$/);
    expect(String(options?.body)).not.toContain("203.0.113.9");
    expect(String(options?.body)).not.toContain("attacker-controlled");
  });
  it("honours a quota shared by other serverless instances", async () => {
    fetchMock.mockResolvedValue(Response.json({}, { status: 429 }));
    expect(await reserveLoginAttempt()).toBe("limited");
  });
  it("fails closed on an unavailable backend or missing credentials", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await reserveLoginAttempt()).toBe("unavailable");
    vi.stubEnv("OWI_WRITE_TOKEN", "");
    fetchMock.mockClear();
    expect(await reserveLoginAttempt()).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
