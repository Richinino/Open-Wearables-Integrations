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

const DATA_TYPE_LABELS: Record<string, string> = {
  steps: "Kroky", heart_rate: "Tep", resting_heart_rate: "Pokojový tep", hrv: "Variabilita tepu (HRV)",
  heart_rate_variability_sdnn: "HRV · SDNN", heart_rate_variability_rmssd: "HRV · RMSSD",
  sleep: "Spánok", workouts: "Tréningy", workout: "Tréningy", distance: "Vzdialenosť",
  active_calories: "Aktívne kalórie", active_energy: "Aktívna energia", total_calories: "Celkové kalórie",
  total_energy: "Celková energia", vo2max: "VO₂max", weight: "Hmotnosť",
};

export function dataTypeLabel(value: unknown): string {
  const key = textValue(value);
  return DATA_TYPE_LABELS[key] ?? key;
}
