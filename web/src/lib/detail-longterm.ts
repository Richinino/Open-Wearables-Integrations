// The long-term page: VO2max from the watch against the Uth–Sørensen estimate, WHOOP-style
// body age and what moves it, the resting heart rate over months, and records. Pure
// functions; null and absent days mean "no data" and are never counted as zero.

import { addDays, diffDays, weekdayIndex } from "./dates";
import { average, indexByDay } from "./metrics";
import { records, type RecordKey } from "./overview";
import { componentLabel, noteText } from "./scores";
import type { Day, Score } from "./types";

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---------------------------------------------------------------------------------------
// Weekly series

export interface WeekValue {
  /** Monday of the week. */
  week: string;
  value: number | null;
}

/**
 * Mean of `pick` per week for the `weeks` weeks ending with the week of `end`, oldest first.
 * Leading weeks without any value are dropped, so a short history fills the chart.
 */
export function weeklyMeans(
  days: Day[],
  end: string,
  pick: (day: Day) => number | null | undefined,
  weeks: number = 52,
): WeekValue[] {
  const byDay = indexByDay(days);
  const lastWeek = addDays(end, -weekdayIndex(end));
  const series: WeekValue[] = [];
  for (let index = weeks - 1; index >= 0; index--) {
    const week = addDays(lastWeek, -7 * index);
    const values = Array.from({ length: 7 }, (_, offset) => {
      const day = addDays(week, offset);
      const data = day <= end ? byDay.get(day) : undefined;
      return data ? pick(data) : null;
    });
    series.push({ week, value: average(values) });
  }
  const first = series.findIndex((item) => item.value !== null);
  return first < 0 ? [] : series.slice(first);
}

export interface Vo2Week {
  week: string;
  watch: number | null;
  uth: number | null;
}

/** VO2max per week: the watch's own value and the Uth–Sørensen estimate side by side. */
export function vo2maxWeeks(days: Day[], end: string, weeks: number = 52): Vo2Week[] {
  const watch = weeklyMeans(days, end, (day) => day.scores?.vo2max, weeks);
  const uth = weeklyMeans(days, end, (day) => day.scores?.vo2max_uth, weeks);
  const starts = [watch[0]?.week, uth[0]?.week].filter((week): week is string => Boolean(week)).sort();
  if (starts.length === 0) return [];
  const first = starts[0];
  const valueAt = (series: WeekValue[], week: string) => series.find((item) => item.week === week)?.value ?? null;
  const count = diffDays(first, addDays(end, -weekdayIndex(end))) / 7 + 1;
  return Array.from({ length: count }, (_, index) => {
    const week = addDays(first, index * 7);
    return { week, watch: valueAt(watch, week), uth: valueAt(uth, week) };
  });
}

/** The latest value of `pick` on or before `end`, with its day. */
export function latestValue(
  days: Day[],
  end: string,
  pick: (day: Day) => number | null | undefined,
): { value: number; day: string } | null {
  for (let index = days.length - 1; index >= 0; index--) {
    const day = days[index];
    if (day.day > end) continue;
    const value = pick(day);
    if (isNumber(value)) return { value, day: day.day };
  }
  return null;
}

/** Mean of the last `span` values minus the mean of the first `span`; null without both. */
export function seriesChange(values: (number | null)[], span: number = 4): number | null {
  if (values.length < span * 2) return null;
  const head = average(values.slice(0, span));
  const tail = average(values.slice(-span));
  return head === null || tail === null ? null : tail - head;
}

// ---------------------------------------------------------------------------------------
// VO2max

/**
 * Words for a VO2max of a 17-year-old male: about 45–50 is typical, above 55 excellent.
 * The bands move with age and sex; these follow the person the site is built for.
 */
export function vo2maxLevel(value: number | null | undefined): string | null {
  if (!isNumber(value)) return null;
  if (value >= 55) return "výborná kondícia";
  if (value > 50) return "nad bežnou hodnotou";
  if (value >= 45) return "bežná hodnota";
  return "pod bežnou hodnotou";
}

// ---------------------------------------------------------------------------------------
// Body age (WHOOP Age)

/** owi scales the sum of the metric impacts by this to allow for their overlap. */
export const OVERLAP_FACTOR = 0.45;

export interface AgeContribution {
  key: string;
  label: string;
  /** The metric's own impact in years, before the overlap factor. */
  raw: number;
  /** Its share of the difference between body age and age: raw × factor. */
  years: number;
  /** Part of all impacts, by size, 0..1. */
  share: number;
}

