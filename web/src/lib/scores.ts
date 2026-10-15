// What the pages say about owi's scores: bands, labels, one-line reasons, the morning and
// evening mode and the night-signal warning. Pure functions; texts are Slovak.
// Scales and bands follow docs/skore.md. Main cards use plain score names only; the vendor
// (WHOOP, Oura, Apple, Polar) is named in detail views, see SCORE_SOURCES.

import { addDays, localMinutesOfDay, todayIn, weekdayIndex } from "./dates";
import {
  approx,
  DASH,
  formatDecimal,
  formatDuration,
  formatInt,
  formatTimeOfDay,
  workoutLabel,
} from "./format";
import type { CardioLoadStatus, Day, DayScores, NightSignal, Score } from "./types";

// ---------------------------------------------------------------------------------------
// Names

export const SCORE_NAMES = {
  day: "Skóre dňa",
  readiness: "Readiness",
  sleepPerformance: "Sleep Performance",
  appleSleep: "Sleep Score",
  activity: "Activity",
  strain: "Strain",
  sleepNeed: "Potreba spánku",
  cardioLoad: "Stav záťaže",
  nightSignal: "Nočný tep",
  whoopAge: "Vek tela",
} as const;

/** Where each score comes from; shown in detail views only, never on the main cards. */
export const SCORE_SOURCES = {
  readiness: "Oura Readiness bez HRV a teploty",
  sleepPerformance: "WHOOP Sleep Performance",
  appleSleep: "Apple Sleep Score",
  activity: "Oura Activity",
  strain: "WHOOP Strain",
  sleepNeed: "WHOOP potreba spánku",
  cardioLoad: "Polar Cardio Load",
  nightSignal: "NightSignal (Alavi 2022)",
  whoopAge: "WHOOP Age",
} as const;

/** Slovak names of score components, keyed like owi's `Score.components`. */
export const COMPONENT_LABELS: Readonly<Record<string, string>> = {
  // Readiness
  sleep: "spánok",
  resting_hr: "pokojový tep",
  activity_balance: "vyváženosť aktivity",
  sleep_balance: "spánková bilancia",
  previous_day_activity: "včerajšia aktivita",
  recovery_index: "zotavenie v noci",
  sleep_regularity: "pravidelnosť spánku",
  // Sleep Performance
  hours_vs_needed: "spánok oproti potrebe",
  consistency: "pravidelnosť",
  efficiency: "efektivita spánku",
  // Apple Sleep Score
  duration: "dĺžka",
  bedtime: "čas zaspatia",
  interruptions: "prerušenia",
  // Activity
  meet_daily_targets: "denné ciele",
  stay_active: "menej sedenia",
  training_volume: "objem tréningu",
  training_frequency: "frekvencia tréningov",
  move_every_hour: "pohyb každú hodinu",
  recovery_time: "čas na oddych",
  // WHOOP Age
  sleep_duration: "dĺžka spánku",
  sleep_consistency: "pravidelnosť spánku",
  steps: "kroky",
  zone_1_3: "zóny 1–3",
  zone_4_5: "zóny 4–5",
  strength: "silový tréning",
  vo2max: "VO2max",
  lean_mass: "svalová hmota",
};

export function componentLabel(key: string): string {
  return Object.hasOwn(COMPONENT_LABELS, key) ? COMPONENT_LABELS[key] : key.replace(/_+/g, " ");
}

const NOTE_TEXTS: Readonly<Record<string, string>> = {
  estimate: "odhad",
  "too little history": "zatiaľ málo dát",
  "no data": "bez dát",
  "no sleep recorded": "spánok sa nezaznamenal",
  "no sleep need from the day before": "chýba potreba spánku z predošlého dňa",
  "age missing": "chýba vek",
  "no sleep stages, no stage deductions": "bez fáz spánku",
};

/** owi's English score notes in Slovak; unknown notes pass through unchanged. */
export function noteText(note: string | null | undefined): string | null {
  if (!note) return null;
  return note
    .split(/;\s*/)
    .map((part) => {
      const without = /^without (.+)$/.exec(part);
      if (without) return `bez: ${without[1].split(/,\s*/).map(componentLabel).join(", ")}`;
      return Object.hasOwn(NOTE_TEXTS, part) ? NOTE_TEXTS[part] : part;
    })
    .join("; ");
}

