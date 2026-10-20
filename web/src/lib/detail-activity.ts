// Calculations behind the activity and steps detail pages: what each Activity part measures,
// the strain bands, the cardio load status and its trend, time in heart-rate zones, and the
// steps of the last months (average, weekday pattern, best days, distance). Pure functions;
// null and absent days mean "no data" and running totals of an unfinished day are left out
// of averages and records. Texts are Slovak.

import { addDays, dateRange, weekdayIndex } from "./dates";
import { dayValue } from "./day-values";
import { average, indexByDay, sum } from "./metrics";
import type { CardioLoadStatus, Day } from "./types";

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---------------------------------------------------------------------------------------
// Activity parts

export interface ActivityPart {
  key: string;
  max: number;
  weight: number;
  explain: string;
}

/** Oura Activity as owi computes it, heaviest first; weights from docs/skore.md. */
export const ACTIVITY_PARTS: ActivityPart[] = [
  { key: "meet_daily_targets", max: 100, weight: 0.25, explain: "v koľkých z posledných 7 dní si splnil denný cieľ pohybu; ideál 6–7" },
  { key: "stay_active", max: 100, weight: 0.2, explain: "koľko bdelých hodín prešlo bez pohybu; do 5–8 h je to v poriadku" },
  { key: "training_volume", max: 100, weight: 0.15, explain: "objem strednej a vysokej intenzity za 7 dní; cieľ okolo 2 000 MET-minút" },
  { key: "training_frequency", max: 100, weight: 0.15, explain: "koľko dní z 7 malo poriadny tréning; ideál 3–4" },
  { key: "recovery_time", max: 100, weight: 0.15, explain: "či mal týždeň aj 1–2 ľahšie dni na oddych" },
  { key: "move_every_hour", max: 100, weight: 0.1, explain: "či si sa hýbal aspoň raz za hodinu; uberá každé sedenie dlhšie ako 50 min" },
];

// ---------------------------------------------------------------------------------------
// Strain

export interface StrainBand {
  key: "light" | "moderate" | "high" | "max";
  from: number;
  to: number;
  label: string;
}

/** WHOOP strain bands on the 0-21 scale. */
export const STRAIN_BANDS: StrainBand[] = [
  { key: "light", from: 0, to: 10, label: "ľahká" },
  { key: "moderate", from: 10, to: 14, label: "stredná" },
  { key: "high", from: 14, to: 18, label: "vysoká" },
  { key: "max", from: 18, to: 21, label: "maximálna" },
];

export const STRAIN_MAX = 21;

// ---------------------------------------------------------------------------------------
// Cardio load

export interface CardioBand {
  status: CardioLoadStatus;
  /** Ratio range, from inclusive; `to` is exclusive except for the last band. */
  from: number;
  to: number;
  text: string;
}

/** Polar's ratio bands. "Recovering" shares the lowest range after an overreaching spell. */
export const CARDIO_BANDS: CardioBand[] = [
  { status: "detraining", from: 0, to: 0.8, text: "posledný týždeň je záťaž citeľne nižšia, než na akú si zvyknutý" },
  { status: "maintaining", from: 0.8, to: 1.0, text: "trénuješ asi ako zvyčajne alebo o niečo menej; forma sa drží" },
  { status: "productive", from: 1.0, to: 1.3, text: "záťaž mierne nad tvojím zvykom; takto sa forma zlepšuje" },
  { status: "overreaching", from: 1.3, to: Infinity, text: "záťaž výrazne nad tvojím zvykom; dlhšie to zvyšuje únavu a riziko zranenia" },
];

export const RECOVERING_TEXT = "po náročnom období záťaž klesla a telo sa zotavuje";

/** Thresholds between the bands, for guide lines. */
export const CARDIO_THRESHOLDS = [0.8, 1.0, 1.3] as const;

export function cardioText(status: CardioLoadStatus | null | undefined): string | null {
  if (status === "recovering") return RECOVERING_TEXT;
  return CARDIO_BANDS.find((band) => band.status === status)?.text ?? null;
}

export interface CardioPoint {
  day: string;
  ratio: number | null;
  strain7: number | null;
  tolerance28: number | null;
  status: CardioLoadStatus | null;
}

/** The cardio load of every day of the window ending at `end`, oldest first. */
export function cardioTrend(days: Day[], end: string, length: number = 84): CardioPoint[] {
  const byDay = indexByDay(days);
  return dateRange(addDays(end, -(length - 1)), end).map((date) => {
    const load = byDay.get(date)?.scores?.cardio_load;
    return {
      day: date,
      ratio: isNumber(load?.ratio) ? (load?.ratio as number) : null,
      strain7: isNumber(load?.strain_7d) ? (load?.strain_7d as number) : null,
      tolerance28: isNumber(load?.tolerance_28d) ? (load?.tolerance_28d as number) : null,
      status: load?.status ?? null,
    };
  });
}

