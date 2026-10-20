import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDataset } from "./use-dataset";
import { AccountIdentityMismatchError } from "./account-identity";
import { TEST_ACCOUNT } from "./account-test-fixtures";
import type { AccountContextValue } from "./account-context";

const mocks = vi.hoisted(() => ({ account: null as AccountContextValue | null, swr: vi.fn(), data: { days: [] }, error: null as Error | null }));
vi.mock("./account-context", () => ({ useAccount: () => mocks.account }));
vi.mock("swr", () => ({ default: mocks.swr }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.account = null; mocks.error = null;
  mocks.swr.mockImplementation(() => ({ data: mocks.data, error: mocks.error, isLoading: false, isValidating: false, mutate: vi.fn() }));
});

describe("SWR account identity isolation", () => {
  it("keys by actor, target and view mode, with no anonymous data fallback", () => {
    function Probe() { useDataset(); return null; }
    const render = () => renderToStaticMarkup(createElement(Probe));
    render(); expect(mocks.swr.mock.lastCall?.[0]).toBeNull();
    mocks.account = { account: TEST_ACCOUNT, dataAccount: { ...TEST_ACCOUNT, id: "target" }, viewOnly: true, persistent: false };
    render(); expect(mocks.swr.mock.lastCall?.[0]).toEqual(["/api/data", TEST_ACCOUNT.id, "target", true]);
    mocks.account = { ...mocks.account, account: { ...TEST_ACCOUNT, id: "other-admin" } };
    render(); expect(mocks.swr.mock.lastCall?.[0]).toEqual(["/api/data", "other-admin", "target", true]);
    expect(mocks.swr.mock.lastCall?.[2]).toMatchObject({ keepPreviousData: false });
  });
  it("does not expose a cached dataset after a mismatch while full reload begins", () => {
    mocks.account = { account: TEST_ACCOUNT, dataAccount: TEST_ACCOUNT, viewOnly: false, persistent: false };
    mocks.error = new AccountIdentityMismatchError();
    let visible: unknown = "not rendered";
    function Probe() { visible = useDataset().dataset; return null; }
    renderToStaticMarkup(createElement(Probe));
    expect(visible).toBeUndefined();
  });
});
