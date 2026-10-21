import type { AccountSession } from "./account-types";

/** A consistency precondition only. Authorization always comes from a fresh server session. */
export interface AccountIdentity { actorId: string; dataAccountId: string; viewOnly: boolean; sessionVersion: number }
export const IDENTITY_HEADER = "x-zdravie-identity";
export const IDENTITY_FIELD = "expected_identity";

export function sessionIdentity(session: AccountSession): AccountIdentity {
  return { actorId: session.account.id, dataAccountId: session.claims.x ?? session.account.id, viewOnly: Boolean(session.claims.x), sessionVersion: session.account.session_version };
}

export function parseIdentity(value: unknown): AccountIdentity | null {
  if (typeof value !== "string" || value.length > 1_000) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.actorId !== "string" || !parsed.actorId || parsed.actorId.length > 256 || typeof parsed.dataAccountId !== "string" || !parsed.dataAccountId || parsed.dataAccountId.length > 256 || typeof parsed.viewOnly !== "boolean" || !Number.isSafeInteger(parsed.sessionVersion) || parsed.sessionVersion < 0) return null;
    return { actorId: parsed.actorId, dataAccountId: parsed.dataAccountId, viewOnly: parsed.viewOnly, sessionVersion: parsed.sessionVersion };
  } catch { return null; }
}

export function sameIdentity(expected: AccountIdentity | null, actual: AccountIdentity | null): boolean {
  return Boolean(expected && actual && expected.actorId === actual.actorId && expected.dataAccountId === actual.dataAccountId && expected.viewOnly === actual.viewOnly && expected.sessionVersion === actual.sessionVersion);
}

export class AccountIdentityMismatchError extends Error {
  readonly code = "session_changed";
  constructor() { super("session_changed"); }
}

export function assertFormIdentity(form: FormData, session: AccountSession): void {
  if (!sameIdentity(parseIdentity(form.get(IDENTITY_FIELD)), sessionIdentity(session))) throw new AccountIdentityMismatchError();
}

export function identityChangeResult(error: unknown) {
  return error instanceof AccountIdentityMismatchError ? { error: "Účet sa zmenil v inom okne. Obnovujem stránku.", reload: true } : null;
}
