"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { assertWritable, endSession, requireSession, startSession } from "./auth";
import { accountsApi } from "./owi-accounts";
import { accountErrorMessage } from "./account-forms";
import { AccountInputError, confirmation, passwordField, profileInput, settingsInput, type AccountActionState } from "./account-input";

function message(error: unknown): AccountActionState {
  unstable_rethrow(error);
  return { error: error instanceof AccountInputError ? error.message : accountErrorMessage(error) };
}

export async function logoutAccount(_state: AccountActionState, _form: FormData): Promise<AccountActionState> {
  void _state; void _form;
  try { await endSession(); return { navigate: "/login" }; }
  catch (error) { return message(error); }
}

export async function updateProfile(_state: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const session = await requireSession();
    assertWritable(session.claims);
    await accountsApi.updateAccount(session.account.id, profileInput(form));
    revalidatePath("/", "layout");
    return { success: "Údaje účtu sú uložené." };
  } catch (error) { return message(error); }
}

export async function updateSettings(_state: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const session = await requireSession();
    assertWritable(session.claims);
    await accountsApi.updateAccount(session.account.id, { settings: settingsInput(form) });
    revalidatePath("/", "layout");
    return { success: "Nastavenia sú uložené." };
  } catch (error) { return message(error); }
}

export async function updateTheme(theme: "light" | "dark"): Promise<AccountActionState> {
  try {
    const session = await requireSession();
    assertWritable(session.claims);
    if (theme !== "light" && theme !== "dark") return { error: "Neplatný vzhľad." };
    await accountsApi.updateAccount(session.account.id, { settings: { ...session.account.settings, theme } });
    revalidatePath("/", "layout");
    return { success: "Vzhľad je uložený." };
  } catch (error) { return message(error); }
}

export async function changeOwnPassword(_state: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const session = await requireSession();
    assertWritable(session.claims);
    const current = passwordField(form, "current_password");
    const next = passwordField(form, "new_password");
    if (!current || current.length > 256 || next.length < 10 || next.length > 256) return { error: "Vyplň aktuálne heslo a nové heslo s 10 až 256 znakmi." };
    if (next !== passwordField(form, "repeat_password")) return { error: "Nové heslá sa nezhodujú." };
    const account = await accountsApi.changePassword(session.account.id, current, next);
    await startSession(account, session.claims.p);
    return { navigate: "/ucet?heslo=zmenene" };
  } catch (error) { return message(error); }
}

export async function logoutEverywhere(_state: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const session = await requireSession();
    assertWritable(session.claims);
    confirmation(form, "ODHLÁSIŤ");
    await accountsApi.logoutAll(session.account.id);
    await endSession();
    return { navigate: "/login" };
  } catch (error) { return message(error); }
}

export async function deleteOwnAccount(_state: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const session = await requireSession();
    assertWritable(session.claims);
    confirmation(form, "ZMAZAŤ");
    const password = passwordField(form, "password");
    if (!password) return { error: "Na zmazanie účtu vyplň heslo." };
    await accountsApi.deleteOwnAccount(session.account.id, password);
    await endSession();
    return { navigate: "/login" };
  } catch (error) { return message(error); }
}