// ---------------------------------------------------------------------------------------
// Values

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function scoreValue(score: Score | null | undefined): number | null {
  return score && isNumber(score.value) ? score.value : null;
}

export function isEstimate(score: Score | null | undefined): boolean {
  return Boolean(score?.note && score.note.split(/;\s*/).includes("estimate"));
}

/** A 0-100 score as a whole number; estimates carry the ≈ marker. */
export function formatScore(score: Score | null | undefined): string {
  const value = scoreValue(score);
  if (value === null) return DASH;
  const text = formatInt(value);
  return isEstimate(score) ? approx(text) : text;
}

/** Strain keeps one decimal, as WHOOP shows it: "13,4". */
export function formatStrain(strain: number | null | undefined): string {
  return isNumber(strain) ? formatDecimal(strain, 1) : DASH;
}

// ---------------------------------------------------------------------------------------
// Bands

export type Tone = "top" | "good" | "fair" | "low";

export interface Band {
  key: string;
  label: string;
  tone: Tone;
}

function pick(value: number | null | undefined, bands: [number, Band][], last: Band): Band | null {
  if (!isNumber(value)) return null;
  for (const [from, band] of bands) if (value >= from) return band;
  return last;
}

/** WHOOP strain bands: 0-9.9 light, 10-13.9 moderate, 14-17.9 high, 18-21 all out. */
export function strainBand(strain: number | null | undefined): Band | null {
  return pick(
    strain,
    [
      [18, { key: "max", label: "maximálna záťaž", tone: "low" }],
      [14, { key: "high", label: "vysoká záťaž", tone: "fair" }],
      [10, { key: "moderate", label: "stredná záťaž", tone: "good" }],
    ],
    { key: "light", label: "ľahká záťaž", tone: "top" },
  );
}

/** Oura readiness bands: 85+ optimal, 70-84 good, 60-69 fair, below 60 pay attention. */
export function readinessBand(value: number | null | undefined): Band | null {
  return pick(
    value,
    [
      [85, { key: "optimal", label: "optimálna", tone: "top" }],
      [70, { key: "good", label: "dobrá", tone: "good" }],
      [60, { key: "fair", label: "slabšia", tone: "fair" }],
    ],
    { key: "low", label: "nízka", tone: "low" },
  );
}

/** WHOOP Sleep Performance bands: 85+ optimal, 70-84 sufficient, below 70 poor. */
export function sleepPerformanceBand(value: number | null | undefined): Band | null {
  return pick(
    value,
    [
      [85, { key: "optimal", label: "optimálny", tone: "top" }],
      [70, { key: "sufficient", label: "dostačujúci", tone: "good" }],
    ],
    { key: "poor", label: "slabý", tone: "low" },
  );
}

/** Apple Sleep Score bands: 0-40, 41-60, 61-80, 81-95, 96+. */
export function appleSleepBand(value: number | null | undefined): Band | null {
  if (!isNumber(value)) return null;
  const rounded = Math.round(value);
  return pick(
    rounded,
    [
      [96, { key: "very_high", label: "veľmi vysoké", tone: "top" }],
      [81, { key: "high", label: "vysoké", tone: "top" }],
      [61, { key: "ok", label: "v poriadku", tone: "good" }],
      [41, { key: "low", label: "nízke", tone: "fair" }],
    ],
    { key: "very_low", label: "veľmi nízke", tone: "low" },
  );
}

/** Oura activity bands: 85+ optimal, 70-84 good, below 70 pay attention. */
export function activityBand(value: number | null | undefined): Band | null {
  return pick(
    value,
    [
      [85, { key: "optimal", label: "optimálna", tone: "top" }],
      [70, { key: "good", label: "dobrá", tone: "good" }],
    ],
    { key: "low", label: "nízka", tone: "low" },
  );
}

