// Pure calculations over the days returned by the API.
// null, undefined and absent days all mean "no data" and are never counted as zero.

import { addDays, localMinutesOfDay } from "./dates";
import { dayValue } from "./day-values";
import type { Day, Workout } from "./types";

export type NumericDayKey =
  | "steps"
  | "distance_m_est"
  | "distance_m"
  | "active_kcal"
  | "total_kcal"
  | "resting_hr"
  | "active_minutes_est"
  | "activity_kcal_est"
  | "basal_kcal"
  | "total_kcal_est"
  | "hr_resting"
  | "hr_avg"
  | "hr_max"
  | "hr_min"
  | "zone_light_min"
  | "zone_moderate_min"
  | "zone_vigorous_min"
  | "sleep_minutes"
  | "sleep_deep_min"
  | "sleep_rem_min"
  | "sleep_light_min"
  | "sleep_awake_min"
  | "nap_minutes";

export interface DaySlot {
  day: string;
  data: Day | null;
}

export interface Point {
  day: string;
  value: number | null;
}

export interface PeriodSummary {
  average: number | null;
  total: number | null;
  count: number;
  previousAverage: number | null;
  change: number | null;
}

export interface WorkoutTotals {
  count: number;
  seconds: number;
  distanceM: number | null;
  kcal: number | null;
  byType: { type: string; count: number; seconds: number }[];
}

export interface SleepNight {
  day: string;
  start: string;
  end: string;
  minutes: number | null;
  deep: number | null;
  rem: number | null;
  light: number | null;
  awake: number | null;
  nap: number | null;
  bedMinutes: number;
  wakeMinutes: number;
}

const MINUTES_PER_DAY = 1440;
const NOON_MINUTES = 720;

