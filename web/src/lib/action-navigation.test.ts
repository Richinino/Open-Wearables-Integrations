import { afterEach, describe, expect, it, vi } from "vitest";
import { runAccountAction } from "./action-navigation";
import type { AccountActionState } from "./account-input";

afterEach(() => vi.unstubAllGlobals());
describe("account action full navigation", () => {
  it.each(["/", "/login"])("navigates to %s from the pending continuation even if the cookie rerender unmounts the form", async (navigate) => {
    const assign = vi.fn(); vi.stubGlobal("window", { location: { assign } });
    let finish!: (state: AccountActionState) => void;
    const pending = new Promise<AccountActionState>((resolve) => { finish = resolve; });
    const action = vi.fn(async () => pending);
    const result = runAccountAction(action, {}, new FormData());
    // No effect or mounted component is available after this simulated cookie rerender.
    expect(assign).not.toHaveBeenCalled();
    finish({ navigate });
    expect(await result).toEqual({ navigate });
    expect(assign).toHaveBeenCalledExactlyOnceWith(navigate);
  });
  it("reloads an identity mismatch before returning action state", async () => {
    const reload = vi.fn(); vi.stubGlobal("window", { location: { reload } });
    await runAccountAction(async () => ({ reload: true }), {}, new FormData());
    expect(reload).toHaveBeenCalledOnce();
  });
  it("keeps normal validation errors in the form", async () => {
    const assign = vi.fn(); const reload = vi.fn(); vi.stubGlobal("window", { location: { assign, reload } });
    expect(await runAccountAction(async () => ({ error: "Skontroluj údaje." }), {}, new FormData())).toEqual({ error: "Skontroluj údaje." });
    expect(assign).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  });
});