/** Words under the day score ring. */
export function dayScoreLabel(value: number | null | undefined): string {
  if (!isNumber(value)) return "skóre zatiaľ nie je";
  if (value >= 85) return "výborný deň";
  if (value >= 70) return "dobrý deň";
  if (value >= 60) return "priemerný deň";
  return "slabší deň";
}

const CARDIO_LABELS: Record<CardioLoadStatus, string> = {
  detraining: "pokles formy",
  recovering: "zotavovanie",
  maintaining: "udržiavanie",
  productive: "produktívna záťaž",
  overreaching: "preťaženie",
};

export function cardioStatusLabel(status: CardioLoadStatus | null | undefined): string {
  return status && Object.hasOwn(CARDIO_LABELS, status) ? CARDIO_LABELS[status] : DASH;
}

// ---------------------------------------------------------------------------------------
// Morning and evening

export type DayMode = "morning" | "evening";

/** Local time from which the overview switches to the evening layout. */
export const EVENING_FROM_MINUTES = 15 * 60;
/** Until this local time the evening of the day before is still running. */
export const NIGHT_UNTIL_MINUTES = 4 * 60;

/**
 * Which layout fits the local time, and which day it is about.
 *   04:00-14:59 morning, about today (last night, readiness, the day ahead)
 *   15:00-23:59 evening, about today (strain so far, sleep need for tonight)
 *   00:00-03:59 still the evening of yesterday: the night it plans for has not started
 * `override` ("rano" or "vecer", from the ?rezim= query) forces the layout; the day then
 * stays the natural one when the layouts agree and is today otherwise.
 */
export function resolveMode(
  now: Date,
  timeZone: string,
  override?: string | null,
): { mode: DayMode; day: string } {
  const today = todayIn(timeZone, now);
  const minutes = localMinutesOfDay(now.toISOString(), timeZone);
  const natural: { mode: DayMode; day: string } =
    minutes < NIGHT_UNTIL_MINUTES
      ? { mode: "evening", day: addDays(today, -1) }
      : minutes < EVENING_FROM_MINUTES
        ? { mode: "morning", day: today }
        : { mode: "evening", day: today };
  const forced = override === "rano" ? "morning" : override === "vecer" ? "evening" : null;
  if (!forced || forced === natural.mode) return natural;
  return { mode: forced, day: today };
}

// ---------------------------------------------------------------------------------------
// Night signal

export interface NightAlert {
  level: "yellow" | "red";
  title: string;
  text: string;
}

/** Plain wording for a yellow or red night signal; null when there is nothing to say. */
export function nightSignalAlert(signal: NightSignal | null | undefined): NightAlert | null {
  if (!signal || (signal.level !== "yellow" && signal.level !== "red")) return null;
  const over = isNumber(signal.delta) ? `o ${formatInt(Math.max(1, signal.delta))} bpm` : "citeľne";
  const usual = isNumber(signal.baseline) ? ` (bežne okolo ${formatInt(signal.baseline)} bpm)` : "";
  if (signal.level === "red") {
    return {
      level: "red",
      title: "Nočný tep je zvýšený už druhú noc po sebe",
      text:
        `Tep počas noci bol ${over} vyšší než zvyčajne${usual}. Takýto vzorec sa často objavuje ` +
        "pri začínajúcej chorobe, strese alebo preťažení. Zváž oddych a ľahší deň; ak sa necítiš " +
        "dobre, poraď sa s lekárom. Je to pozorovanie z dát, nie diagnóza.",
    };
  }
  return {
    level: "yellow",
    title: "Nočný tep bol vyšší než zvyčajne",
    text:
      `Minulú noc bol tep ${over} nad tvojím normálom${usual}. Býva to po náročnom dni, ` +
      "pri strese, nedostatku spánku alebo na začiatku choroby. Sleduj, ako sa cítiš.",
  };
}

// ---------------------------------------------------------------------------------------
// One-line reasons under the three sub-scores

export interface SubScore {
  key: "readiness" | "sleepPerformance" | "activity";
  label: string;
  value: number | null;
  display: string;
  band: Band | null;
  reason: string;
}

