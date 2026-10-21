import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDataset } from "./use-dataset";
import { putEntry } from "./entry-client";
import { AccountIdentityMismatchError, IDENTITY_HEADER, parseIdentity, sameIdentity, type AccountIdentity } from "./account-identity";
import { emptyValues } from "./entries";
import { makeEntry } from "./test-fixtures";

const VIEW_A: AccountIdentity = { actorId: "admin", dataAccountId: "target-a", viewOnly: true, sessionVersion: 0 };
const VIEW_B: AccountIdentity = { actorId: "admin", dataAccountId: "target-b", viewOnly: true, sessionVersion: 0 };
const OWN: AccountIdentity = { actorId: "account-a", dataAccountId: "account-a", viewOnly: false, sessionVersion: 0 };
const DAY = "2026-10-15";
const fetchMock = vi.fn<typeof fetch>();
const reload = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("window", { location: { reload } }); });
afterEach(() => vi.unstubAllGlobals());

describe("identity-bound browser data", () => {
  it("sends the tab's expected identity and accepts a matching server echo", async () => {
    const dataset = { days: [] };
    fetchMock.mockResolvedValue(Response.json(dataset, { headers: { [IDENTITY_HEADER]: JSON.stringify(VIEW_A) } }));
    expect(await fetchDataset("/api/data", VIEW_A)).toEqual(dataset);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get(IDENTITY_HEADER)).toBe(JSON.stringify(VIEW_A));
    expect(reload).not.toHaveBeenCalled();
  });
  it.each([409, 200])("reloads stale tab A before reading or caching account B's payload (%s)", async (status) => {
    const response = Response.json({ days: ["must not enter A cache"] }, { status, headers: { [IDENTITY_HEADER]: JSON.stringify(VIEW_B) } });
    const read = vi.spyOn(response, "json");
    fetchMock.mockResolvedValue(response);
    await expect(fetchDataset("/api/data", VIEW_A)).rejects.toBeInstanceOf(AccountIdentityMismatchError);
    expect(reload).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
  });
  it("rejects a successful data response with no identity echo", async () => {
    fetchMock.mockResolvedValue(Response.json({ days: [] }));
    await expect(fetchDataset("/api/data", VIEW_A)).rejects.toBeInstanceOf(AccountIdentityMismatchError);
    expect(reload).toHaveBeenCalledOnce();
  });
  it("sends the original entry form identity and checks the save response identity", async () => {
    const entry = makeEntry(DAY);
    fetchMock.mockResolvedValue(Response.json(entry, { headers: { [IDENTITY_HEADER]: JSON.stringify(OWN) } }));
    expect(await putEntry(DAY, emptyValues(), OWN)).toEqual({ ok: true, entry });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get(IDENTITY_HEADER)).toBe(JSON.stringify(OWN));
  });
  it.each([409, 200])("reloads a stale entry form without accepting a saved entry (%s)", async (status) => {
    const response = Response.json(makeEntry(DAY), { status, headers: { [IDENTITY_HEADER]: JSON.stringify(VIEW_B) } });
    const read = vi.spyOn(response, "json");
    fetchMock.mockResolvedValue(response);
    await expect(putEntry(DAY, emptyValues(), OWN)).rejects.toBeInstanceOf(AccountIdentityMismatchError);
    expect(reload).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
  });
  it("requires exact actor, target and view-mode matches and validates malformed input", () => {
    expect(sameIdentity(VIEW_A, { ...VIEW_A })).toBe(true);
    for (const identity of [VIEW_B, { ...VIEW_A, actorId: "other-admin" }, { ...VIEW_A, viewOnly: false }, { ...VIEW_A, sessionVersion: 1 }, null]) expect(sameIdentity(VIEW_A, identity)).toBe(false);
    for (const raw of [null, "bad", "null", "[]", JSON.stringify({ ...VIEW_A, viewOnly: "false" }), ...[undefined, -1, 0.5, "0", Number.MAX_SAFE_INTEGER + 1].map((sessionVersion) => JSON.stringify({ ...VIEW_A, sessionVersion }))]) expect(parseIdentity(raw)).toBeNull();
  });
  it.each(["dataset", "entry"])("rejects %s payloads echoed for a newer session of the same actor", async (kind) => {
    const response = Response.json(kind === "dataset" ? { days: [] } : makeEntry(DAY), { headers: { [IDENTITY_HEADER]: JSON.stringify({ ...OWN, sessionVersion: OWN.sessionVersion + 1 }) } });
    const read = vi.spyOn(response, "json"); fetchMock.mockResolvedValue(response);
    await expect(kind === "dataset" ? fetchDataset("/api/data", OWN) : putEntry(DAY, emptyValues(), OWN)).rejects.toBeInstanceOf(AccountIdentityMismatchError);
    expect(reload).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
  });
});
