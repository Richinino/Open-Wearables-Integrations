import { approx } from "./format";
import { addDays } from "./dates";
import type { Day, ValueSource } from "./types";

export type DayMetric = "distance" | "activeEnergy" | "totalEnergy" | "restingHr";
const FIELDS = {
  distance: ["distance_m", "distance_m_source", "distance_m_est"],
  activeEnergy: ["active_kcal", "active_kcal_source", "activity_kcal_est"],
  totalEnergy: ["total_kcal", "total_kcal_source", "total_kcal_est"],
  restingHr: ["resting_hr", "resting_hr_source", "hr_resting"],
} as const;

/** Explicit null in a new payload is missing data, never an excuse to reuse an old estimate. */
export function dayValue(day: Day | null | undefined, metric: DayMetric): number | null {
  if (!day) return null;
  const [field, , fallback] = FIELDS[metric];
  const value = Object.hasOwn(day, field) ? day[field] : day[fallback];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function dayValueSource(day: Day | null | undefined, metric: DayMetric): ValueSource | null {
  if (dayValue(day, metric) === null || !day) return null;
  const [field, source] = FIELDS[metric];
  if (!Object.hasOwn(day, field)) return metric === "restingHr" ? "derived" : "estimated";
  const value = day[source];
  return value === "measured" || value === "derived" || value === "estimated" ? value : null;
}

export function dayFigure(
  day: Day | null | undefined,
  metric: DayMetric,
  format: (value: number | null | undefined) => string,
): string {
  const text = format(dayValue(day, metric));
  return dayValueSource(day, metric) === "estimated" ? approx(text) : text;
}

export function periodHasEstimate(days: Day[], metric: DayMetric): boolean {
  return days.some((day) => dayValueSource(day, metric) === "estimated");
}

export function periodFigure(
  days: Day[], end: string, length: number, metric: DayMetric,
  value: number | null, format: (value: number | null | undefined) => string,
): string {
  const from = addDays(end, -(length - 1));
  const used = days.filter((day) => day.complete !== false && day.day >= from && day.day <= end);
  const text = format(value);
  return periodHasEstimate(used, metric) ? approx(text) : text;
}
