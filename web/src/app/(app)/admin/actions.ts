"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { assertWritable, requireAdmin, requireSession, setViewedAccount } from "@/lib/auth";
import { accountsApi } from "@/lib/owi-accounts";
import { accountErrorMessage } from "@/lib/account-forms";
import { AccountInputError, confirmation, field, type AccountActionState } from "@/lib/account-input";
import { assertFormIdentity, identityChangeResult } from "@/lib/account-identity";

export async function adminAction(_state: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const session = await requireAdmin();
    assertFormIdentity(form, session);
    assertWritable(session.claims);
    const target = field(form, "target");
    const operation = field(form, "operation");
    if (!target && operation !== "registration") return { error: "Chýba účet alebo položka." };
    switch (operation) {
      case "pair": {
        confirmation(form, "SPÁROVAŤ");
        const owId = field(form, "ow_user_id");
        const users = await accountsApi.owUsers(session.account.id);
        if (!users.some((user) => user.id === owId && !user.paired_account_id)) return { error: "Vyber voľného používateľa Open Wearables." };
        await accountsApi.pairAccount(session.account.id, target, owId);
        break;
      }
      case "unpair": confirmation(form, "ODPOJIŤ"); await accountsApi.unpairAccount(session.account.id, target); break;
      case "role-status": {
        const role = field(form, "role");
        const status = field(form, "status");
        if (role !== "admin" && role !== "user") return { error: "Neplatná rola." };
        if (status !== "active" && status !== "pending" && status !== "suspended") return { error: "Neplatný stav." };
        await accountsApi.updateAdminAccount(session.account.id, target, { role, status });
        break;
      }
      case "delete":
        confirmation(form, "ZMAZAŤ");
        await accountsApi.deleteAccount(session.account.id, target);
        revalidatePath("/", "layout");
        return { navigate: target === session.account.id ? "/login" : "/admin/ucty" };
      case "reset": {
        const link = await accountsApi.createResetLink(session.account.id, target);
        return { resetPath: `/nove-heslo/${encodeURIComponent(link.token)}`, expiresAt: link.expires_at };
      }
      case "resolve": {
        const id = Number(target);
        if (!Number.isSafeInteger(id) || id < 1) return { error: "Neplatná položka." };
        await accountsApi.resolveInbox(session.account.id, id);
        break;
      }
      case "registration": {
        const value = field(form, "registration_open");
        if (value !== "true" && value !== "false") return { error: "Vyber stav registrácie." };
        await accountsApi.updateSystem(session.account.id, value === "true");
        break;
      }
      default: return { error: "Neznáma akcia." };
    }
    revalidatePath("/", "layout");
    return { success: "Zmena je uložená." };
  } catch (error) {
    unstable_rethrow(error);
    return identityChangeResult(error) ?? { error: error instanceof AccountInputError ? error.message : accountErrorMessage(error) };
  }
}

export async function viewAccount(_state: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const session = await requireAdmin();
    assertFormIdentity(form, session);
    assertWritable(session.claims);
    const target = await accountsApi.getAccount(field(form, "target"));
    if (target.status !== "active" || !target.paired) return { error: "Prezerať sa dá iba aktívny spárovaný účet." };
    await setViewedAccount(session, target.id === session.account.id ? null : target.id);
    return { navigate: "/" };
  } catch (error) { unstable_rethrow(error); return identityChangeResult(error) ?? { error: accountErrorMessage(error) }; }
}

export async function exitView(_state: AccountActionState, _form: FormData): Promise<AccountActionState> {
  void _state;
  try {
    const session = await requireSession();
    assertFormIdentity(_form, session);
    await setViewedAccount(session, null);
    return { navigate: "/" };
  } catch (error) { unstable_rethrow(error); return identityChangeResult(error) ?? { error: accountErrorMessage(error) }; }
}
