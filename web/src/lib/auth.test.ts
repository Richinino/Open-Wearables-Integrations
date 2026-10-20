import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { currentSession, requireAdmin, requireSession, startSession, setViewedAccount, assertWritable, endSession } from "./auth";
import { OwiAccountError } from "./owi-accounts";
import { createSessionToken } from "./session";
import { TEST_ACCOUNT as ACCOUNT, TEST_CLAIMS as CLAIMS, TEST_SECRET as SECRET, TEST_NOW as NOW, testSession } from "./account-test-fixtures";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn(), getAccount: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set, delete: mocks.delete }) }));
vi.mock("./owi-accounts", async (original) => ({ ...await original<typeof import("./owi-accounts")>(), accountsApi: { getAccount: mocks.getAccount } }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
beforeEach(async () => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); vi.stubEnv("SESSION_SECRET", SECRET); mocks.get.mockReturnValue({ value: await createSessionToken(SECRET, CLAIMS) }); mocks.getAccount.mockResolvedValue(ACCOUNT); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("fresh account authority", () => {
  it("fetches current account on each request without mutating cookies", async () => {
    expect(await currentSession()).toEqual(testSession()); await currentSession();
    expect(mocks.getAccount).toHaveBeenCalledTimes(2); expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it.each([{ status: "suspended" }, { session_version: 1 }, { id: "other" }, { status: "invalid" }, { role: "invalid" }])("rejects revoked or malformed account %o", async (patch) => { mocks.getAccount.mockResolvedValue({ ...ACCOUNT, ...patch }); expect(await currentSession()).toBeNull(); });
  it("returns null for deleted account and fails closed on outage", async () => {
    mocks.getAccount.mockRejectedValue(new OwiAccountError("not_found", 404)); expect(await currentSession()).toBeNull();
    mocks.getAccount.mockRejectedValue(new OwiAccountError("unavailable", 503)); await expect(currentSession()).rejects.toMatchObject({ code: "unavailable" });
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("does not grant stale signed admin role", async () => {
    mocks.get.mockReturnValue({ value: await createSessionToken(SECRET, { ...CLAIMS, r: "admin" }) });
    expect((await currentSession())?.claims.r).toBe("user"); await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });
  it("permits pending profile sessions but denies admin", async () => { mocks.getAccount.mockResolvedValue({ ...ACCOUNT, status: "pending" }); expect((await requireSession()).account.status).toBe("pending"); await expect(requireAdmin()).rejects.toMatchObject({ status: 403 }); });
  it("redirects unauthenticated sessions", async () => { mocks.get.mockReturnValue(undefined); await expect(requireSession()).rejects.toThrow("redirect:/login"); });
});
describe("cookies and viewing", () => {
  it("omits maxAge for browser session and persists remembered sessions", async () => {
    await startSession(ACCOUNT, false); expect(mocks.set.mock.calls[0][2].maxAge).toBeUndefined();
    await startSession(ACCOUNT, true); expect(mocks.set.mock.calls[1][2].maxAge).toBe(30 * 24 * 3600);
  });
  it("checks current admin and target and rejects writes while viewing", async () => {
    expect(() => assertWritable({ ...CLAIMS, x: "target" })).toThrow("read_only");
    await expect(startSession(ACCOUNT, false, "target")).rejects.toMatchObject({ code: "forbidden" });
    const admin = { ...ACCOUNT, role: "admin" as const };
    mocks.getAccount.mockImplementation(async (id: string) => id === admin.id ? admin : { ...ACCOUNT, id: "target", status: "pending" }); await expect(startSession(admin, false, "target")).rejects.toMatchObject({ code: "invalid_target" });
    mocks.getAccount.mockImplementation(async (id: string) => id === admin.id ? admin : { ...ACCOUNT, id: "target" }); await startSession(admin, false, "target"); expect(mocks.set).toHaveBeenCalledTimes(1);
  });
  it("allows exiting view mode without loading the old target", async () => {
    const admin = { ...ACCOUNT, role: "admin" as const };
    mocks.get.mockReturnValue({ value: await createSessionToken(SECRET, { ...CLAIMS, r: "admin", x: "gone-target" }) }); mocks.getAccount.mockResolvedValue(admin);
    await setViewedAccount(testSession(admin, { r: "admin", x: "gone-target" }), null);
    expect(mocks.getAccount).toHaveBeenCalledWith(ACCOUNT.id); expect(mocks.getAccount).not.toHaveBeenCalledWith("gone-target"); expect(mocks.set).toHaveBeenCalled();
    await endSession(); expect(mocks.delete).toHaveBeenCalledWith("owi_session");
  });
});
