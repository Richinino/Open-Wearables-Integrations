import { IDENTITY_HEADER, sessionIdentity, type AccountIdentity } from "./account-identity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/data/route";
import { login, register, requestReset, confirmReset, logout } from "@/app/login/actions";
import { OwiAccountError } from "./owi-accounts";
import { DatasetUnavailableError } from "./owi";
import { TEST_ACCOUNT as ACCOUNT, testSession } from "./account-test-fixtures";
const mocks = vi.hoisted(() => ({ currentSession: vi.fn(), startSession: vi.fn(), endSession: vi.fn(), loadDataset: vi.fn(), reserveLoginAttempt: vi.fn(), trustedClientKey: vi.fn(), login: vi.fn(), register: vi.fn(), requestReset: vi.fn(), confirmReset: vi.fn(), getAccount: vi.fn() }));
vi.mock("./auth", () => ({ currentSession: mocks.currentSession, startSession: mocks.startSession, endSession: mocks.endSession }));
vi.mock("./owi", async (original) => ({ ...await original<typeof import("./owi")>(), loadDataset: mocks.loadDataset }));
vi.mock("./owi-accounts", async (original) => ({ ...await original<typeof import("./owi-accounts")>(), accountsApi: { login: mocks.login, register: mocks.register, requestReset: mocks.requestReset, confirmReset: mocks.confirmReset, getAccount: mocks.getAccount } }));
vi.mock("./login-limit", () => ({ reserveLoginAttempt: mocks.reserveLoginAttempt, trustedClientKey: mocks.trustedClientKey }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
const state = { error: null };
function dataRequest(identity: AccountIdentity = sessionIdentity(testSession())) { return new Request("https://example.test/api/data", { headers: { [IDENTITY_HEADER]: JSON.stringify(identity) } }); }
function form(patch: Record<string, string> = {}) { const f = new FormData(); for (const [key, value] of Object.entries({ email: "test@example.test", password: "synthetic-password", repeat: "synthetic-password", first_name: "Test", ...patch })) f.set(key, value); return f; }
beforeEach(() => { vi.resetAllMocks(); mocks.currentSession.mockResolvedValue(testSession()); mocks.reserveLoginAttempt.mockResolvedValue("allowed"); mocks.trustedClientKey.mockResolvedValue("a".repeat(64)); mocks.login.mockResolvedValue(ACCOUNT); mocks.register.mockResolvedValue({ ...ACCOUNT, status: "pending" }); mocks.confirmReset.mockResolvedValue(ACCOUNT); mocks.loadDataset.mockResolvedValue({ days: [] }); });
afterEach(() => vi.restoreAllMocks());
describe("public account forms", () => {
  it.each([login, register, requestReset])("reserves the persistent public quota before a mutation", async (action) => {
    mocks.reserveLoginAttempt.mockResolvedValue("limited"); expect((await action(state, form())).error).toContain("Priveľa"); expect(mocks.login).not.toHaveBeenCalled(); expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.requestReset).not.toHaveBeenCalled();
  });
  it("validates email, password, names and matching password", async () => {
    expect((await login(state, form({ email: "bad" }))).error).toContain("platný");
    expect((await register(state, form({ first_name: "" }))).error).toContain("meno");
    expect((await register(state, form({ password: "tiny", repeat: "tiny" }))).error).toContain("10");
    expect((await register(state, form({ repeat: "different-password" }))).error).toContain("nezhodujú");
    expect(mocks.login).not.toHaveBeenCalled(); expect(mocks.register).not.toHaveBeenCalled();
  });
  it("starts browser or persistent session and returns destination for full navigation", async () => {
    expect((await login(state, form())).destination).toBe("/"); expect(mocks.startSession).toHaveBeenLastCalledWith(ACCOUNT, false);
    await login(state, form({ remember: "on" })); expect(mocks.startSession).toHaveBeenLastCalledWith(ACCOUNT, true);
    mocks.login.mockResolvedValue({ ...ACCOUNT, status: "pending" }); expect((await login(state, form())).destination).toBe("/cakanie");
  });
  it("registers with HMAC client identity and uses waiting destination", async () => {
    expect((await register(state, form())).destination).toBe("/cakanie");
    expect(mocks.register).toHaveBeenCalledWith({ email: ACCOUNT.email, first_name: "Test", last_name: null, password: "synthetic-password" }, "a".repeat(64));
  });
  it("blocks public mutations while viewing or pending", async () => {
    mocks.currentSession.mockResolvedValue(testSession({ role: "admin" }, { r: "admin", x: "account-b" }));
    expect((await register(state, form())).error).toContain("prezeraní"); expect((await requestReset(state, form())).error).toContain("prezeraní"); expect((await confirmReset("token", state, form())).error).toContain("prezeraní");
    mocks.currentSession.mockResolvedValue(testSession({ status: "pending" })); expect((await register(state, form())).error).toContain("spárovanie"); expect(mocks.register).not.toHaveBeenCalled();
  });
  it("shows safe credential errors and never upstream response bodies", async () => {
    mocks.login.mockRejectedValue(new OwiAccountError("invalid_credentials", 401)); expect((await login(state, form())).error).toBe("Nesprávny e-mail alebo heslo.");
    mocks.login.mockRejectedValue(new Error("upstream-private-content")); expect((await login(state, form())).error).toContain("nedostupná");
  });
  it("acknowledges reset requests uniformly and confirms a single-use backend token", async () => {
    expect(await requestReset(state, form())).toEqual(await requestReset(state, form({ email: "unknown@example.test" })));
    expect((await confirmReset("one-use-token", state, form())).destination).toBe("/login"); expect(mocks.confirmReset).toHaveBeenCalledWith("one-use-token", "synthetic-password");
    mocks.confirmReset.mockRejectedValue(new OwiAccountError("invalid_token", 400)); expect((await confirmReset("one-use-token", state, form())).error).toContain("neplatný");
  });
  it("ends session on logout", async () => { await expect(logout()).rejects.toThrow("redirect:/login"); expect(mocks.endSession).toHaveBeenCalled(); });
});
describe("account data route", () => {
  it("rejects stale actor, viewed target, view mode and missing identity before reading data", async () => {
    const stale = sessionIdentity(testSession());
    for (const session of [testSession({ id: "account-b" }, { a: "account-b" }), testSession({ role: "admin" }, { x: "account-b" }), testSession({ role: "admin" }, { x: "account-a" })]) {
      mocks.currentSession.mockResolvedValue(session);
      const response = await GET(dataRequest(stale));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "session_changed" });
    }
    mocks.currentSession.mockResolvedValue(testSession());
    expect((await GET(new Request("https://example.test/api/data"))).status).toBe(409);
    expect(mocks.loadDataset).not.toHaveBeenCalled();
    expect(mocks.getAccount).not.toHaveBeenCalled();
  });
  it("denies unauthenticated, pending, and unpaired sessions without reading data", async () => {
    mocks.currentSession.mockResolvedValue(null); expect((await GET(dataRequest())).status).toBe(401);
    mocks.currentSession.mockResolvedValue(testSession({ status: "pending", paired: false })); expect((await GET(dataRequest())).status).toBe(403); expect(mocks.loadDataset).not.toHaveBeenCalled();
  });
  it("routes solely to the authorized account with no-store", async () => {
    const response = await GET(dataRequest()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.loadDataset).toHaveBeenCalledWith(ACCOUNT.id); expect(JSON.parse(response.headers.get(IDENTITY_HEADER)!)).toEqual(sessionIdentity(testSession()));
  });
  it("validates viewed target and isolates its data", async () => {
    mocks.currentSession.mockResolvedValue(testSession({ role: "admin" }, { r: "admin", x: "account-b" }));
    mocks.getAccount.mockResolvedValue({ ...ACCOUNT, id: "account-b" }); expect((await GET(dataRequest({ actorId: ACCOUNT.id, dataAccountId: "account-b", viewOnly: true, sessionVersion: 0 }))).status).toBe(200); expect(mocks.loadDataset).toHaveBeenCalledWith("account-b");
    mocks.getAccount.mockResolvedValue({ ...ACCOUNT, id: "account-b", status: "suspended" }); expect((await GET(dataRequest({ actorId: ACCOUNT.id, dataAccountId: "account-b", viewOnly: true, sessionVersion: 0 }))).status).toBe(403);
  });
  it("fails closed on account/data outage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.currentSession.mockRejectedValue(new OwiAccountError("unavailable", 503)); expect((await GET(dataRequest())).status).toBe(503);
    mocks.currentSession.mockResolvedValue(testSession()); mocks.loadDataset.mockRejectedValue(new DatasetUnavailableError("request failed")); expect((await GET(dataRequest())).status).toBe(503);
  });
});
