import { dayValue } from "./day-values";
// Calculations behind the readiness and heart-rate detail pages: what each readiness part
// measures, resting heart rate against its own baseline, the night signal of a night in
// plain words and the yellow and red nights of the last months. Pure functions; null and
// absent days mean "no data". Observations, not medical advice. Texts are Slovak.

import { addDays, dateRange } from "./dates";
import { formatInt } from "./format";
import { average, indexByDay } from "./metrics";
import { nightSignalAlert, scoreValue } from "./scores";
import type { Day, NightSignal } from "./types";

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---------------------------------------------------------------------------------------
// Readiness parts

export interface WeightedPart {
  key: string;
  max: number;
  /** Share of the total, from docs/skore.md. */
  weight: number;
  explain: string;
}

/** Oura Readiness without HRV and temperature: the parts owi computes, heaviest first. */
export const READINESS_PARTS: WeightedPart[] = [
  { key: "sleep", max: 100, weight: 0.25, explain: "koľko si spal za posledných 24 hodín aj so zdriemnutím; plný počet okolo 9 h" },
  { key: "resting_hr", max: 100, weight: 0.2, explain: "nočný pokojový tep oproti tvojmu priemeru za 60 dní; nižší pomáha, vyšší uberá" },
  { key: "activity_balance", max: 100, weight: 0.15, explain: "pohyb za 2 týždne oproti posledným 2 mesiacom; prudký skok hore aj dole uberá" },
  { key: "sleep_balance", max: 100, weight: 0.11, explain: "či si za posledné 2 týždne spal toľko, koľko potrebuješ, alebo sa hromadí deficit" },
  { key: "previous_day_activity", max: 100, weight: 0.11, explain: "včerajšia záťaž oproti tvojmu bežnému dňu; náročný deň dnes uberá" },
  { key: "recovery_index", max: 100, weight: 0.1, explain: "ako skoro v noci klesol tep na minimum; čím skôr, tým lepšie zotavenie" },
  { key: "sleep_regularity", max: 100, weight: 0.05, explain: "či zaspávaš a vstávaš v podobných časoch, pravidelnosť spánku za 14 dní" },
];

// ---------------------------------------------------------------------------------------
// Resting heart rate against its baseline

export interface Baseline {
  mean: number;
  /** Standard deviation, at least 1 bpm so a very steady history still has a band. */
  sd: number;
  days: number;
}

/**
 * The day the readiness page is about: the latest day up to `focus` with a readiness value.
 * Today has none until its night is synced and scored. Without any value, the focus day.
 */
export function readinessDay(days: Day[], focus: string): Day | null {
  const upTo = days.filter((day) => day.day <= focus);
  const scored = [...upTo].reverse().find((day) => scoreValue(day.scores?.readiness) !== null);
  return scored ?? upTo.find((day) => day.day === focus) ?? null;
}

/** Mean and spread of the resting heart rate over the `length` days before `date`. */
export function restingBaseline(days: Day[], date: string, length: number = 60, minimum: number = 7): Baseline | null {
  const from = addDays(date, -length);
  const values = days
    .filter((day) => day.day >= from && day.day < date)
    .flatMap((day) => { const value = dayValue(day, "restingHr"); return value === null ? [] : [value]; });
  if (values.length < minimum) return null;
  const mean = average(values) as number;
  const sd = Math.sqrt(average(values.map((value) => (value - mean) ** 2)) as number);
  return { mean, sd: Math.max(1, sd), days: values.length };
}

/** A resting heart rate against the baseline, in plain words. */
export function restingComparison(value: number | null | undefined, baseline: Baseline | null): string {
  if (!isNumber(value)) return "Pokojový tep pre tento deň chýba.";
  if (!baseline) return "Na porovnanie s tvojím priemerom je zatiaľ málo dní.";
  const delta = Math.round(value - baseline.mean);
  const usual = `priemer ${formatInt(baseline.mean)} bpm za ${formatInt(baseline.days)} dní`;
  if (delta === 0) return `Rovnaký ako tvoj ${usual}.`;
  const within = Math.abs(value - baseline.mean) <= baseline.sd;
  const direction = delta < 0 ? "nižší" : "vyšší";
  const tail = within ? " To je v rámci bežného kolísania." : delta < 0 ? " Zvyčajne to znamená dobré zotavenie." : " Býva to po náročnom dni, pri strese, nedostatku spánku alebo na začiatku choroby.";
  return `O ${formatInt(Math.abs(delta))} bpm ${direction} než tvoj ${usual}.${tail}`;
}

