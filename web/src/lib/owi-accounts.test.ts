import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { accountsApi, OwiAccountError } from "./owi-accounts";
import { accountErrorMessage } from "./account-forms";
import { TEST_ACCOUNT } from "./account-test-fixtures";
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubEnv("OWI_API_URL", "https://owi.example.test/base/"); vi.stubEnv("OWI_WRITE_TOKEN", "synthetic-write-token"); vi.stubEnv("OWI_API_TOKEN", "synthetic-read-token"); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockImplementation(async () => Response.json(TEST_ACCOUNT)); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("server account API client", () => {
  it("uses write credentials, no-store, timeout and trusted admin identity", async () => {
    await accountsApi.adminAccounts("acting-admin");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://owi.example.test/base/v1/admin/accounts");
    const headers = new Headers(options?.headers); expect(headers.get("authorization")).toBe("Bearer synthetic-write-token"); expect(headers.get("x-owi-acting")).toBe("acting-admin");
    expect(options?.cache).toBe("no-store"); expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it("passes the HMAC registration key and never invents an acting identity", async () => {
    await accountsApi.register({ email: "test@example.test", first_name: "Test", password: "synthetic-password" }, "a".repeat(64));
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers); expect(headers.get("x-owi-client-ip")).toBe("a".repeat(64)); expect(headers.get("x-owi-acting")).toBeNull();
  });
  it("encodes path segments and maps backend request fields", async () => {
    await accountsApi.changePassword("account/a", "old", "new");
    expect(fetchMock.mock.calls[0][0]).toContain("/accounts/account%2Fa/password"); expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ current_password: "old", new_password: "new" });
    await accountsApi.updateSystem("admin", false); expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ registration_open: false });
  });
  it("handles empty successful deletion response", async () => { fetchMock.mockResolvedValue(new Response(null, { status: 204 })); await expect(accountsApi.deleteOwnAccount("account-a", "password")).resolves.toBeUndefined(); });
  it("keeps machine error codes, fields and retry time without exposing upstream text", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "too_many_attempts", fields: { password: "sensitive upstream marker" }, retry_after_s: 50 }, { status: 429 }));
    const error = await accountsApi.login({ email: "test@example.test", password: "password" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OwiAccountError); expect(error).toMatchObject({ code: "too_many_attempts", status: 429, retryAfterS: 50, fields: { password: "Neplatná hodnota" } }); expect(JSON.stringify(error)).not.toContain("sensitive upstream marker"); expect(accountErrorMessage(error)).toContain("Priveľa");
  });
  it("fails closed without credentials, on network failure or invalid JSON", async () => {
    vi.stubEnv("OWI_WRITE_TOKEN", ""); await expect(accountsApi.getAccount("account-a")).rejects.toMatchObject({ code: "unavailable", status: 503 }); expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("OWI_WRITE_TOKEN", "write"); fetchMock.mockRejectedValue(new Error("private URL and token")); await expect(accountsApi.getAccount("account-a")).rejects.toThrow("unavailable");
    fetchMock.mockResolvedValue(new Response("private gateway content")); await expect(accountsApi.getAccount("account-a")).rejects.toThrow("unavailable");
    expect(accountErrorMessage(new Error("private upstream body"))).not.toContain("private");
  });
  it.each([null, {}, { ...TEST_ACCOUNT, id: "other" }, { ...TEST_ACCOUNT, role: "owner" }])("refuses malformed or mismatched account responses", async (body) => {
    fetchMock.mockResolvedValue(Response.json(body)); await expect(accountsApi.getAccount("account-a")).rejects.toMatchObject({ code: "unavailable", status: 503 });
  });
});
