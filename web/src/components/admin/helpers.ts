import type { Account } from "@/lib/account-types";

export function accountName(account: Pick<Account, "first_name" | "last_name">) {
  return [account.first_name, account.last_name].filter(Boolean).join(" ");
}

export function sortAccounts<T extends Pick<Account, "status" | "first_name" | "last_name">>(accounts: T[]): T[] {
  return [...accounts].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || accountName(a).localeCompare(accountName(b), "sk"));
}

export const STATUS_LABELS = { pending: "Čaká na spárovanie", active: "Aktívny", suspended: "Pozastavený" };

export function dateLabel(value: string | null | undefined): string {
  if (!value) return "Zatiaľ nie je k dispozícii";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Neznámy čas" : new Intl.DateTimeFormat("sk-SK", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Bratislava" }).format(date);
}

export function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}
