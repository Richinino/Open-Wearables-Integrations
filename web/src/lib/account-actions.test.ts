import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, AccountSession } from "./account-types";
import { changeOwnPassword, deleteOwnAccount, logoutAccount, logoutEverywhere, updateProfile, updateSettings, updateTheme } from "./account-actions";
import { adminAction, exitView, viewAccount } from "@/app/(app)/admin/actions";
import { OwiAccountError } from "./owi-accounts";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(), requireAdmin: vi.fn(), assertWritable: vi.fn(), startSession: vi.fn(), endSession: vi.fn(), setViewedAccount: vi.fn(), revalidate: vi.fn(),
  updateAccount: vi.fn(), changePassword: vi.fn(), logoutAll: vi.fn(), deleteOwnAccount: vi.fn(), getAccount: vi.fn(), owUsers: vi.fn(), pairAccount: vi.fn(), unpairAccount: vi.fn(), updateAdminAccount: vi.fn(), deleteAccount: vi.fn(), createResetLink: vi.fn(), resolveInbox: vi.fn(), updateSystem: vi.fn(),
}));
vi.mock("./auth", () => ({ requireSession: mocks.requireSession, requireAdmin: mocks.requireAdmin, assertWritable: mocks.assertWritable, startSession: mocks.startSession, endSession: mocks.endSession, setViewedAccount: mocks.setViewedAccount }));
vi.mock("./owi-accounts", async (original) => ({ ...(await original<typeof import("./owi-accounts")>()), accountsApi: mocks }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));

const account: Account = { id: "actor", email: "actor@example.test", first_name: "Test", last_name: null, role: "admin", status: "active", paired: true, birth_date: null, sex: null, training_consent: true, settings: { theme: "system", sleep_score: "performance", overview_mode: "auto" }, has_samsung: true, created_at: "2026-01-01", last_login_at: null, session_version: 1 };
let session: AccountSession;
function form(values: Record<string, string> = {}) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
const profile = { first_name: "Jana", email: "jana@example.test", sex: "female", id: "victim", actor: "victim", role: "admin" };
beforeEach(() => {
  vi.resetAllMocks();
  session = { account: { ...account }, claims: { a: "actor", r: "admin", v: 1, x: null, p: true, e: 9999999999999 } };
  mocks.requireSession.mockImplementation(async () => session);
  mocks.requireAdmin.mockImplementation(async () => {
    if (session.account.role !== "admin" || session.account.status !== "active" || session.claims.x) throw { code: "forbidden" };
    return session;
  });
  mocks.assertWritable.mockImplementation((claims) => { if (claims.x) throw { code: "read_only" }; });
});

describe("profile actions", () => {
  it("updates only the fresh session actor and excludes submitted identity and role", async () => {
    expect(await updateProfile({}, form(profile))).toHaveProperty("success");
    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(mocks.updateAccount).toHaveBeenCalledWith("actor", { first_name: "Jana", last_name: null, email: "jana@example.test", birth_date: null, sex: "female", training_consent: false });
  });
  it("blocks every profile mutation in view mode", async () => {
    session.claims.x = "viewed";
    const settings = form({ theme: "dark", sleep_score: "apple", overview_mode: "auto" });
    for (const result of [await updateProfile({}, form(profile)), await updateSettings({}, settings), await changeOwnPassword({}, form()), await logoutEverywhere({}, form({ confirmation: "ODHLÁSIŤ" })), await deleteOwnAccount({}, form({ confirmation: "ZMAZAŤ", password: "secret" })), await updateTheme("dark")]) expect(result.error).toContain("nedá zapisovať");
    for (const mock of [mocks.updateAccount, mocks.changePassword, mocks.logoutAll, mocks.deleteOwnAccount]) expect(mock).not.toHaveBeenCalled();
  });
  it("lets a pending actor update their own profile", async () => {
    session.account.status = "pending";
    expect(await updateProfile({}, form(profile))).toHaveProperty("success");
  });
  it("persists settings server-side and only changes the actor theme", async () => {
    await updateSettings({}, form({ theme: "light", sleep_score: "samsung", overview_mode: "morning" }));
    expect(mocks.updateAccount).toHaveBeenCalledWith("actor", { settings: { theme: "light", sleep_score: "samsung", overview_mode: "morning" } });
    await updateTheme("dark");
    expect(mocks.updateAccount).toHaveBeenLastCalledWith("actor", { settings: { ...account.settings, theme: "dark" } });
  });
  it("checks password confirmation then renews the current actor session", async () => {
    const data = form({ current_password: " old password ", new_password: " new password ", repeat_password: "different" });
    expect((await changeOwnPassword({}, data)).error).toContain("nezhodujú");
    expect(mocks.changePassword).not.toHaveBeenCalled();
    data.set("repeat_password", " new password ");
    mocks.changePassword.mockResolvedValue({ ...account, session_version: 2 });
    expect(await changeOwnPassword({}, data)).toEqual({ navigate: "/ucet?heslo=zmenene" });
    expect(mocks.changePassword).toHaveBeenCalledWith("actor", " old password ", " new password ");
    expect(mocks.startSession).toHaveBeenCalledWith(expect.objectContaining({ id: "actor", session_version: 2 }), true);
  });
  it("requires password and explicit confirmation before own-account deletion", async () => {
    await deleteOwnAccount({}, form({ confirmation: "ZMAZAŤ" }));
    await deleteOwnAccount({}, form({ password: "secret" }));
    expect(mocks.deleteOwnAccount).not.toHaveBeenCalled();
    expect(await deleteOwnAccount({}, form({ confirmation: "ZMAZAŤ", password: "secret", id: "victim" }))).toEqual({ navigate: "/login" });
    expect(mocks.deleteOwnAccount).toHaveBeenCalledWith("actor", "secret");
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });
  it("returns full navigation after logout-all and permits ordinary logout in view mode", async () => {
    expect(await logoutEverywhere({}, form({ confirmation: "ODHLÁSIŤ" }))).toEqual({ navigate: "/login" });
    expect(mocks.logoutAll).toHaveBeenCalledWith("actor");
    session.claims.x = "viewed";
    expect(await logoutAccount({}, form())).toEqual({ navigate: "/login" });
  });
  it("keeps upstream bodies and errors out of output", async () => {
    mocks.updateAccount.mockRejectedValue(new Error("private upstream body"));
    expect(JSON.stringify(await updateProfile({}, form(profile)))).not.toContain("private");
    mocks.requireSession.mockRejectedValue(new OwiAccountError("unavailable", 503));
    expect((await updateProfile({}, form(profile))).error).toContain("nedostupná");
  });
});

