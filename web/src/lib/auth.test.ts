import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkPassword, endSession, hasValidSession, startSession } from "./auth";
import { SESSION_COOKIE, createSessionToken } from "./session";

// A stand-in for the request's cookie store.
const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = jar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      jar.set(name, { value, options });
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const PASSWORD = "unit-test-heslo-ľščťž";
const SECRET = "unit-test-secret-0123456789-abcdefghij";

beforeEach(() => {
  jar.clear();
  vi.stubEnv("SITE_PASSWORD", PASSWORD);
  vi.stubEnv("SESSION_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("checkPassword", () => {
  it("accepts only the exact password", async () => {
    expect(await checkPassword(PASSWORD)).toBe(true);
    for (const wrong of ["", "x", PASSWORD.slice(0, -1), `${PASSWORD} `, PASSWORD.toUpperCase()]) {
      expect(await checkPassword(wrong), JSON.stringify(wrong)).toBe(false);
    }
  });

  it.each(["SITE_PASSWORD", "SESSION_SECRET"])(
    "refuses everything and logs one line without values when %s is unset",
    async (name) => {
      vi.stubEnv(name, "");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await checkPassword(PASSWORD)).toBe(false);
      expect(await checkPassword("")).toBe(false);

      expect(log).toHaveBeenCalledTimes(2);
      for (const call of log.mock.calls) {
        expect(call).toHaveLength(1);
        expect(String(call[0])).not.toContain(PASSWORD);
        expect(String(call[0])).not.toContain(SECRET);
      }
    },
  );
});

describe("session cookie", () => {
  it("is set with the agreed attributes and then recognised", async () => {
    expect(await hasValidSession()).toBe(false);
    await startSession();

    const cookie = jar.get(SESSION_COOKIE);
    expect(cookie?.value).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
    expect(cookie?.options).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    expect(await hasValidSession()).toBe(true);
  });

  it("is Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await startSession();
    expect(jar.get(SESSION_COOKIE)?.options?.secure).toBe(true);
  });

  it("is gone after endSession", async () => {
    await startSession();
    await endSession();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await hasValidSession()).toBe(false);
  });

  it("is not accepted when forged, expired or signed with an old secret", async () => {
    jar.set(SESSION_COOKIE, { value: "garbage" });
    expect(await hasValidSession()).toBe(false);

    jar.set(SESSION_COOKIE, { value: await createSessionToken(SECRET, Date.now(), -1000) });
    expect(await hasValidSession()).toBe(false);

    await startSession();
    vi.stubEnv("SESSION_SECRET", "a-rotated-secret-0123456789-abcdefghij");
    expect(await hasValidSession()).toBe(false);
  });

  it("cannot be started without a secret", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    await expect(startSession()).rejects.toThrow();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
});