/** The lowest and highest component that exists. */
export function componentExtremes(
  score: Score | null | undefined,
): { weakest: [string, number] | null; strongest: [string, number] | null } {
  const entries = Object.entries(score?.components ?? {}).filter(
    (entry): entry is [string, number] => isNumber(entry[1]),
  );
  if (entries.length === 0) return { weakest: null, strongest: null };
  const sorted = [...entries].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  return { weakest: sorted[0], strongest: sorted[sorted.length - 1] };
}

function missingReason(score: Score | null | undefined): string {
  return noteText(score?.note) ?? "zatiaľ sa nedá spočítať";
}

function readinessReason(day: Day, score: Score | null | undefined): string {
  if (scoreValue(score) === null) return missingReason(score);
  const parts: string[] = [];
  const restingComponent = score?.components?.resting_hr;
  if (isNumber(day.hr_resting) && isNumber(restingComponent)) {
    // 87.5 at the person's mean, 100 a standard deviation below it, 57.5 one above.
    const where =
      restingComponent >= 95
        ? "pod tvojím priemerom"
        : restingComponent >= 75
          ? "blízko tvojho priemeru"
          : "nad tvojím priemerom";
    parts.push(`pokojový tep ${formatInt(day.hr_resting)}, ${where}`);
  }
  const { weakest, strongest } = componentExtremes(score);
  if (weakest && weakest[1] < 60 && weakest[0] !== "resting_hr") {
    parts.push(`brzdí ${componentLabel(weakest[0])}`);
  } else if (parts.length === 0 && strongest) {
    parts.push(`najviac pomáha ${componentLabel(strongest[0])}`);
  }
  return parts.join(" · ") || "z nočného tepu a spánku";
}

function sleepReason(day: Day, score: Score | null | undefined, needMinutes: number | null): string {
  if (!isNumber(day.sleep_minutes)) return missingReason(score);
  const slept = formatDuration(day.sleep_minutes);
  if (isNumber(needMinutes) && needMinutes > 0) {
    return day.sleep_minutes >= needMinutes
      ? `${slept}, potreba spánku pokrytá`
      : `${slept} z potrebných ${formatDuration(needMinutes)}`;
  }
  if (scoreValue(score) === null) return `${slept} · ${missingReason(score)}`;
  return slept;
}

function activityReason(day: Day, score: Score | null | undefined): string {
  if (scoreValue(score) === null) return missingReason(score);
  const parts: string[] = [];
  if (isNumber(day.steps)) parts.push(`${formatInt(day.steps)} krokov`);
  const workout = day.workouts[day.workouts.length - 1];
  if (workout) {
    parts.push(`${workoutLabel(workout.type).toLowerCase()} ${formatDuration(workout.duration_s / 60)}`);
  } else {
    const { weakest } = componentExtremes(score);
    if (weakest && weakest[1] < 60) parts.push(`slabšie: ${componentLabel(weakest[0])}`);
  }
  return parts.join(" · ") || "z krokov, tepu a tréningov";
}

/**
 * Readiness, Sleep Performance and Activity of `day`, each with its one-line reason.
 * `previous` is the day before; its sleep need is what last night is measured against.
 */
export function subScores(day: Day, previous: Day | null): SubScore[] {
  const scores = day.scores ?? null;
  const readiness = scores?.readiness ?? null;
  const sleep = scores?.sleep_performance ?? null;
  const activity = scores?.activity ?? null;
  const need = previous?.scores?.sleep_need_minutes ?? null;
  return [
    {
      key: "readiness",
      label: SCORE_NAMES.readiness,
      value: scoreValue(readiness),
      display: formatScore(readiness),
      band: readinessBand(scoreValue(readiness)),
      reason: readinessReason(day, readiness),
    },
    {
      key: "sleepPerformance",
      label: SCORE_NAMES.sleepPerformance,
      value: scoreValue(sleep),
      display: formatScore(sleep),
      band: sleepPerformanceBand(scoreValue(sleep)),
      reason: sleepReason(day, sleep, need),
    },
    {
      key: "activity",
      label: SCORE_NAMES.activity,
      value: scoreValue(activity),
      display: formatScore(activity),
      band: activityBand(scoreValue(activity)),
      reason: activityReason(day, activity),
    },
  ];
}

