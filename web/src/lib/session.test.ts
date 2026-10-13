import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  createSessionToken,
  verifySessionToken,
} from "./session";

const SECRET = "unit-test-secret-0123456789-abcdefghij";
const OTHER_SECRET = "another-unit-test-secret-9876543210-zyx";
const NOW = Date.UTC(2026, 9, 13, 10, 0, 0);

describe("constants", () => {
  it("names the cookie and lasts thirty days", () => {
    expect(SESSION_COOKIE).toBe("owi_session");
    expect(SESSION_LIFETIME_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("createSessionToken", () => {
  it("produces '<expiresAtMs>.<base64url signature>'", async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
    expect(Number(token.split(".")[0])).toBe(NOW + SESSION_LIFETIME_MS);
  });

  it("honours a custom lifetime", async () => {
    const token = await createSessionToken(SECRET, NOW, 60_000);
    expect(token.startsWith(`${NOW + 60_000}.`)).toBe(true);
  });

  it("is deterministic for equal input and differs per secret", async () => {
    expect(await createSessionToken(SECRET, NOW)).toBe(await createSessionToken(SECRET, NOW));
    expect(await createSessionToken(SECRET, NOW)).not.toBe(
      await createSessionToken(OTHER_SECRET, NOW),
    );
  });

  it("refuses to sign with an empty secret", async () => {
    await expect(createSessionToken("", NOW)).rejects.toThrow();
  });
});

describe("verifySessionToken", () => {
  it("accepts a fresh token until just before it expires", async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(SECRET, token, NOW)).toBe(true);
    expect(await verifySessionToken(SECRET, token, NOW + SESSION_LIFETIME_MS - 1)).toBe(true);
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(SECRET, token, NOW + SESSION_LIFETIME_MS)).toBe(false);
    expect(await verifySessionToken(SECRET, token, NOW + SESSION_LIFETIME_MS + 1)).toBe(false);

    const shortLived = await createSessionToken(SECRET, NOW, 1000);
    expect(await verifySessionToken(SECRET, shortLived, NOW + 999)).toBe(true);
    expect(await verifySessionToken(SECRET, shortLived, NOW + 1000)).toBe(false);
  });

  it("rejects a token whose expiry was changed", async () => {
    const expired = await createSessionToken(SECRET, NOW, -1000);
    expect(await verifySessionToken(SECRET, expired, NOW)).toBe(false);

    const signature = expired.split(".")[1];
    const extended = `${NOW + SESSION_LIFETIME_MS}.${signature}`;
    expect(await verifySessionToken(SECRET, extended, NOW)).toBe(false);
  });

  it("rejects a token whose signature was changed", async () => {
    const token = await createSessionToken(SECRET, NOW);
    const [expiresAt, signature] = token.split(".");
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    expect(await verifySessionToken(SECRET, `${expiresAt}.${flipped}`, NOW)).toBe(false);
    expect(await verifySessionToken(SECRET, `${expiresAt}.${signature.slice(0, -1)}`, NOW)).toBe(
      false,
    );
    expect(await verifySessionToken(SECRET, `${expiresAt}.${signature}A`, NOW)).toBe(false);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await createSessionToken(OTHER_SECRET, NOW);
    expect(await verifySessionToken(SECRET, token, NOW)).toBe(false);
  });

  it("rejects garbage without throwing", async () => {
    const valid = await createSessionToken(SECRET, NOW);
    const garbage = [
      "",
      ".",
      "abc",
      "123",
      "123.",
      ".abc",
      "12a.abc",
      "-5.abc",
      "1e3.abc",
      `${NOW + 1000}.!!!not-base64!!!`,
      `${NOW + 1000}.${"A".repeat(43)}`,
      `${valid}.extra`,
      ` ${valid}`,
      "x".repeat(5000),
    ];
    for (const token of garbage) {
      expect(await verifySessionToken(SECRET, token, NOW), JSON.stringify(token)).toBe(false);
    }
    expect(await verifySessionToken(SECRET, undefined, NOW)).toBe(false);
  });

  it("rejects everything when the secret is empty or missing", async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken("", token, NOW)).toBe(false);
    expect(await verifySessionToken(undefined, token, NOW)).toBe(false);
  });
});
