import "server-only";

import type { Account, AccountSession } from "./account-types";
import { sessionIdentity } from "./account-identity";
import { currentSession, endSession, startSession } from "./auth";
import { reserveLoginAttempt } from "./login-limit";
import { accountsApi, OwiAccountError } from "./owi-accounts";

const NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 4_096;
const UNAVAILABLE = "Služba je dočasne nedostupná. Skús to znova neskôr.";
const UNAUTHORIZED = "Relácia vypršala alebo už nie je platná. Prihlás sa znova.";

class MobileApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly retryAfterS?: number) {
    super(message);
  }
}

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function failure(error: unknown, login = false): Response {
  if (error instanceof MobileApiError) {
    return json({ error: error.code, message: error.message, ...(error.retryAfterS ? { retryAfterS: error.retryAfterS } : {}) }, error.status,
      error.retryAfterS ? { "Retry-After": String(error.retryAfterS) } : undefined);
  }
  if (login && error instanceof OwiAccountError) {
    if (error.status === 429) {
      const retry = Number.isSafeInteger(error.retryAfterS) && error.retryAfterS! > 0 && error.retryAfterS! <= 86_400 ? error.retryAfterS! : 900;
      return failure(new MobileApiError("too_many_attempts", 429, "Priveľa pokusov. Skús to znova neskôr.", retry));
    }
    if (error.status < 500 && ["invalid_credentials", "suspended", "forbidden"].includes(error.code)) {
      return failure(new MobileApiError("invalid_credentials", 401, "Nesprávny e-mail alebo heslo, alebo účet nie je dostupný."));
    }
  }
  // Backend codes, bodies, exception messages and credentials never enter the response.
  return json({ error: "unavailable", message: UNAVAILABLE }, 503);
}

function invalid(): never {
  throw new MobileApiError("invalid", 400, "Skontroluj vyplnené údaje.");
}

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  // NextRequest normalizes loopback IPs to localhost. Recover only the actual loopback
  // authority, preserving the port/protocol boundary and ignoring forwarding headers.
  if (url.hostname === "localhost" && host) {
    try {
      const incoming = new URL(`${url.protocol}//${host}`);
      if (incoming.host === host.toLowerCase() && incoming.port === url.port &&
        (/^127(?:\.\d{1,3}){3}$/.test(incoming.hostname) || incoming.hostname === "[::1]")) return incoming.origin;
    } catch { /* An invalid Host cannot supply an origin. */ }
  }
  return url.origin;
}

async function readMutation(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== requestOrigin(request)) {
    throw new MobileApiError("forbidden", 403, "Požiadavka nemá povolený pôvod.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new MobileApiError("unsupported_media_type", 415, "Požiadavka musí obsahovať JSON.");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) invalid();
  if (length !== null && Number(length) > MAX_BODY_BYTES) throw new MobileApiError("too_large", 413, "Požiadavka je príliš veľká.");
  if (!request.body) invalid();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new MobileApiError("too_large", 413, "Požiadavka je príliš veľká.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof MobileApiError) throw error;
    invalid();
  } finally { reader.releaseLock(); }
  if (length !== null && Number(length) !== size) invalid();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalid(); }
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  return body as Record<string, unknown>;
}

/** Copy only the shared Account contract, never arbitrary fields returned by an upstream. */
function mobileAccount(account: Account): Account {
  if (!account || typeof account !== "object" || typeof account.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(account.id) ||
    typeof account.first_name !== "string" || typeof account.email !== "string" ||
    (account.last_name !== null && typeof account.last_name !== "string") ||
    !["admin", "user"].includes(account.role) || !["pending", "active", "suspended"].includes(account.status) ||
    !Number.isSafeInteger(account.session_version) || account.session_version < 0 ||
    typeof account.paired !== "boolean" || typeof account.has_samsung !== "boolean" ||
    (account.birth_date !== null && typeof account.birth_date !== "string") || ![null, "male", "female"].includes(account.sex) ||
    typeof account.training_consent !== "boolean" || typeof account.created_at !== "string" ||
    (account.last_login_at !== null && typeof account.last_login_at !== "string") || !account.settings ||
    !["system", "light", "dark"].includes(account.settings.theme) || !["performance", "apple", "samsung"].includes(account.settings.sleep_score) ||
    !["auto", "morning"].includes(account.settings.overview_mode)) throw new MobileApiError("unavailable", 503, UNAVAILABLE);
  return {
    id: account.id, email: account.email, first_name: account.first_name, last_name: account.last_name,
    role: account.role, status: account.status, paired: account.paired, birth_date: account.birth_date, sex: account.sex,
    training_consent: account.training_consent,
    settings: { theme: account.settings.theme, sleep_score: account.settings.sleep_score, overview_mode: account.settings.overview_mode },
    has_samsung: account.has_samsung, created_at: account.created_at, last_login_at: account.last_login_at, session_version: account.session_version,
  };
}

function sessionResponse(session: AccountSession | null): Response {
  if (!session || session.claims.x) throw new MobileApiError("unauthorized", 401, UNAUTHORIZED);
  return json({ account: mobileAccount(session.account), identity: sessionIdentity(session), expiresAt: session.claims.e, persistent: session.claims.p });
}

export async function mobileLogin(request: Request): Promise<Response> {
  let started = false;
  try {
    const body = await readMutation(request);
    const quota = await reserveLoginAttempt();
    if (quota === "limited") throw new MobileApiError("too_many_attempts", 429, "Priveľa pokusov. Skús to znova o 15 minút.", 900);
    if (quota !== "allowed") throw new MobileApiError("unavailable", 503, UNAVAILABLE);
    if (Object.keys(body).sort().join(",") !== "email,password,remember" || typeof body.email !== "string" ||
      typeof body.password !== "string" || typeof body.remember !== "boolean") invalid();
    const email = body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !body.password || body.password.length > 256) invalid();
    const account = mobileAccount(await accountsApi.login({ email, password: body.password }));
    if (account.status === "suspended") throw new MobileApiError("unauthorized", 401, UNAUTHORIZED);
    await startSession(account, body.remember);
    started = true;
    // Read the new cookie through the same fresh status/version validation as all web data routes.
    return sessionResponse(await currentSession());
  } catch (error) {
    if (started) await endSession();
    return failure(error, true);
  }
}

export async function mobileSession(): Promise<Response> {
  try { return sessionResponse(await currentSession()); }
  catch (error) { return failure(error); }
}

export async function mobileSessionHead(): Promise<Response> {
  const response = await mobileSession();
  return new Response(null, { status: response.status, headers: response.headers });
}

export async function mobileLogout(request: Request): Promise<Response> {
  try {
    const body = await readMutation(request);
    if (Object.keys(body).length !== 0) invalid();
    await endSession();
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) { return failure(error); }
}

export function mobileMethodNotAllowed(allow: string): Response {
  return json({ error: "method_not_allowed", message: "Táto metóda nie je povolená." }, 405, { Allow: allow });
}