describe("admin actions", () => {
  it("freshly authorizes every admin operation and ignores submitted actor identity", async () => {
    await adminAction({}, form({ operation: "resolve", target: "12", actor: "forged" }));
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.resolveInbox).toHaveBeenCalledWith("actor", 12);
  });
  it.each(["user", "viewing", "pending"])("blocks %s sessions from every admin write", async (kind) => {
    if (kind === "user") session.account.role = "user";
    if (kind === "viewing") session.claims.x = "viewed";
    if (kind === "pending") session.account.status = "pending";
    for (const operation of ["pair", "unpair", "role-status", "delete", "reset", "resolve", "registration"]) expect((await adminAction({}, form({ operation, target: "victim", confirmation: "ZMAZAŤ" }))).error).toBeTruthy();
    for (const mock of [mocks.pairAccount, mocks.unpairAccount, mocks.updateAdminAccount, mocks.deleteAccount, mocks.createResetLink, mocks.resolveInbox, mocks.updateSystem]) expect(mock).not.toHaveBeenCalled();
  });
  it("pairs only an unused known identity after explicit confirmation", async () => {
    mocks.owUsers.mockResolvedValue([{ id: "free", label: "Synthetic", paired_account_id: null }, { id: "used", paired_account_id: "another" }]);
    const data = form({ operation: "pair", target: "target", ow_user_id: "free" });
    await adminAction({}, data);
    expect(mocks.pairAccount).not.toHaveBeenCalled();
    data.set("confirmation", "SPÁROVAŤ"); data.set("ow_user_id", "used");
    await adminAction({}, data);
    expect(mocks.pairAccount).not.toHaveBeenCalled();
    data.set("ow_user_id", "free");
    expect(await adminAction({}, data)).toHaveProperty("success");
    expect(mocks.pairAccount).toHaveBeenCalledWith("actor", "target", "free");
  });
  it("requires confirmation for admin delete and preserves last-admin errors", async () => {
    await adminAction({}, form({ operation: "delete", target: "target" }));
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    mocks.deleteAccount.mockRejectedValue(new OwiAccountError("last_admin", 409));
    expect((await adminAction({}, form({ operation: "delete", target: "target", confirmation: "ZMAZAŤ" }))).error).toContain("Posledný správca");
  });
  it("creates an ephemeral relative reset path without logging tokens", async () => {
    const log = vi.spyOn(console, "log");
    mocks.createResetLink.mockResolvedValue({ token: "synthetic/token", expires_at: "2026-10-21" });
    expect(await adminAction({}, form({ operation: "reset", target: "target" }))).toEqual({ resetPath: "/nove-heslo/synthetic%2Ftoken", expiresAt: "2026-10-21" });
    expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
  it("validates enum and registration values", async () => {
    await adminAction({}, form({ operation: "role-status", target: "target", role: "root", status: "active" }));
    await adminAction({}, form({ operation: "registration", registration_open: "yes" }));
    expect(mocks.updateAdminAccount).not.toHaveBeenCalled();
    expect(mocks.updateSystem).not.toHaveBeenCalled();
    await adminAction({}, form({ operation: "registration", registration_open: "false" }));
    expect(mocks.updateSystem).toHaveBeenCalledWith("actor", false);
  });
  it("starts viewing only an active paired target and exits without write permission", async () => {
    mocks.getAccount.mockResolvedValue({ ...account, id: "target", status: "pending", paired: false });
    expect((await viewAccount({}, form({ target: "target" }))).error).toBeTruthy();
    expect(mocks.setViewedAccount).not.toHaveBeenCalled();
    mocks.getAccount.mockResolvedValue({ ...account, id: "target" });
    expect(await viewAccount({}, form({ target: "target" }))).toEqual({ navigate: "/" });
    expect(mocks.setViewedAccount).toHaveBeenCalledWith(session, "target");
    session.claims.x = "target";
    expect(await exitView({}, form())).toEqual({ navigate: "/" });
    expect(mocks.setViewedAccount).toHaveBeenLastCalledWith(session, null);
  });
});