// ---------------------------------------------------------------------------------------
// Night signal

export type SignalLevel = "green" | "yellow" | "red";

export interface SignalStatus {
  level: SignalLevel | null;
  title: string;
  text: string;
}

/** The night signal of one night in words, for every level including green and missing. */
export function signalStatus(signal: NightSignal | null | undefined): SignalStatus {
  const alert = nightSignalAlert(signal);
  if (alert) return alert;
  if (signal?.level === "green") {
    const night = isNumber(signal.night_hr) ? `Nočný tep ${formatInt(signal.night_hr)} bpm` : "Nočný tep";
    const usual = isNumber(signal.baseline) ? `, tvoj normál ${formatInt(signal.baseline)} bpm` : "";
    return {
      level: "green",
      title: "Nočný tep je v norme",
      text: `${night}${usual}. Rozdiel je menší ako 3 bpm, čo je bežné kolísanie.`,
    };
  }
  return {
    level: null,
    title: "Nočný tep sa nedá porovnať",
    text: "Na túto noc chýba dosť minút spánku s tepom alebo zatiaľ nie je s čím porovnávať.",
  };
}

export interface SignalNight {
  day: string;
  level: "yellow" | "red";
  nightHr: number | null;
  baseline: number | null;
  delta: number | null;
}

/** Yellow and red nights in the `length` days ending at `end`, newest first. */
export function signalNights(days: Day[], end: string, length: number = 90): SignalNight[] {
  const from = addDays(end, -(length - 1));
  return days
    .filter((day) => day.day >= from && day.day <= end)
    .flatMap((day) => {
      const signal = day.scores?.night_signal;
      if (!signal || (signal.level !== "yellow" && signal.level !== "red")) return [];
      return [
        {
          day: day.day,
          level: signal.level,
          nightHr: isNumber(signal.night_hr) ? signal.night_hr : null,
          baseline: isNumber(signal.baseline) ? signal.baseline : null,
          delta: isNumber(signal.delta) ? signal.delta : null,
        },
      ];
    })
    .reverse();
}

/** One line about a flagged night. */
export function signalNightText(night: SignalNight): string {
  const heart = night.nightHr === null ? "Nočný tep" : `Nočný tep ${formatInt(night.nightHr)} bpm`;
  const over = night.delta === null ? " nad normálom" : `, o ${formatInt(Math.max(1, night.delta))} bpm nad normálom`;
  const usual = night.baseline === null ? "" : ` (${formatInt(night.baseline)} bpm)`;
  const tail = night.level === "red" ? ", druhá zvýšená noc po sebe." : ".";
  return `${heart}${over}${usual}${tail}`;
}

export interface NightHeartPoint {
  day: string;
  nightHr: number | null;
  baseline: number | null;
  level: SignalLevel | null;
}

/** Night heart rate and its baseline for every day of the window, oldest first. */
export function nightHeartSeries(days: Day[], end: string, length: number): NightHeartPoint[] {
  const byDay = indexByDay(days);
  return dateRange(addDays(end, -(length - 1)), end).map((date) => {
    const signal = byDay.get(date)?.scores?.night_signal;
    return {
      day: date,
      nightHr: isNumber(signal?.night_hr) ? (signal?.night_hr as number) : null,
      baseline: isNumber(signal?.baseline) ? (signal?.baseline as number) : null,
      level: signal?.level ?? null,
    };
  });
}

// ---------------------------------------------------------------------------------------
// Heart rate of a day

export interface HeartTrend {
  /** Mean of the last 7 days with a value, and of the 7 days a period earlier. */
  recent: number | null;
  before: number | null;
  change: number | null;
}

/** Resting heart rate of the last week against the same week `period` days earlier. */
export function restingTrend(days: Day[], end: string, period: number): HeartTrend {
  const byDay = indexByDay(days);
  const week = (last: string) => average(dateRange(addDays(last, -6), last).map((date) => dayValue(byDay.get(date), "restingHr")));
  const recent = week(end);
  const before = week(addDays(end, -period));
  return { recent, before, change: recent === null || before === null ? null : recent - before };
}
