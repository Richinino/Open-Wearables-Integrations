// The calendar page and the weekly charts of the workouts page: month and week grids
// (Monday first), stepping through the months or weeks that have data, the averages of a
// period and training volume per week. Pure functions; null and absent days mean "no data"
// and are never counted as zero.

import { addDays, dateRange, diffDays, weekdayIndex } from "./dates";
import { formatDayMonth } from "./format";
import { average, indexByDay } from "./metrics";
import type { Day, Workout } from "./types";

export type CalendarView = "month" | "week";

/** Sleep that fills the bar of a calendar cell: 9 hours. */
export const SLEEP_BAR_MINUTES = 540;

const MONTHS_NOMINATIVE = [
  "Január",
  "Február",
  "Marec",
  "Apríl",
  "Máj",
  "Jún",
  "Júl",
  "August",
  "September",
  "Október",
  "November",
  "December",
];

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---------------------------------------------------------------------------------------
// Periods

/** "2026-10" for any day of October 2026. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The Monday of the week `day` belongs to. */
export function weekStartOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

function shiftMonth(month: string, step: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + step;
  const shiftedYear = year + Math.floor(index / 12);
  const shiftedMonth = ((index % 12) + 12) % 12;
  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth + 1).padStart(2, "0")}`;
}

/** The period `day` falls in: a month key ("2026-10") or the Monday of its week. */
export function periodOf(view: CalendarView, day: string): string {
  return view === "month" ? monthOf(day) : weekStartOf(day);
}

/** First and last day of a period, both included. */
export function periodRange(view: CalendarView, period: string): { from: string; to: string } {
  if (view === "week") return { from: period, to: addDays(period, 6) };
  return { from: `${period}-01`, to: addDays(`${shiftMonth(period, 1)}-01`, -1) };
}

export function hasData(day: Day | null | undefined): boolean {
  if (!day) return false;
  return (
    isNumber(day.steps) ||
    isNumber(day.sleep_minutes) ||
    isNumber(day.hr_resting) ||
    isNumber(day.scores?.day_score) ||
    (day.workouts?.length ?? 0) > 0
  );
}

/**
 * Every period that has a day with data up to `today`, and the period of `today` itself,
 * oldest first. These are the stops of the previous/next buttons.
 */
export function periodsWithData(days: Day[], view: CalendarView, today: string): string[] {
  const periods = new Set<string>([periodOf(view, today)]);
  for (const day of days) {
    if (day.day <= today && hasData(day)) periods.add(periodOf(view, day.day));
  }
  return [...periods].sort();
}

/** The neighbouring stop before (`step` −1) or after (+1) `current`; null at either end. */
export function adjacentPeriod(periods: string[], current: string, step: -1 | 1): string | null {
  if (step < 0) {
    const earlier = periods.filter((period) => period < current);
    return earlier.length ? earlier[earlier.length - 1] : null;
  }
  return periods.find((period) => period > current) ?? null;
}

/** The latest day with data up to `today`; `today` when there is none. */
export function latestDataDay(days: Day[], today: string): string {
  for (let index = days.length - 1; index >= 0; index--) {
    const day = days[index];
    if (day.day <= today && hasData(day)) return day.day;
  }
  return today;
}

/**
 * The day to select after moving to `period`: `keep` when it lies in the period, else the
 * latest day with data in it, else null.
 */
export function selectionIn(
  days: Day[],
  view: CalendarView,
  period: string,
  today: string,
  keep: string | null = null,
): string | null {
  const { from, to } = periodRange(view, period);
  const byDay = indexByDay(days);
  if (keep && keep >= from && keep <= to && keep <= today && hasData(byDay.get(keep))) return keep;
  const last = to < today ? to : today;
  if (last < from) return null;
  const candidates = dateRange(from, last).reverse();
  return candidates.find((day) => hasData(byDay.get(day))) ?? null;
}

// ---------------------------------------------------------------------------------------
// Cells

export interface CalendarCell {
  day: string;
  /** False for the dimmed days of the neighbouring months that fill the month grid. */
  inPeriod: boolean;
  /** After today: an empty slot. */
  future: boolean;
  isToday: boolean;
  data: Day | null;
  dayScore: number | null;
  steps: number | null;
  /** An unfinished day: its running totals will still grow. */
  running: boolean;
  sleepMinutes: number | null;
  /** Sleep against SLEEP_BAR_MINUTES, 0..1. */
  sleepShare: number | null;
  workouts: Workout[];
}

function cell(day: string, inPeriod: boolean, today: string, data: Day | null): CalendarCell {
  const future = day > today;
  const shown = future ? null : data;
  const sleepMinutes = isNumber(shown?.sleep_minutes) ? shown.sleep_minutes : null;
  return {
    day,
    inPeriod,
    future,
    isToday: day === today,
    data: shown,
    dayScore: isNumber(shown?.scores?.day_score) ? shown.scores.day_score : null,
    steps: isNumber(shown?.steps) ? shown.steps : null,
    running: shown?.complete === false,
    sleepMinutes,
    sleepShare: sleepMinutes === null ? null : Math.min(1, sleepMinutes / SLEEP_BAR_MINUTES),
    workouts: [...(shown?.workouts ?? [])].sort((a, b) => b.duration_s - a.duration_s),
  };
}

/**
 * The cells of a period. A month runs from the Monday on or before its first day to the
 * Sunday on or after its last, so it has whole weeks; a week has its seven days.
 */
export function calendarCells(days: Day[], view: CalendarView, period: string, today: string): CalendarCell[] {
  const byDay = indexByDay(days);
  const { from, to } = periodRange(view, period);
  const first = weekStartOf(from);
  const last = addDays(weekStartOf(to), 6);
  return dateRange(first, last).map((day) => cell(day, day >= from && day <= to, today, byDay.get(day) ?? null));
}

// ---------------------------------------------------------------------------------------
// Averages

export interface PeriodAverages {
  dayScore: number | null;
  /** Per finished day; an unfinished day's running total would pull the mean down. */
  steps: number | null;
  sleepMinutes: number | null;
  restingHr: number | null;
  strain: number | null;
  workouts: number;
  workoutSeconds: number;
  daysWithData: number;
}

/** Means over the days with data from `from` to `to` (both included, never after `today`). */
export function periodAverages(days: Day[], from: string, to: string, today: string): PeriodAverages {
  const last = to < today ? to : today;
  const inside = days.filter((day) => day.day >= from && day.day <= last && hasData(day));
  const workouts = inside.flatMap((day) => day.workouts ?? []);
  return {
    dayScore: average(inside.map((day) => day.scores?.day_score)),
    steps: average(inside.filter((day) => day.complete !== false).map((day) => day.steps)),
    sleepMinutes: average(inside.map((day) => day.sleep_minutes)),
    restingHr: average(inside.map((day) => day.hr_resting)),
    strain: average(inside.filter((day) => day.complete !== false).map((day) => day.scores?.strain)),
    workouts: workouts.length,
    workoutSeconds: workouts.reduce((total, workout) => total + (isNumber(workout.duration_s) ? workout.duration_s : 0), 0),
    daysWithData: inside.length,
  };
}

// ---------------------------------------------------------------------------------------
// Headings

/** "Október", with the year when it is not the year of `today`. */
export function monthTitle(month: string, today: string): string {
  const name = MONTHS_NOMINATIVE[Number(month.slice(5, 7)) - 1] ?? month;
  return month.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${month.slice(0, 4)}`;
}

