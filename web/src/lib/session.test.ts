import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken, sessionKey, SESSION_LIFETIME_MS } from "./session";
import { TEST_SECRET as SECRET, TEST_CLAIMS as CLAIMS, TEST_NOW as NOW } from "./account-test-fixtures";
describe("account session signatures", () => {
  it("round-trips signed claims and rejects tampering and another secret", async () => {
    const token = await createSessionToken(SECRET, CLAIMS);
    expect(await verifySessionToken(SECRET, token, NOW)).toEqual(CLAIMS);
    expect(await verifySessionToken(SECRET + "other", token, NOW)).toBeNull();
    const [body, signature] = token.split(".");
    expect(await verifySessionToken(SECRET, `${body.slice(0, -1)}A.${signature}`, NOW)).toBeNull();
    expect(await verifySessionToken(SECRET, `${body}.${signature.slice(0, -1)}A`, NOW)).toBeNull();
  });
  it("expires exactly at expiry and rejects an overlong browser session", async () => {
    const token = await createSessionToken(SECRET, CLAIMS);
    expect(await verifySessionToken(SECRET, token, CLAIMS.e)).toBeNull();
    expect(await verifySessionToken(SECRET, await createSessionToken(SECRET, { ...CLAIMS, e: NOW + SESSION_LIFETIME_MS }), NOW)).toBeNull();
    expect(await verifySessionToken(SECRET, await createSessionToken(SECRET, { ...CLAIMS, p: true, e: NOW + SESSION_LIFETIME_MS }), NOW)).not.toBeNull();
  });
  it.each([undefined, "", "short", " ".repeat(40), "a".repeat(40)])("rejects weak or absent secret %s", async (secret) => {
    expect(sessionKey(secret)).toBeUndefined();
    expect(await verifySessionToken(secret, "token", NOW)).toBeNull();
    await expect(createSessionToken(secret ?? "", CLAIMS)).rejects.toThrow();
  });
  it.each([undefined, "", "12345.signature", "a.b.c", "!.$", "A".repeat(3000)])("rejects old or malformed tokens", async (token) => {
    expect(await verifySessionToken(SECRET, token, NOW)).toBeNull();
  });
  it("refuses malformed or unauthorized claims before signing", async () => {
    for (const patch of [{ a: "../other" }, { r: "owner" }, { v: -1 }, { x: "other" }, { e: Infinity }, { p: "yes" }]) {
      await expect(createSessionToken(SECRET, { ...CLAIMS, ...patch } as typeof CLAIMS)).rejects.toThrow();
    }
  });
});
