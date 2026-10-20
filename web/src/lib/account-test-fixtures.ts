import type { Account, SessionClaims, AccountSession } from "./account-types";
export const TEST_ACCOUNT: Account = { id: "account-a", email: "test@example.test", first_name: "Test", last_name: null, role: "user", status: "active", paired: true, birth_date: null, sex: null, training_consent: true, settings: { theme: "system", sleep_score: "performance", overview_mode: "auto" }, has_samsung: true, created_at: "2026-10-20T00:00:00Z", last_login_at: null, session_version: 0 };
export const TEST_SECRET = "synthetic-secret-with-more-than-32-characters";
export const TEST_NOW = 1792454400000;
export const TEST_CLAIMS: SessionClaims = { a: TEST_ACCOUNT.id, r: "user", v: 0, x: null, p: false, e: TEST_NOW + 12 * 60 * 60 * 1000 };
export function testSession(account: Partial<Account> = {}, claims: Partial<SessionClaims> = {}): AccountSession { return { account: { ...TEST_ACCOUNT, ...account }, claims: { ...TEST_CLAIMS, ...claims } }; }
