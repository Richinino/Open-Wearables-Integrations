import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountProvider, type AccountContextValue } from "./account-context";
import { PageIdentity } from "@/components/admin/page-identity";
import { sessionIdentity } from "./account-identity";
import { testSession } from "./account-test-fixtures";
import AccountPage from "@/app/(app)/ucet/page";
import SettingsPage from "@/app/(app)/nastavenia/page";
import InboxPage from "@/app/(app)/admin/page";
import AccountsPage from "@/app/(app)/admin/ucty/page";
import AccountDetailPage from "@/app/(app)/admin/ucty/[id]/page";
import SystemPage from "@/app/(app)/admin/system/page";

const mocks = vi.hoisted(() => ({ session: vi.fn(), effects: [] as (() => void)[] }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useEffect: (effect: () => void) => { mocks.effects.push(effect); } }));
vi.mock("./auth", () => ({ requireSession: mocks.session, requireAdmin: mocks.session }));
vi.mock("./account-actions", () => ({ changeOwnPassword: vi.fn(), deleteOwnAccount: vi.fn(), logoutEverywhere: vi.fn(), updateProfile: vi.fn(), updateSettings: vi.fn() }));
vi.mock("@/app/(app)/admin/actions", () => ({ adminAction: vi.fn(), viewAccount: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("./owi-accounts", () => ({ accountsApi: {
  inbox: async () => [], adminAccounts: async () => [{ ...testSession().account, ow_user_id: "ow-synthetic", last_data_at: null }],
  accountSources: async () => ({ connections: [], types: [], updated_at: null }), owUsers: async () => [],
  system: async () => ({ ow_api: "ok", funnel: {}, registration_open: true }),
} }));

const fresh = testSession({ id: "account-b", email: "b@example.test" }, { a: "account-b" });
const stale = testSession();
const reload = vi.fn();
function renderWithShell(page: ReactNode, shell: AccountContextValue) {
  return renderToStaticMarkup(createElement(AccountProvider, { value: shell } as Parameters<typeof AccountProvider>[0], page));
}
function shell(session = stale): AccountContextValue {
  return { account: session.account, dataAccount: { ...session.account, id: session.claims.x ?? session.account.id }, viewOnly: Boolean(session.claims.x), persistent: false };
}
beforeEach(() => { mocks.effects = []; reload.mockReset(); mocks.session.mockResolvedValue(fresh); vi.stubGlobal("window", { location: { reload } }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("fresh RSC page inside a retained authenticated layout", () => {
  it.each([
    ["profile", () => AccountPage()], ["settings", () => SettingsPage()],
    ["admin inbox", () => InboxPage({ searchParams: Promise.resolve({}) })],
    ["admin accounts", () => AccountsPage()],
    ["admin account detail", () => AccountDetailPage({ params: Promise.resolve({ id: stale.account.id }) })],
    ["admin system", () => SystemPage()],
  ] as const)("binds %s to the session that supplied the page and hides it in shell A", async (_name, page) => {
    const result = await page() as ReactElement<{ expected: unknown }>;
    expect(result.type).toBe(PageIdentity);
    expect(result.props.expected).toEqual(sessionIdentity(fresh));
    const html = renderWithShell(result, shell());
    expect(html).toContain("Obnovujem stránku");
    expect(html).not.toContain("b@example.test"); expect(html).not.toContain("<form");
    expect(reload).not.toHaveBeenCalled();
    mocks.effects.forEach((effect) => effect());
    expect(reload).toHaveBeenCalled();
  });
  it.each([
    shell(stale),
    shell({ ...fresh, claims: { ...fresh.claims, x: "old-view-target" } }),
    shell({ ...fresh, claims: { ...fresh.claims, x: fresh.account.id } }),
    shell(testSession({ session_version: fresh.account.session_version + 1, id: fresh.account.id }, { a: fresh.account.id })),
  ])("hides mismatched actor, view mode, target and session generation before effects", (cachedShell) => {
    const html = renderWithShell(createElement(PageIdentity, { expected: sessionIdentity(fresh) } as Parameters<typeof PageIdentity>[0], createElement("form", null, "sensitive profile")), cachedShell);
    expect(html).not.toContain("sensitive profile"); expect(html).not.toContain("<form");
    mocks.effects.forEach((effect) => effect()); expect(reload).toHaveBeenCalled();
  });
  it("renders matching page content without refreshing the document", () => {
    const html = renderWithShell(createElement(PageIdentity, { expected: sessionIdentity(fresh) } as Parameters<typeof PageIdentity>[0], "matching content"), shell(fresh));
    expect(html).toContain("matching content");
    mocks.effects.forEach((effect) => effect()); expect(reload).not.toHaveBeenCalled();
  });
});
