"use server";
import { redirect } from "next/navigation";
import { currentSession, endSession, startSession } from "@/lib/auth";
import { reserveLoginAttempt, trustedClientKey } from "@/lib/login-limit";
import { accountsApi } from "@/lib/owi-accounts";
import { accountErrorMessage } from "@/lib/account-forms";

export interface LoginState { error: string | null; success?: string; destination?: string }
const text = (form: FormData, key: string) => typeof form.get(key) === "string" ? form.get(key) as string : "";
function email(form: FormData): string { return text(form, "email").trim().toLowerCase(); }
function validEmail(value: string): boolean { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function passwordProblem(form: FormData): string | null {
  const password = text(form, "password");
  if (password.length < 10 || password.length > 256) return "Heslo musí mať 10 až 256 znakov.";
  if (password !== text(form, "repeat")) return "Heslá sa nezhodujú.";
  return null;
}
async function reserve(): Promise<LoginState | null> {
  const quota = await reserveLoginAttempt();
  return quota === "allowed" ? null : { error: quota === "limited" ? "Priveľa pokusov. Skús to znova o 15 minút." : "Služba je dočasne nedostupná. Skús to znova neskôr." };
}
async function mutationGuard(): Promise<LoginState | null> {
  try {
    const session = await currentSession();
    if (session?.claims.x) return { error: "Pri prezeraní cudzieho účtu sa nedá zapisovať." };
    if (session?.account.status === "pending") return { error: "Účet čaká na spárovanie. Pokračuj v nastaveniach účtu alebo sa odhlás." };
    return null;
  } catch (error) { return { error: accountErrorMessage(error) }; }
}
export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const blocked = await reserve(); if (blocked) return blocked;
  const address = email(form), password = text(form, "password");
  if (!validEmail(address) || !password || password.length > 256) return { error: "Zadaj platný e-mail a heslo." };
  try {
    const account = await accountsApi.login({ email: address, password });
    await startSession(account, form.get("remember") === "on");
    return { error: null, destination: account.status === "pending" ? "/cakanie" : "/" };
  } catch (error) { return { error: accountErrorMessage(error) }; }
}
export async function register(_previous: LoginState, form: FormData): Promise<LoginState> {
  const denied = await mutationGuard(); if (denied) return denied;
  const blocked = await reserve(); if (blocked) return blocked;
  const first = text(form, "first_name").trim(), last = text(form, "last_name").trim();
  if (!first || first.length > 100 || last.length > 100 || !validEmail(email(form))) return { error: "Vyplň meno a platný e-mail. Meno môže mať najviac 100 znakov." };
  const problem = passwordProblem(form); if (problem) return { error: problem };
  const key = await trustedClientKey(); if (!key) return { error: "Služba je dočasne nedostupná. Skús to znova neskôr." };
  try {
    const account = await accountsApi.register({ first_name: first, last_name: last || null, email: email(form), password: text(form, "password") }, key);
    await startSession(account, false);
    return { error: null, destination: "/cakanie" };
  } catch (error) { return { error: accountErrorMessage(error) }; }
}
export async function requestReset(_previous: LoginState, form: FormData): Promise<LoginState> {
  const denied = await mutationGuard(); if (denied) return denied;
  const blocked = await reserve(); if (blocked) return blocked;
  if (!validEmail(email(form))) return { error: "Zadaj platný e-mail." };
  try { await accountsApi.requestReset(email(form)); }
  catch (error) { return { error: accountErrorMessage(error) }; }
  return { error: null, success: "Ak účet existuje, správca dostal žiadosť. Odkaz na nové heslo ti pošle osobne." };
}
export async function confirmReset(token: string, _previous: LoginState, form: FormData): Promise<LoginState> {
  const denied = await mutationGuard(); if (denied) return denied;
  const blocked = await reserve(); if (blocked) return blocked;
  const problem = passwordProblem(form); if (problem) return { error: problem };
  if (!token || token.length > 256) return { error: "Odkaz na nové heslo je neplatný alebo už vypršal." };
  try { await accountsApi.confirmReset(token, text(form, "password")); await endSession(); }
  catch (error) { return { error: accountErrorMessage(error) }; }
  return { error: null, success: "Heslo je zmenené. Prihlás sa novým heslom.", destination: "/login" };
}
export async function logout(): Promise<void> { await endSession(); redirect("/login"); }
export async function logoutForNavigation(): Promise<LoginState> { await endSession(); return { error: null, destination: "/login" }; }