export interface BodyAge {
  value: number | null;
  /** Calendar age, read back from the score: value − factor × Σ impacts. */
  realAge: number | null;
  /** Body age minus age; negative is younger. */
  difference: number | null;
  /** The overlap factor the score was built with. */
  factor: number;
  /** Most "younger" first, most "older" last. */
  contributions: AgeContribution[];
  /** Metrics without data, by name. */
  missing: string[];
  /** owi's note in Slovak, e.g. "odhad". */
  note: string | null;
}

/**
 * The calendar age behind a body age. owi adds `OVERLAP_FACTOR` × Σ impacts to the age, so
 * the age is what is left. Data built without the factor (the demo) gives a whole number
 * only with factor 1, which is tried second.
 */
function readAge(value: number, sum: number): { age: number; factor: number } | null {
  for (const factor of [OVERLAP_FACTOR, 1]) {
    const age = value - factor * sum;
    if (Math.abs(age - Math.round(age)) <= 0.11 && age > 0) return { age: Math.round(age), factor };
  }
  return null;
}

export function bodyAge(score: Score | null | undefined): BodyAge | null {
  if (!score) return null;
  const entries = Object.entries(score.components ?? {});
  const present = entries.filter((entry): entry is [string, number] => isNumber(entry[1]));
  const missing = entries.filter(([, value]) => !isNumber(value)).map(([key]) => componentLabel(key));
  if (!isNumber(score.value) && present.length === 0) {
    return { value: null, realAge: null, difference: null, factor: OVERLAP_FACTOR, contributions: [], missing, note: noteText(score.note) };
  }
  const sum = present.reduce((total, [, value]) => total + value, 0);
  const read = isNumber(score.value) ? readAge(score.value, sum) : null;
  const factor = read?.factor ?? OVERLAP_FACTOR;
  const magnitude = present.reduce((total, [, value]) => total + Math.abs(value), 0);
  const contributions = present
    .map(([key, raw]) => ({
      key,
      label: componentLabel(key),
      raw,
      years: raw * factor,
      share: magnitude > 0 ? Math.abs(raw) / magnitude : 0,
    }))
    .sort((a, b) => a.raw - b.raw || (a.key < b.key ? -1 : 1));
  const value = isNumber(score.value) ? score.value : null;
  return {
    value,
    realAge: read?.age ?? null,
    difference: value !== null && read ? value - read.age : null,
    factor,
    contributions,
    missing,
    note: noteText(score.note),
  };
}

// ---------------------------------------------------------------------------------------
// Records

export type LongRecordKey = RecordKey | "strain" | "workoutStrain" | "distance" | "active" | "vo2max";

export interface LongRecord {
  key: LongRecordKey;
  value: number;
  day: string;
  /** Workout type, for workout records. */
  type?: string;
}

/**
 * Bests of the `length` days ending at `end`: the overview's five (steps, sleep, resting heart
 * rate, longest workout, day score) and the highest day strain, workout strain, workout
 * distance, active time and VO2max. Unfinished days do not compete on running totals; on a
 * tie the earlier day keeps the record.
 */
export function longRecords(days: Day[], end: string, length: number = 90): LongRecord[] {
  const from = addDays(end, -(length - 1));
  const inWindow = days.filter((day) => day.day >= from && day.day <= end);
  const complete = inWindow.filter((day) => day.complete !== false);
  const highest = (key: LongRecordKey, candidates: Day[], pick: (day: Day) => number | null | undefined) => {
    let found: LongRecord | null = null;
    for (const day of candidates) {
      const value = pick(day);
      if (isNumber(value) && (!found || value > found.value)) found = { key, value, day: day.day };
    }
    return found;
  };
  const bestWorkout = (key: LongRecordKey, pick: (value: Day["workouts"][number]) => number | null | undefined) => {
    let found: LongRecord | null = null;
    for (const day of inWindow) {
      for (const workout of day.workouts ?? []) {
        const value = pick(workout);
        if (isNumber(value) && (!found || value > found.value)) {
          found = { key, value, day: workout.day, type: workout.type };
        }
      }
    }
    return found;
  };
  return [
    ...records(days, end, length),
    highest("strain", complete, (day) => day.scores?.strain),
    bestWorkout("workoutStrain", (workout) => workout.strain),
    bestWorkout("distance", (workout) => workout.distance_m),
    highest("active", complete, (day) => day.active_minutes_est),
    highest("vo2max", inWindow, (day) => day.scores?.vo2max),
  ].filter((item): item is LongRecord => item !== null);
}
