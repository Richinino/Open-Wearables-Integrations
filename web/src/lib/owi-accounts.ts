import "server-only";
import type { Account, AccountAdmin, AccountSettings, AccountSources, InboxItem, OwUser, SystemStatus } from "./account-types";
export class OwiAccountError extends Error {
  constructor(public code: string, public status: number, public fields?: Record<string, string>, public retryAfterS?: number) { super(code); this.name = "OwiAccountError"; }
}
async function request<T>(path: string, method = "GET", body?: unknown, actingId?: string, clientKey?: string): Promise<T> {
  const base = process.env.OWI_API_URL, token = process.env.OWI_WRITE_TOKEN;
  if (!base || !token) throw new OwiAccountError("unavailable", 503);
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", ...(actingId ? { "X-Owi-Acting": actingId } : {}), ...(clientKey ? { "X-Owi-Client-Ip": clientKey } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new OwiAccountError("unavailable", 503); }
  if (response.status === 204) return undefined as T;
  let result: unknown;
  try { result = await response.json(); } catch { throw new OwiAccountError("unavailable", 503); }
  if (!response.ok) {
    const raw = result && typeof result === "object" ? result as Record<string, unknown> : {};
    const code = typeof raw.error === "string" && /^[a-z_]{1,50}$/.test(raw.error) ? raw.error : "unavailable";
    const fields = raw.fields && typeof raw.fields === "object" ? Object.fromEntries(Object.keys(raw.fields).filter((k) => /^[a-z_]{1,40}$/.test(k)).slice(0, 20).map((k) => [k, "Neplatná hodnota"])) : undefined;
    throw new OwiAccountError(code, response.status, fields, typeof raw.retry_after_s === "number" ? raw.retry_after_s : undefined);
  }
  return result as T;
}
const id = encodeURIComponent;
async function getAccount(accountId: string): Promise<Account> {
  const account = await request<Account>(`/v1/accounts/${id(accountId)}`);
  if (!account || typeof account !== "object" || account.id !== accountId ||
    !["admin", "user"].includes(account.role) || !["active", "pending", "suspended"].includes(account.status) ||
    !Number.isSafeInteger(account.session_version) || typeof account.paired !== "boolean" || typeof account.has_samsung !== "boolean" ||
    !account.settings || typeof account.first_name !== "string" || typeof account.email !== "string") throw new OwiAccountError("unavailable", 503);
  return account;
}
export const accountsApi = {
  getAccount,
  register: (input: { first_name: string; last_name?: string | null; email: string; password: string }, clientKey: string) => request<Account>("/v1/accounts/register", "POST", input, undefined, clientKey),
  login: (input: { email: string; password: string }) => request<Account>("/v1/accounts/login", "POST", input),
  updateAccount: (a: string, patch: Partial<Pick<Account, "first_name" | "last_name" | "email" | "birth_date" | "sex" | "training_consent">> & { settings?: Partial<AccountSettings> }) => request<Account>(`/v1/accounts/${id(a)}`, "PATCH", patch),
  changePassword: (a: string, current: string, newPassword: string) => request<Account>(`/v1/accounts/${id(a)}/password`, "POST", { current_password: current, new_password: newPassword }),
  logoutAll: (a: string) => request<Account>(`/v1/accounts/${id(a)}/logout-all`, "POST"),
  deleteOwnAccount: (a: string, password: string) => request<void>(`/v1/accounts/${id(a)}`, "DELETE", { password }),
  requestReset: (email: string) => request<void>("/v1/password-reset/request", "POST", { email }),
  confirmReset: (token: string, newPassword: string) => request<Account>("/v1/password-reset/confirm", "POST", { token, new_password: newPassword }),
  adminAccounts: (acting: string) => request<AccountAdmin[]>("/v1/admin/accounts", "GET", undefined, acting),
  owUsers: (acting: string) => request<OwUser[]>("/v1/admin/ow-users", "GET", undefined, acting),
  pairAccount: (acting: string, target: string, ow: string) => request<AccountAdmin>(`/v1/admin/accounts/${id(target)}/pair`, "POST", { ow_user_id: ow }, acting),
  unpairAccount: (acting: string, target: string) => request<AccountAdmin>(`/v1/admin/accounts/${id(target)}/unpair`, "POST", undefined, acting),
  updateAdminAccount: (acting: string, target: string, patch: { role?: Account["role"]; status?: Account["status"] }) => request<AccountAdmin>(`/v1/admin/accounts/${id(target)}`, "PATCH", patch, acting),
  deleteAccount: (acting: string, target: string) => request<void>(`/v1/admin/accounts/${id(target)}`, "DELETE", undefined, acting),
  createResetLink: (acting: string, target: string) => request<{ token: string; expires_at: string }>(`/v1/admin/accounts/${id(target)}/reset-link`, "POST", undefined, acting),
  accountSources: (acting: string, target: string) => request<AccountSources>(`/v1/admin/accounts/${id(target)}/sources`, "GET", undefined, acting),
  inbox: (acting: string, resolved = false) => request<InboxItem[]>(`/v1/admin/inbox?resolved=${resolved ? "1" : "0"}`, "GET", undefined, acting),
  resolveInbox: (acting: string, item: string | number) => request<InboxItem>(`/v1/admin/inbox/${id(String(item))}/resolve`, "POST", undefined, acting),
  system: (acting: string) => request<SystemStatus>("/v1/admin/system", "GET", undefined, acting),
  updateSystem: (acting: string, registrationOpen: boolean) => request<SystemStatus>("/v1/admin/system", "PUT", { registration_open: registrationOpen }, acting),
};