function present(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function indexByDay(days: Day[]): Map<string, Day> {
  return new Map(days.map((day) => [day.day, day]));
}

export function windowEnding(days: Day[], end: string, length: number): DaySlot[] {
  const byDay = indexByDay(days);
  const slots: DaySlot[] = [];
  for (let offset = Math.floor(length) - 1; offset >= 0; offset--) {
    const day = addDays(end, -offset);
    slots.push({ day, data: byDay.get(day) ?? null });
  }
  return slots;
}

export function series(
  slots: DaySlot[],
  key: NumericDayKey,
  options: { includeIncomplete?: boolean } = {},
): Point[] {
  const includeIncomplete = options.includeIncomplete ?? true;
  return slots.map(({ day, data }) => {
    if (!data || (!includeIncomplete && data.complete === false)) return { day, value: null };
    const value = key === "distance_m" ? dayValue(data, "distance")
      : key === "active_kcal" ? dayValue(data, "activeEnergy")
      : key === "total_kcal" ? dayValue(data, "totalEnergy")
      : key === "resting_hr" ? dayValue(data, "restingHr") : data[key];
    return { day, value: typeof value === "number" && Number.isFinite(value) ? value : null };
  });
}

export function sum(values: readonly (number | null | undefined)[]): number | null {
  const numbers = present(values);
  return numbers.length === 0 ? null : numbers.reduce((total, value) => total + value, 0);
}

export function average(values: readonly (number | null | undefined)[]): number | null {
  const numbers = present(values);
  return numbers.length === 0
    ? null
    : numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

export function min(values: readonly (number | null | undefined)[]): number | null {
  const numbers = present(values);
  return numbers.length === 0 ? null : numbers.reduce((low, value) => (value < low ? value : low));
}

export function max(values: readonly (number | null | undefined)[]): number | null {
  const numbers = present(values);
  return numbers.length === 0 ? null : numbers.reduce((high, value) => (value > high ? value : high));
}

export function periodSummary(
  days: Day[],
  end: string,
  length: number,
  key: NumericDayKey,
  options: { includeIncomplete?: boolean } = {},
): PeriodSummary {
  const includeIncomplete = options.includeIncomplete ?? false;
  const valuesEnding = (lastDay: string) =>
    series(windowEnding(days, lastDay, length), key, { includeIncomplete }).map((point) => point.value);

  const current = valuesEnding(end);
  const currentAverage = average(current);
  const previousAverage = average(valuesEnding(addDays(end, -Math.floor(length))));
  const comparable = currentAverage !== null && previousAverage !== null && previousAverage !== 0;

  return {
    average: currentAverage,
    total: sum(current),
    count: present(current).length,
    previousAverage,
    change: comparable ? (currentAverage - previousAverage) / previousAverage : null,
  };
}

export function allWorkouts(days: Day[]): Workout[] {
  const time = (workout: Workout) => {
    const ms = Date.parse(workout.start);
    return Number.isNaN(ms) ? 0 : ms;
  };
  return days
    .flatMap((day) => day.workouts ?? [])
    .sort((a, b) => time(b) - time(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function workoutTotals(workouts: Workout[]): WorkoutTotals {
  const byType = new Map<string, { type: string; count: number; seconds: number }>();
  let seconds = 0;
  for (const workout of workouts) {
    const duration = Number.isFinite(workout.duration_s) ? workout.duration_s : 0;
    seconds += duration;
    const entry = byType.get(workout.type) ?? { type: workout.type, count: 0, seconds: 0 };
    entry.count += 1;
    entry.seconds += duration;
    byType.set(workout.type, entry);
  }
  return {
    count: workouts.length,
    seconds,
    distanceM: sum(workouts.map((workout) => workout.distance_m)),
    kcal: sum(workouts.map((workout) => workout.kcal_est)),
    byType: [...byType.values()].sort(
      (a, b) => b.count - a.count || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
    ),
  };
}

/**
 * Nights that have both a start and an end, oldest first.
 *
 * Sleep clock convention: clock times are minutes counted from local NOON, not from midnight,
 * so an evening bedtime and one just after midnight sit next to each other instead of at
 * opposite ends of the scale.
 *   bedMinutes  = minutes from local noon to sleep_start, in [0, 1440): 22:30 → 630, 00:15 → 735
 *   wakeMinutes = bedMinutes + (sleep_end − sleep_start) in minutes: 07:00 after 22:30 → 1140
 * wakeMinutes is elapsed time, so on the two nights a year when the clocks change it is one
 * hour off the wall clock; format sleep_end itself when the exact wake-up time matters.
 */
export function sleepNights(days: Day[], timeZone: string): SleepNight[] {
  const nights: SleepNight[] = [];
  for (const day of days) {
    if (!day.sleep_start || !day.sleep_end) continue;
    const startMs = Date.parse(day.sleep_start);
    const endMs = Date.parse(day.sleep_end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;

    const bedMinutes =
      (localMinutesOfDay(day.sleep_start, timeZone) - NOON_MINUTES + MINUTES_PER_DAY) %
      MINUTES_PER_DAY;
    nights.push({
      day: day.day,
      start: day.sleep_start,
      end: day.sleep_end,
      minutes: day.sleep_minutes ?? null,
      deep: day.sleep_deep_min ?? null,
      rem: day.sleep_rem_min ?? null,
      light: day.sleep_light_min ?? null,
      awake: day.sleep_awake_min ?? null,
      nap: day.nap_minutes ?? null,
      bedMinutes,
      wakeMinutes: bedMinutes + Math.round((endMs - startMs) / 60_000),
    });
  }
  return nights.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Mean of clock values in the minutes-from-noon convention; null for no values. */
export function averageClock(minutesFromNoon: readonly number[]): number | null {
  return average(minutesFromNoon);
}

export function isStale(syncedAt: string | null, now: Date, thresholdMinutes: number = 90): boolean {
  if (!syncedAt) return true;
  const synced = Date.parse(syncedAt);
  if (Number.isNaN(synced)) return true;
  return now.getTime() - synced > thresholdMinutes * 60_000;
}
