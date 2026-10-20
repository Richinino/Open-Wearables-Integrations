import type { Account, AccountSettings } from "./account-types";

export class AccountInputError extends Error {}

export interface AccountActionState {
  error?: string;
  success?: string;
  navigate?: string;
  resetPath?: string;
  expiresAt?: string;
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function passwordField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function confirmation(form: FormData, expected: string) {
  if (field(form, "confirmation") !== expected) throw new AccountInputError(`Na potvrdenie napíš ${expected}.`);
}

export function profileInput(form: FormData): Pick<Account, "first_name" | "last_name" | "email" | "birth_date" | "sex" | "training_consent"> {
  const first_name = field(form, "first_name");
  const email = field(form, "email").toLowerCase();
  const birth_date = field(form, "birth_date") || null;
  const sex = field(form, "sex") || null;
  if (!first_name || first_name.length > 100) throw new AccountInputError("Vyplň meno (najviac 100 znakov).");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AccountInputError("Vyplň platný e-mail.");
  if (birth_date) {
    const parsed = new Date(`${birth_date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth_date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birth_date || birth_date > new Date().toISOString().slice(0, 10)) {
      throw new AccountInputError("Vyplň platný dátum narodenia v minulosti.");
    }
  }
  if (sex !== null && sex !== "male" && sex !== "female") throw new AccountInputError("Vyber pohlavie alebo možnosť Neuvádzam.");
  const last_name = field(form, "last_name") || null;
  if (last_name && last_name.length > 100) throw new AccountInputError("Priezvisko môže mať najviac 100 znakov.");
  return { first_name, last_name, email, birth_date, sex, training_consent: form.get("training_consent") === "on" };
}

export function settingsInput(form: FormData): AccountSettings {
  const theme = field(form, "theme");
  const sleep_score = field(form, "sleep_score");
  const overview_mode = field(form, "overview_mode");
  if (theme !== "system" && theme !== "light" && theme !== "dark") throw new AccountInputError("Vyber vzhľad.");
  if (sleep_score !== "performance" && sleep_score !== "apple" && sleep_score !== "samsung") throw new AccountInputError("Vyber skóre spánku.");
  if (overview_mode !== "auto" && overview_mode !== "morning") throw new AccountInputError("Vyber režim prehľadu.");
  return { theme, sleep_score, overview_mode };
}