// ---------------------------------------------------------------------------------------
// Evening: when to go to bed

const LATENCY_MINUTES = 15;

/**
 * Median wake-up time, in minutes since local midnight, over the last `nights` nights
 * before `forDay` that fall on the same kind of day (school day or weekend) as `forDay`.
 */
export function typicalWake(
  days: Day[],
  timeZone: string,
  forDay: string,
  nights: number = 28,
): number | null {
  const weekend = weekdayIndex(forDay) >= 5;
  const from = addDays(forDay, -nights);
  const wakes = days
    .filter((day) => day.day >= from && day.day < forDay && day.sleep_end)
    .filter((day) => weekdayIndex(day.day) >= 5 === weekend)
    .map((day) => localMinutesOfDay(day.sleep_end as string, timeZone))
    .sort((a, b) => a - b);
  if (wakes.length === 0) return null;
  const middle = Math.floor(wakes.length / 2);
  return wakes.length % 2 ? wakes[middle] : Math.round((wakes[middle - 1] + wakes[middle]) / 2);
}

/** Time to fall asleep, minutes since midnight, to sleep `needMinutes` before `wakeMinutes`. */
export function bedtimeFor(needMinutes: number | null, wakeMinutes: number | null): number | null {
  if (!isNumber(needMinutes) || !isNumber(wakeMinutes)) return null;
  const minutes = Math.round(wakeMinutes - needMinutes - LATENCY_MINUTES);
  // Round to five minutes so it reads as advice, not a measurement.
  return ((Math.round(minutes / 5) * 5) % 1440 + 1440) % 1440;
}

// ---------------------------------------------------------------------------------------
// Headline sentences

/** The morning sentence above "čo si všimnúť". Observations, not medical advice. */
export function morningSummary(scores: DayScores | null | undefined): string {
  if (!scores) return "Skóre za dnešok ešte nie je spočítané. Nižšie je, čo ukazujú posledné dni.";
  if (scores.night_signal?.level === "red") {
    return "Nočný tep je zvýšený, telo môže potrebovať oddych. Dnes radšej ľahší deň.";
  }
  const readiness = scoreValue(scores.readiness);
  const sleep = scoreValue(scores.sleep_performance);
  if (readiness === null && sleep === null) {
    return "Na skóre za túto noc zatiaľ chýbajú dáta. Nižšie je, čo ukazujú posledné dni.";
  }
  if (sleep !== null && sleep < 70) {
    return "Spal si menej, než telo potrebovalo. Dnes pomôže ubrať zo záťaže a ísť spať skôr.";
  }
  if (readiness !== null && readiness < 70) {
    return "Telo sa ešte zotavuje. Ľahší deň mu pomôže.";
  }
  if ((readiness ?? 0) >= 85 && (sleep ?? 0) >= 85) {
    return "Dobrá noc za tebou a telo je oddýchnuté. Dnes máš priestor aj na dlhší pohyb.";
  }
  return "Noc bola v poriadku a pripravenosť je dobrá. Bežný deň by mal sedieť.";
}

/** The evening sentence: the day's strain and what tonight's sleep should cover. */
export function eveningSummary(scores: DayScores | null | undefined, bedtime: number | null): string {
  if (!scores) return "Skóre za dnešok ešte nie je spočítané. Nižšie je, čo ukazujú posledné dni.";
  const parts: string[] = [];
  const band = strainBand(scores.strain);
  if (band) parts.push(`Dnešný strain je ${formatStrain(scores.strain)}, ${band.label}.`);
  if (isNumber(scores.sleep_need_minutes)) {
    const when = bedtime === null ? "" : `, takže je dobré zaspať okolo ${formatTimeOfDay(bedtime)}`;
    parts.push(`Na dnešnú noc potrebuješ asi ${formatDuration(scores.sleep_need_minutes)} spánku${when}.`);
  }
  return parts.join(" ") || "Na večerné skóre zatiaľ chýbajú dáta.";
}
