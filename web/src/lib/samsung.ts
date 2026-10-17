// What the pages say about the Samsung Health entries: which days still miss one, owi's
// figure next to each field, how far owi is from Samsung (calibration quality), the
// "doladené podľa…" note and the "učí sa" state of the two Samsung-style scores.
// Pure functions; texts are Slovak.

import { addDays } from "./dates";
import { hasEntry } from "./entries";
import { approx, DASH, formatDecimal, formatInt, plural } from "./format";
import { scoreValue } from "./scores";
import type { Calibration, Dataset, Day, Entry, EntryField, Quality, QualityTarget, Score } from "./types";

/** Completed days the list on /zapis and the overview link look back on. */
export const ENTRY_WINDOW_DAYS = 30;

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function newestFirst(days: Day[]): Day[] {
  return [...days].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

function inWindow(day: Day, today: string, length: number): boolean {
  return day.complete && day.day >= addDays(today, -length) && day.day < today;
}

/** Completed days of the last `length` before `today` that have data but no entry, newest first. */
export function missingEntryDays(days: Day[], today: string, length: number = ENTRY_WINDOW_DAYS): string[] {
  return newestFirst(days)
    .filter((day) => inWindow(day, today, length) && !hasEntry(day.samsung))
    .map((day) => day.day);
}

/** Completed days of the last `length` before `today` that already have an entry, newest first. */
export function savedEntryDays(days: Day[], today: string, length: number = ENTRY_WINDOW_DAYS): string[] {
  return newestFirst(days)
    .filter((day) => inWindow(day, today, length) && hasEntry(day.samsung))
    .map((day) => day.day);
}

/** "1 deň", "3 dni", "12 dní" bez zápisu. */
export function missingDaysText(count: number): string {
  return `${formatInt(count)} ${plural(count, "deň", "dni", "dní")} bez zápisu`;
}

/**
 * The dataset with `entry` set on its day, as owi will serve it after the save. An entry
 * without numbers (a deletion) removes the day's entry. Days owi has no data for stay absent.
 */
export function withEntry(dataset: Dataset, entry: Entry): Dataset {
  const index = dataset.days.findIndex((day) => day.day === entry.day);
  if (index < 0) return dataset;
  const days = [...dataset.days];
  days[index] = { ...days[index], samsung: hasEntry(entry) ? entry : null };
  return { ...dataset, days };
}

// ---------------------------------------------------------------------------------------
// owi's figure next to each field

/** owi's own number for a field of the day, in the field's unit; null when it has none. */
export function owiFigure(day: Day | null | undefined, field: EntryField): number | null {
  if (!day) return null;
  switch (field) {
    case "steps":
      return isNumber(day.steps) ? day.steps : null;
    case "distance_km":
      return isNumber(day.distance_m_est) ? day.distance_m_est / 1000 : null;
    case "active_minutes":
      return isNumber(day.active_minutes_est) ? day.active_minutes_est : null;
    case "active_kcal":
      return isNumber(day.activity_kcal_est) ? day.activity_kcal_est : null;
    case "total_kcal":
      return isNumber(day.total_kcal_est) ? day.total_kcal_est : null;
    case "sleep_score":
      return scoreValue(day.scores?.samsung_sleep);
    case "energy_score":
      return scoreValue(day.scores?.energy_score);
  }
}

/** A value of a field for display: "23 588", "17,90 km", "210 min", "980 kcal", "82". */
export function formatFieldValue(field: EntryField, value: number | null | undefined): string {
  if (!isNumber(value)) return DASH;
  switch (field) {
    case "distance_km":
      return `${formatDecimal(value, 2)} km`;
    case "active_minutes":
      return `${formatInt(value)} min`;
    case "active_kcal":
    case "total_kcal":
      return `${formatInt(value)} kcal`;
    default:
      return formatInt(value);
  }
}

/** owi's figure as shown beside a field; everything but the steps is an estimate. */
export function owiFigureText(day: Day | null | undefined, field: EntryField): string {
  const text = formatFieldValue(field, owiFigure(day, field));
  return field === "steps" ? text : approx(text);
}

/** owi against Samsung: percent for the estimates, points for the scores; null without both. */
export function difference(field: EntryField, owi: number | null, samsung: number | null): string | null {
  if (!isNumber(owi) || !isNumber(samsung)) return null;
  if (field === "sleep_score" || field === "energy_score") {
    const points = Math.round(owi - samsung);
    return points === 0 ? "rovnako" : `${points > 0 ? "+" : "−"}${formatInt(Math.abs(points))} b.`;
  }
  if (samsung === 0) return null;
  const percent = Math.round(((owi - samsung) / samsung) * 100);
  return percent === 0 ? "rovnako" : `${percent > 0 ? "+" : "−"}${formatInt(Math.abs(percent))} %`;
}

// ---------------------------------------------------------------------------------------
// Calibration quality

export const QUALITY_TARGETS: readonly { key: QualityTarget; label: string }[] = [
  { key: "distance_km", label: "Vzdialenosť" },
  { key: "active_minutes", label: "Aktívny čas" },
  { key: "active_kcal", label: "Kalórie z aktivity" },
  { key: "total_kcal", label: "Kalórie spolu" },
  { key: "sleep_score", label: "Sleep Score" },
  { key: "energy_score", label: "Energy Score" },
];

const NBSP = " ";

/** "± 4,1 %" for estimates, "± 5,5 bodu" for scores; no-break spaces, so it never splits. */
export function formatError(error: number | null | undefined, unit: Quality["unit"]): string {
  if (!isNumber(error)) return DASH;
  return `±${NBSP}${formatDecimal(Math.abs(error), 1)}${NBSP}${unit === "body" ? "bodu" : "%"}`;
}

export interface QualityRow {
  key: QualityTarget;
  label: string;
  error: string;
  /** Days with an entry the error was measured on: "na 3 dňoch". */
  basis: string;
  /** The previous parameters were further off on the same days. */
  improved: boolean;
  previous: string | null;
}

export function qualityRows(calibration: Calibration | null | undefined): QualityRow[] {
  const quality = calibration?.quality ?? {};
  return QUALITY_TARGETS.flatMap(({ key, label }) => {
    const item = quality[key];
    if (!item || !isNumber(item.error)) return [];
    const previous = isNumber(item.previous_error) ? item.previous_error : null;
    return [
      {
        key,
        label,
        error: formatError(item.error, item.unit),
        basis: `na ${formatInt(item.n)} ${item.n === 1 ? "dni" : "dňoch"}`,
        improved: previous !== null && item.error < previous,
        previous: previous === null ? null : formatError(previous, item.unit),
      },
    ];
  });
}

/**
 * The note under owi's estimates once entries exist: "doladené podľa 12 zápisov · odchýlka
 * ± 4,1 %", or with several estimates "… · odchýlka: aktívny čas ± 12,0 %, spolu ± 3,0 %".
 * Null before the first entry.
 */
export function calibrationNote(
  calibration: Calibration | null | undefined,
  targets: readonly { key: QualityTarget; label?: string }[],
): string | null {
  const entries = calibration?.entries ?? 0;
  if (!calibration || !isNumber(entries) || entries <= 0) return null;
  const head = `doladené podľa ${formatInt(entries)} ${plural(entries, "zápisu", "zápisov", "zápisov")}`;
  const parts = targets.flatMap(({ key, label }) => {
    const item = calibration.quality?.[key];
    if (!item || !isNumber(item.error)) return [];
    const error = formatError(item.error, item.unit);
    return [targets.length > 1 && label ? `${label} ${error}` : error];
  });
  if (parts.length === 0) return head;
  return targets.length > 1 ? `${head} · odchýlka: ${parts.join(", ")}` : `${head} · odchýlka ${parts[0]}`;
}

// ---------------------------------------------------------------------------------------
// The two Samsung-style scores while they learn

const LEARNING_NOTE = "learning";
const NEEDED_DEFAULT = 10;

export function isLearning(score: Score | null | undefined): boolean {
  return Boolean(score?.note && score.note.split(/;\s*/).includes(LEARNING_NOTE));
}

/** Entries still missing before the score shows; null when it is not learning. */
export function learningGap(score: Score | null | undefined): number | null {
  if (!isLearning(score)) return null;
  const entries = score?.components?.entries;
  const needed = score?.components?.needed;
  const have = isNumber(entries) ? entries : 0;
  const need = isNumber(needed) ? needed : NEEDED_DEFAULT;
  return Math.max(0, Math.ceil(need - have));
}

/** "učí sa, chýba ešte 4 zápisy"; null when the score is not learning. */
export function learningText(score: Score | null | undefined): string | null {
  const gap = learningGap(score);
  if (gap === null) return null;
  if (gap === 0) return "učí sa";
  if (gap === 1) return "učí sa, chýba ešte 1 zápis";
  if (gap <= 4) return `učí sa, chýbajú ešte ${gap} zápisy`;
  return `učí sa, chýba ešte ${formatInt(gap)} zápisov`;
}

/** The parts of a Samsung-style score, without the learning counters. */
export function scoreParts(score: Score | null | undefined): Score | null {
  if (!score) return null;
  if (isLearning(score)) return { ...score, components: {} };
  return score;
}
