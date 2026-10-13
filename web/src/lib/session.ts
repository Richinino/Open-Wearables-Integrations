// Signed session tokens: "<expiresAtMs>.<base64url HMAC-SHA256(secret, expiresAtMs)>".
// Web Crypto only, so the same code runs in the proxy and in route handlers.
// The secret is always passed in; this module never reads the environment.

export const SESSION_COOKIE = "owi_session";
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const SIGNATURE_BYTES = 32;
const encoder = new TextEncoder();

function importKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), HMAC, false, [usage]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export async function createSessionToken(
  secret: string,
  now: number,
  lifetimeMs: number = SESSION_LIFETIME_MS,
): Promise<string> {
  if (!secret) throw new Error("Cannot sign a session without a secret");
  const expiresAt = String(Math.floor(now + lifetimeMs));
  const key = await importKey(secret, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(expiresAt));
  return `${expiresAt}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(
  secret: string | undefined,
  token: string | undefined,
  now: number,
): Promise<boolean> {
  if (!secret || !token) return false;

  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const expiresAt = token.slice(0, separator);
  if (!/^\d{1,15}$/.test(expiresAt)) return false;
  const signature = fromBase64Url(token.slice(separator + 1));
  if (!signature || signature.length !== SIGNATURE_BYTES) return false;

  // The signature is checked before the expiry is trusted, and in constant time.
  const key = await importKey(secret, "verify");
  const authentic = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(expiresAt));
  return authentic && Number(expiresAt) > now;
}
