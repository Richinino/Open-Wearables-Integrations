import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Account, AccountSession, SessionClaims } from "./account-types";
import { accountsApi, OwiAccountError } from "./owi-accounts";
import { SESSION_COOKIE, SESSION_LIFETIME_MS, BROWSER_SESSION_LIFETIME_MS, createSessionToken, verifySessionToken, sessionKey } from "./session";
export class AuthError extends Error {
  constructor(public code: string, public status = 403) { super(code); this.name = "AuthError"; }
}
export async function currentSession(): Promise<AccountSession | null> {
  const claims = await verifySessionToken(sessionKey(process.env.SESSION_SECRET), (await cookies()).get(SESSION_COOKIE)?.value, Date.now());
  if (!claims) return null;
  let account: Account;
  try { account = await accountsApi.getAccount(claims.a); }
  catch (error) { if (error instanceof OwiAccountError && error.status === 404) return null; throw error; }
  if (account.id !== claims.a || !["pending", "active"].includes(account.status) || !["admin", "user"].includes(account.role) || account.session_version !== claims.v) return null;
  if (claims.x && (account.role !== "admin" || account.status !== "active")) return null;
  return { account, claims: { ...claims, r: account.role } };
}
export async function requireSession(): Promise<AccountSession> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}
export async function requireAdmin(): Promise<AccountSession> {
  const session = await requireSession();
  if (session.account.role !== "admin" || session.account.status !== "active" || session.claims.x) throw new AuthError("forbidden");
  return session;
}
export function assertWritable(claims: SessionClaims): void { if (claims.x) throw new AuthError("read_only"); }
async function validateTarget(account: Account, targetId: string): Promise<void> {
  if (account.role !== "admin" || account.status !== "active") throw new AuthError("forbidden");
  const fresh = await accountsApi.getAccount(account.id);
  if (fresh.id !== account.id || fresh.role !== "admin" || fresh.status !== "active" || fresh.session_version !== account.session_version) throw new AuthError("forbidden");
  const target = await accountsApi.getAccount(targetId);
  if (target.id !== targetId || target.status !== "active" || !target.paired) throw new AuthError("invalid_target");
}
async function writeSession(account: Account, persistent: boolean, viewAs: string | null, expiresAt?: number): Promise<void> {
  const secret = sessionKey(process.env.SESSION_SECRET);
  if (!secret) throw new AuthError("unavailable", 503);
  const lifetime = persistent ? SESSION_LIFETIME_MS : BROWSER_SESSION_LIFETIME_MS;
  const expiry = expiresAt ?? Date.now() + lifetime;
  const token = await createSessionToken(secret, { a: account.id, r: account.role, v: account.session_version, x: viewAs, p: persistent, e: expiry });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", ...(persistent ? { maxAge: Math.max(0, Math.floor((expiry - Date.now()) / 1000)) } : {}) });
}
export async function startSession(account: Account, persistent: boolean, viewAs: string | null = null): Promise<void> {
  if (account.status === "suspended") throw new AuthError("forbidden");
  if (viewAs) await validateTarget(account, viewAs);
  await writeSession(account, persistent, viewAs);
}
export async function setViewedAccount(session: AccountSession, accountId: string | null): Promise<void> {
  const fresh = await requireSession();
  if (fresh.account.id !== session.account.id) throw new AuthError("forbidden");
  if (accountId) await validateTarget(fresh.account, accountId);
  await writeSession(fresh.account, fresh.claims.p, accountId, fresh.claims.e);
}
export async function endSession(): Promise<void> { (await cookies()).delete(SESSION_COOKIE); }