/** "12. – 18. 10.", "29. 9. – 5. 10.", or with years when the week is not in `today`'s year. */
export function weekTitle(start: string, today: string): string {
  const end = addDays(start, 6);
  const sameYear = start.slice(0, 4) === today.slice(0, 4) && end.slice(0, 4) === today.slice(0, 4);
  if (!sameYear) return `${formatDayMonth(start)} ${start.slice(0, 4)} – ${formatDayMonth(end)} ${end.slice(0, 4)}`;
  if (monthOf(start) === monthOf(end)) return `${Number(start.slice(8, 10))}. – ${formatDayMonth(end)}`;
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

/** "Október v priemere" or "Týždeň v priemere". */
export function averagesTitle(view: CalendarView, period: string, today: string): string {
  return view === "month" ? `${monthTitle(period, today)} v priemere` : "Týždeň v priemere";
}

// ---------------------------------------------------------------------------------------
// Training per week

export interface TrainingWeek {
  /** Monday of the week. */
  week: string;
  count: number;
  seconds: number;
  /** Mean strain of the week's finished days with a strain; WHOOP strains are not added up. */
  dayStrain: number | null;
  /** Some days of the week are after `today` or still running. */
  partial: boolean;
}

/**
 * Training volume of every week from the week of `from` to the week of `to`, oldest first.
 * `workouts` decides the volume (it may be filtered by type); the day strain is always
 * the whole day's, from `days`.
 */
export function trainingWeeks(
  days: Day[],
  workouts: Workout[],
  from: string,
  to: string,
  today: string,
): TrainingWeek[] {
  const first = weekStartOf(from);
  const last = weekStartOf(to);
  const weeks = diffDays(first, last) / 7 + 1;
  if (weeks <= 0) return [];
  const byDay = indexByDay(days);
  return Array.from({ length: weeks }, (_, index) => {
    const week = addDays(first, index * 7);
    const end = addDays(week, 6);
    const inWeek = workouts.filter((workout) => workout.day >= week && workout.day <= end && workout.day >= from && workout.day <= to);
    const strains = dateRange(week, end).map((day) => {
      const data = byDay.get(day);
      return data && data.complete !== false && day >= from && day <= to ? data.scores?.strain : null;
    });
    return {
      week,
      count: inWeek.length,
      seconds: inWeek.reduce((total, workout) => total + (isNumber(workout.duration_s) ? workout.duration_s : 0), 0),
      dayStrain: average(strains),
      partial: end >= today,
    };
  });
}

/** Mean strain of the workouts that have one. */
export function averageWorkoutStrain(workouts: Workout[]): number | null {
  return average(workouts.map((workout) => workout.strain));
}