/** The last value of each whole week in the trend, newest first: the table twin of the chart. */
export function cardioWeeks(points: CardioPoint[]): CardioPoint[] {
  const weeks: CardioPoint[] = [];
  for (let index = points.length - 1; index >= 0; index -= 7) {
    const week = points.slice(Math.max(0, index - 6), index + 1).reverse();
    const last = week.find((point) => point.ratio !== null);
    if (last) weeks.push(last);
  }
  return weeks;
}

// ---------------------------------------------------------------------------------------
// Zones

export interface ZoneTotals {
  light: number;
  moderate: number;
  vigorous: number;
  /** Days of the window that had zone data. */
  days: number;
}

/** Minutes in each zone over the `length` days ending at `end`; null with no zone data. */
export function zoneTotals(days: Day[], end: string, length: number): ZoneTotals | null {
  const from = addDays(end, -(length - 1));
  const window = days.filter(
    (day) =>
      day.day >= from &&
      day.day <= end &&
      (isNumber(day.zone_light_min) || isNumber(day.zone_moderate_min) || isNumber(day.zone_vigorous_min)),
  );
  if (window.length === 0) return null;
  return {
    light: sum(window.map((day) => day.zone_light_min)) ?? 0,
    moderate: sum(window.map((day) => day.zone_moderate_min)) ?? 0,
    vigorous: sum(window.map((day) => day.zone_vigorous_min)) ?? 0,
    days: window.length,
  };
}

// ---------------------------------------------------------------------------------------
// Steps

export interface StepsCategory {
  from: number;
  label: string;
}

/** Tudor-Locke's daily step categories. */
export const STEPS_CATEGORIES: StepsCategory[] = [
  { from: 12_500, label: "veľmi aktívny" },
  { from: 10_000, label: "aktívny" },
  { from: 7_500, label: "čiastočne aktívny" },
  { from: 5_000, label: "málo aktívny" },
  { from: 0, label: "sedavý" },
];

export function stepsCategory(steps: number | null | undefined): StepsCategory | null {
  if (!isNumber(steps)) return null;
  return STEPS_CATEGORIES.find((category) => steps >= category.from) ?? STEPS_CATEGORIES[STEPS_CATEGORIES.length - 1];
}

/** Steps of a finished day; an unfinished day's running total and missing steps give null. */
export function finishedSteps(day: Day | null | undefined): number | null {
  if (!day || day.complete === false || !isNumber(day.steps)) return null;
  return day.steps;
}

export interface StepsStats {
  average: number | null;
  /** Finished days with steps. */
  days: number;
  total: number | null;
  distance: number | null;
  distanceAverage: number | null;
}

/** Averages of the finished days in the `length` days ending at `end`. */
export function stepsStats(days: Day[], end: string, length: number): StepsStats {
  const from = addDays(end, -(length - 1));
  const finished = days.filter((day) => day.day >= from && day.day <= end && finishedSteps(day) !== null);
  const distances = finished.map((day) => dayValue(day, "distance"));
  return {
    average: average(finished.map(finishedSteps)),
    days: finished.length,
    total: sum(finished.map(finishedSteps)),
    distance: sum(distances),
    distanceAverage: average(distances),
  };
}

export interface WeekdaySteps {
  /** 0 = Monday. */
  weekday: number;
  average: number | null;
  days: number;
}

/** Mean steps per weekday over the finished days of the window. */
export function weekdaySteps(days: Day[], end: string, length: number = 90): WeekdaySteps[] {
  const from = addDays(end, -(length - 1));
  const finished = days.filter((day) => day.day >= from && day.day <= end && finishedSteps(day) !== null);
  return Array.from({ length: 7 }, (_, weekday) => {
    const values = finished.filter((day) => weekdayIndex(day.day) === weekday).map(finishedSteps);
    return { weekday, average: average(values), days: values.length };
  });
}

export interface BestDay {
  day: string;
  steps: number;
  distance: number | null;
}

/** The finished days with the most steps, best first; on a tie the earlier day comes first. */
export function bestStepDays(days: Day[], end: string, length: number = 90, count: number = 5): BestDay[] {
  const from = addDays(end, -(length - 1));
  return days
    .filter((day) => day.day >= from && day.day <= end && finishedSteps(day) !== null)
    .map((day) => ({ day: day.day, steps: day.steps as number, distance: dayValue(day, "distance") }))
    .sort((a, b) => b.steps - a.steps || (a.day < b.day ? -1 : 1))
    .slice(0, count);
}

/** Weekend days against working days, as a share: 0.2 = the weekend has 20 % more. */
export function weekendShare(pattern: WeekdaySteps[]): number | null {
  const weekend = average(pattern.filter((item) => item.weekday >= 5).map((item) => item.average));
  const weekday = average(pattern.filter((item) => item.weekday < 5).map((item) => item.average));
  if (weekend === null || weekday === null || weekday <= 0) return null;
  return weekend / weekday - 1;
}
