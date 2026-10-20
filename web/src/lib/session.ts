import type { SessionClaims } from "./account-types";
export const SESSION_COOKIE = "owi_session";
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const BROWSER_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
export function sessionKey(secret: string | undefined): string | undefined { return secret && secret.length >= 32 && secret.trim().length >= 32 && new Set(secret).size > 1 ? secret : undefined; }
function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try { return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)); } catch { return null; }
}
function validClaims(value: unknown): value is SessionClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  const id = (x: unknown) => typeof x === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
  return Object.keys(c).sort().join(",") === "a,e,p,r,v,x" && id(c.a) && (c.r === "admin" || c.r === "user") &&
    Number.isSafeInteger(c.v) && (c.v as number) >= 0 && (c.x === null || id(c.x)) && (c.x === null || c.r === "admin") &&
    typeof c.p === "boolean" && Number.isSafeInteger(c.e) && (c.e as number) > 0;
}
export async function createSessionToken(secret: string, claims: SessionClaims): Promise<string> {
  if (!sessionKey(secret) || !validClaims(claims)) throw new Error("Invalid session configuration or claims");
  const payload = encode(encoder.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), HMAC, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`owi-account-v1.${payload}`));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifySessionToken(secret: string | undefined, token: string | undefined, now: number): Promise<SessionClaims | null> {
  if (!sessionKey(secret) || !token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const payload = decode(parts[0]), signature = decode(parts[1]);
  if (!payload || !signature || signature.length !== 32) return null;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), HMAC, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, signature, encoder.encode(`owi-account-v1.${parts[0]}`)))) return null;
    const claims: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    return validClaims(claims) && claims.e > now && claims.e <= now + (claims.p ? SESSION_LIFETIME_MS : BROWSER_SESSION_LIFETIME_MS) ? claims : null;
  } catch { return null; }
}
