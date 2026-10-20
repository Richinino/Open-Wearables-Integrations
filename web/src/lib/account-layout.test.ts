import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { AccountContextValue } from "./account-context";
import type { Account, AccountSession } from "./account-types";
import AppLayout from "@/app/(app)/layout";

const mocks = vi.hoisted(() => ({ currentSession: vi.fn(), getAccount: vi.fn(), path: "/" }));
vi.mock("./auth", () => ({ currentSession: mocks.currentSession }));
vi.mock("./owi-accounts", () => ({ accountsApi: { getAccount: mocks.getAccount } }));
vi.mock("@/components/shell/shell", () => ({ Shell: () => null }));
vi.mock("@/app/(app)/admin/actions", () => ({ exitView: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-account-pathname": mocks.path }) }));
vi.mock("next/navigation", () => ({ redirect: (target: string) => { throw Object.assign(new Error("redirect"), { target }); }, unstable_rethrow: () => {} }));

const account: Account = { id: "actor", email: "actor@example.test", first_name: "Test", last_name: null, role: "admin", status: "active", paired: true, birth_date: null, sex: null, training_consent: true, settings: { theme: "system", sleep_score: "performance", overview_mode: "auto" }, has_samsung: true, created_at: "2026-01-01", last_login_at: null, session_version: 1 };
let session: AccountSession;
beforeEach(() => {
  vi.resetAllMocks(); mocks.path = "/";
  session = { account: { ...account }, claims: { a: "actor", r: "admin", v: 1, x: null, p: true, e: 9999999999999 } };
  mocks.currentSession.mockImplementation(async () => session);
});

describe("authenticated app layout", () => {
  it("requires a validated session before loading any target account", async () => {
    mocks.currentSession.mockResolvedValue(null);
    await expect(AppLayout({ children: "private content" })).rejects.toMatchObject({ target: "/login" });
    expect(mocks.getAccount).not.toHaveBeenCalled();
  });
  it("returns unavailable UI without mounting private content when validation fails", async () => {
    mocks.currentSession.mockRejectedValue(new Error("private upstream detail"));
    const result = await AppLayout({ children: "private content" });
    expect(JSON.stringify(result)).not.toContain("private content");
    expect(JSON.stringify(result)).not.toContain("private upstream detail");
  });
  it.each(["/", "/nastavenia", "/admin", "/zapis", ""])("redirects pending sessions away from %s", async (path) => {
    session.account.status = "pending"; mocks.path = path;
    await expect(AppLayout({ children: "private content" })).rejects.toMatchObject({ target: "/cakanie" });
  });
  it("keeps a pending actor profile accessible", async () => {
    session.account.status = "pending"; mocks.path = "/ucet";
    const result = await AppLayout({ children: "profile" }) as ReactElement<{ value: AccountContextValue }>;
    expect(result.props.value.account.id).toBe("actor");
    expect(result.props.value.dataAccount.id).toBe("actor");
  });
  it("supplies the exact provider contract with a freshly fetched viewed account", async () => {
    session.claims.x = "target";
    const target = { ...account, id: "target", has_samsung: false };
    mocks.getAccount.mockResolvedValue(target);
    const result = await AppLayout({ children: "private content" }) as ReactElement<{ value: AccountContextValue }>;
    expect(mocks.getAccount).toHaveBeenCalledWith("target");
    expect(result.props.value).toEqual({ account: session.account, dataAccount: target, viewOnly: true, persistent: true });
  });
  it("does not fall back to actor data when viewed data is unavailable or inactive", async () => {
    session.claims.x = "target";
    for (const target of [null, { ...account, id: "target", status: "suspended" }, { ...account, id: "target", paired: false }, { ...account, id: "other" }]) {
      mocks.getAccount.mockResolvedValue(target);
      const result = await AppLayout({ children: "private content" }) as ReactElement<{ value?: AccountContextValue }>;
      expect(result.props.value).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("private content");
    }
  });
  it("does not load a viewed target after the actor becomes pending", async () => {
    session.account.status = "pending"; session.claims.x = "target"; mocks.path = "/ucet";
    const result = await AppLayout({ children: "private content" });
    expect(mocks.getAccount).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private content");
  });
});
