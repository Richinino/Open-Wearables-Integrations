// Invented scores and sleep stage timelines for the demo data. Nothing here is measured on
// a person, and the formulas are only shaped like owi's (docs/skore.md) so that the numbers
// look plausible together: strain grows with time in the heart-rate zones, sleep need grows
// with strain, a short night lowers Sleep Performance and Readiness, and so on.
//
// Every function is deterministic. Scores of a day depend only on that day and on the
// finished days before it, never on which days the demo window happens to contain.

import { addDays, diffDays, weekdayIndex } from "./dates";
import type { CardioLoadStatus, Day, DayScores, NightSignal, Score, SleepInterval, Workout } from "./types";

type Random = () => number;

const MINUTE_MS = 60_000;
const AGE = 17;

/** One run of elevated nights in every this many days: yellow, then two reds in a row. */
export const ELEVATED_PERIOD = 120;
const ELEVATED_START = 37;
const ELEVATED_DELTAS = [4.2, 5.1, 4.6];
/** About one ordinary night in this many is yellow. */
const YELLOW_PERIOD = 17;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
// Adding zero folds -0 into 0, which JSON cannot carry.
const round1 = (value: number) => Math.round(value * 10) / 10 + 0;
const round2 = (value: number) => Math.round(value * 100) / 100 + 0;
const between = (random: Random, low: number, high: number) => low + random() * (high - low);

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values: (number | null | undefined)[]): number | null {
  const present = values.filter(isNumber);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length;
}

function sd(values: (number | null | undefined)[]): number | null {
  const present = values.filter(isNumber);
  const average = mean(present);
  if (average === null || present.length < 2) return null;
  return Math.sqrt(present.reduce((sum, value) => sum + (value - average) ** 2, 0) / present.length);
}

function epochDay(day: string): number {
  return diffDays("1970-01-01", day);
}

function isoUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

// ---------------------------------------------------------------------------------------
// Night heart rate

/** Extra night heart rate in bpm when `day` belongs to the run of elevated nights, else 0. */
export function nightElevation(day: string): number {
  const position = (((epochDay(day) - ELEVATED_START) % ELEVATED_PERIOD) + ELEVATED_PERIOD) % ELEVATED_PERIOD;
  return position < ELEVATED_DELTAS.length ? ELEVATED_DELTAS[position] : 0;
}

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Night heart rate minus the person's usual, before any sickness: small noise or a yellow night. */
function ordinaryDelta(day: string): number {
  const hash = hashText(`owi-demo-night:${day}`);
  const unit = (hash % 10_000) / 10_000;
  // Nights next to the elevated run stay quiet, so the run reads as one event.
  const nearRun = [-1, 1, 2, 3].some((shift) => nightElevation(addDays(day, shift)) > 0);
  if (!nearRun && hash % YELLOW_PERIOD === 3) return round1(3 + unit * 0.8);
  return round1((unit - 0.5) * 3.6);
}

function nightDelta(day: string): number {
  const elevated = nightElevation(day);
  return elevated > 0 ? elevated : ordinaryDelta(day);
}

// ---------------------------------------------------------------------------------------
// Load

const ZONE_WEIGHTS = { light: 0.4, moderate: 2, vigorous: 8 };
/** Load without heart rate for muscle work, per minute. */
const MUSCLE_PER_MINUTE: Record<string, number> = { strength_training: 0.6, generic: 0.3 };
const STRAIN_A = 4.05;
const STRAIN_L0 = 9;

function strainOf(load: number): number {
  return Math.min(21, STRAIN_A * Math.log(1 + load / STRAIN_L0));
}

function muscleLoad(workout: Workout): number {
  return (MUSCLE_PER_MINUTE[workout.type] ?? 0) * (workout.duration_s / 60);
}

/** WHOOP-shaped strain of one workout, 0-21; null without heart rate. */
export function workoutStrain(workout: Workout): number | null {
  if (workout.hr_avg === null) return null;
  const load =
    workout.zone_light_min * ZONE_WEIGHTS.light +
    workout.zone_moderate_min * ZONE_WEIGHTS.moderate +
    workout.zone_vigorous_min * ZONE_WEIGHTS.vigorous +
    muscleLoad(workout);
  return round1(strainOf(load));
}

/** Strain of a day, 4-19 for a finished day; an unfinished day has only what happened so far. */
export function dayStrain(day: Day): number | null {
  if (day.zone_light_min === null || day.zone_moderate_min === null || day.zone_vigorous_min === null) {
    return null;
  }
  const load =
    day.zone_light_min * ZONE_WEIGHTS.light +
    day.zone_moderate_min * ZONE_WEIGHTS.moderate +
    day.zone_vigorous_min * ZONE_WEIGHTS.vigorous +
    day.workouts.reduce((sum, workout) => sum + muscleLoad(workout), 0);
  const strain = strainOf(load);
  return round1(day.complete ? clamp(strain, 4, 19) : Math.min(strain, 19));
}

/** Banister-like daily TRIMP from the zone minutes. */
function dailyTrimp(day: Day): number | null {
  if (day.zone_light_min === null || day.zone_moderate_min === null || day.zone_vigorous_min === null) {
    return null;
  }
  return day.zone_light_min * 0.9 + day.zone_moderate_min * 1.7 + day.zone_vigorous_min * 2.8;
}

function cardioStatus(ratio: number): CardioLoadStatus {
  if (ratio < 0.8) return "detraining";
  if (ratio < 1.0) return "maintaining";
  if (ratio <= 1.3) return "productive";
  return "overreaching";
}

// ---------------------------------------------------------------------------------------
// Sleep

const NEED_BASE = 495; // 8 h 15 min, inside the 8-10 h teenagers need

/** Sleep need for the night after `day`, 480-600 min. */
export function sleepNeed(day: Day): number {
  const strain = dayStrain(day);
  const bonus = strain === null ? 0 : (60 * 1.7) / (1 + Math.exp((17 - strain) / 3.5));
  const debt = day.sleep_minutes === null ? 20 : Math.min(60, 0.5 * Math.max(0, 480 - day.sleep_minutes));
  const nap = day.nap_minutes ?? 0;
  return clamp(Math.round(NEED_BASE + bonus + debt - nap * 0.5), 480, 600);
}

function inBedMinutes(day: Day): number | null {
  if (day.sleep_minutes === null || day.sleep_awake_min === null) return null;
  return day.sleep_minutes + day.sleep_awake_min;
}

/** Integer parts of `total` in proportion to `weights`, summing exactly to `total`. */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  const raw = weights.map((weight) => (sum > 0 ? (total * weight) / sum : 0));
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((acc, part) => acc + part, 0);
  const order = raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts;
}

/**
 * Stage timeline of the main sleep: about 90-minute cycles of light, deep, light and REM,
 * deep sleep early in the night, REM late, and a few awake stretches between cycles.
 * Minutes per stage match the day's totals exactly; the intervals cover the whole night.
 */
export function demoTimeline(day: Day, random: Random): SleepInterval[] | null {
  if (!day.sleep_start || !day.sleep_end) return null;
  const deep = day.sleep_deep_min ?? 0;
  const rem = day.sleep_rem_min ?? 0;
  const light = day.sleep_light_min ?? 0;
  const awake = day.sleep_awake_min ?? 0;
  const inBed = deep + rem + light + awake;
  const cycles = clamp(Math.round(inBed / 95), 3, 6);

  const deepParts = apportion(deep, [5, 4, 2.5, 1.2, 0.6, 0.3].slice(0, cycles));
  const remParts = apportion(rem, [1, 1.6, 2.2, 2.8, 3.2, 3.5].slice(0, cycles));
  const lightParts = apportion(
    light,
    Array.from({ length: cycles }, () => 0.8 + random() * 0.4),
  );
  const bouts = Math.min(cycles, 1 + (awake > 20 ? 1 : 0) + (awake > 35 ? 1 : 0));
  const awakeParts = apportion(awake, Array.from({ length: bouts }, () => 0.6 + random()));
  // Awake stretches close a cycle; the last cycle often ends with one (waking up).
  const boutCycles = new Set<number>([cycles - 1]);
  while (boutCycles.size < bouts) boutCycles.add(Math.floor(random() * (cycles - 1)));
  const boutOrder = [...boutCycles].sort((a, b) => a - b);

  const plan: [SleepInterval["stage"], number][] = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    const firstLight = Math.floor(lightParts[cycle] * 0.55);
    plan.push(["light", firstLight], ["deep", deepParts[cycle]], ["light", lightParts[cycle] - firstLight], ["rem", remParts[cycle]]);
    const bout = boutOrder.indexOf(cycle);
    if (bout >= 0) plan.push(["awake", awakeParts[bout]]);
  }

  const intervals: SleepInterval[] = [];
  let cursor = Date.parse(day.sleep_start);
  for (const [stage, minutes] of plan) {
    if (minutes <= 0) continue;
    const end = cursor + minutes * MINUTE_MS;
    const previous = intervals[intervals.length - 1];
    if (previous?.stage === stage) previous.end = isoUtc(end);
    else intervals.push({ start: isoUtc(cursor), end: isoUtc(end), stage });
    cursor = end;
  }
  return intervals;
}

// ---------------------------------------------------------------------------------------
// Scores

function score(components: Record<string, number | null>, weights: Record<string, number>, note: string | null): Score {
  const available = Object.entries(components).filter((entry): entry is [string, number] => isNumber(entry[1]));
  if (available.length === 0) return { value: null, components, note: "no data" };
  const total = available.reduce((sum, [key]) => sum + weights[key], 0);
  const value = available.reduce((sum, [key, item]) => sum + weights[key] * item, 0) / total;
  return { value: round1(value), components, note };
}

function rounded(components: Record<string, number | null>): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(components).map(([key, value]) => [key, value === null ? null : round1(clamp(value, 0, 100))]),
  );
}

const READINESS_WEIGHTS = {
  sleep: 0.25,
  resting_hr: 0.2,
  activity_balance: 0.15,
  sleep_balance: 0.11,
  previous_day_activity: 0.11,
  recovery_index: 0.1,
  sleep_regularity: 0.05,
};
const ACTIVITY_WEIGHTS = {
  meet_daily_targets: 0.25,
  stay_active: 0.2,
  training_volume: 0.15,
  training_frequency: 0.15,
  move_every_hour: 0.1,
  recovery_time: 0.15,
};
const PERFORMANCE_WEIGHTS = { hours_vs_needed: 0.7, consistency: 0.15, efficiency: 0.15 };

/**
 * Scores of `day` from the day itself and `history`: the finished days before it, oldest
 * first, the last one being the day before. Missing entries in `history` are allowed.
 */
export function demoScores(day: Day, history: Day[], random: Random): DayScores {
  const previous = history.find((item) => item.day === addDays(day.day, -1)) ?? null;
  const recent = (days: number) => history.filter((item) => item.day >= addDays(day.day, -days));
  const worn = day.hr_resting !== null;
  const epoch = epochDay(day.day);
  const weekend = weekdayIndex(day.day) >= 5;

  // Load
  const strain = dayStrain(day);
  const trimps = (days: number) => [...recent(days - 1).map(dailyTrimp), dailyTrimp(day)];
  const strain7 = mean(trimps(7));
  const tolerance28 = mean(trimps(28));
  const ratio = strain7 !== null && tolerance28 ? strain7 / tolerance28 : null;

  // Sleep
  const sleep = day.sleep_minutes;
  const inBed = inBedMinutes(day);
  const needBefore = previous ? sleepNeed(previous) : null;
  const lastFour = [day, ...history.filter((item) => item.day >= addDays(day.day, -3))];
  const consistency = lastFour.length === 4 && lastFour.every((item) => item.sleep_start)
    ? clamp(84 - (weekend ? 8 : 0) + between(random, -10, 10), 40, 98)
    : null;
  const performance: Score =
    sleep === null
      ? { value: null, components: { hours_vs_needed: null, consistency: null, efficiency: null }, note: "no sleep recorded" }
      : score(
          rounded({
            hours_vs_needed: needBefore === null ? null : 100 * Math.min(1, sleep / needBefore),
            consistency,
            efficiency: inBed ? (100 * sleep) / inBed : null,
          }),
          PERFORMANCE_WEIGHTS,
          consistency === null ? "without consistency" : null,
        );

  let apple: Score = { value: null, components: {}, note: "no sleep recorded" };
  if (sleep !== null) {
    const short = Math.max(0, 470 - sleep);
    const deepShare = (day.sleep_deep_min ?? 0) / sleep;
    const remShare = (day.sleep_rem_min ?? 0) / sleep;
    const duration = 50 - Math.min(50, 13 * (short / 120) ** 2.4) - (deepShare < 0.1 ? 5 : 0) - (remShare < 0.15 ? 5 : 0);
    const drift = Math.abs(between(random, -55, 55) + (weekend ? 30 : 0));
    const bedtime = 30 - (drift > 15 ? Math.min(30, (drift - 15) / 4.5) : 0);
    const awake = day.sleep_awake_min ?? 0;
    const wakeUps = 1 + Math.floor(awake / 12);
    const interruptions = 20 - Math.min(20, Math.max(0, awake - 11) / 4 + Math.max(0, wakeUps - 2) / 2);
    const components = { duration: round1(Math.max(0, duration)), bedtime: round1(bedtime), interruptions: round1(interruptions) };
    apple = { value: round1(components.duration + components.bedtime + components.interruptions), components, note: null };
  }

  const regularity = worn ? round1(clamp(80 + 8 * Math.sin(epoch / 11) + between(random, -4, 4), 55, 95)) : null;

  // Readiness
  const restingBaseline = mean(recent(28).map((item) => item.hr_resting));
  const restingSd = Math.max(2, sd(recent(28).map((item) => item.hr_resting)) ?? 2);
  const restingZ = day.hr_resting !== null && restingBaseline !== null ? (day.hr_resting - restingBaseline) / restingSd : null;
  const kcal7 = mean([...recent(6).map((item) => item.activity_kcal_est)]);
  const kcal28 = mean(recent(28).map((item) => item.activity_kcal_est));
  const kcalSd = Math.max(50, sd(recent(28).map((item) => item.activity_kcal_est)) ?? 50);
  const strains = recent(28).map(dayStrain);
  const strainMean = mean(strains);
  const strainSd = Math.max(1.5, sd(strains) ?? 1.5);
  const previousStrain = previous ? dayStrain(previous) : null;
  const sleepWeek = mean([...recent(13).map((item) => item.sleep_minutes), sleep]);
  const totalSleep = sleep === null ? null : sleep + (day.nap_minutes ?? 0);
  const elevated = nightDelta(day.day) >= 4;

  const readinessComponents = rounded({
    sleep: totalSleep === null ? null : 85 + 12.5 * ((100 * totalSleep) / 540 - 85) / 7.5,
    resting_hr: restingZ === null ? null : restingZ > -1 ? 87.5 - 30 * restingZ : 116 + 16 * restingZ,
    activity_balance: kcal7 !== null && kcal28 !== null ? 100 - 60 * Math.abs(0.25 + (kcal7 - kcal28) / kcalSd) : null,
    sleep_balance: sleepWeek === null ? null : 85 + (30 * (sleepWeek - 480)) / 40,
    previous_day_activity:
      previousStrain !== null && strainMean !== null ? 85 - 6 * 1.5 * ((previousStrain - strainMean) / strainSd) : null,
    recovery_index: worn && sleep !== null ? 85 + 15 * (between(random, 3.6, 6.4) - 5) - (elevated ? 25 : 0) : null,
    sleep_regularity: regularity === null ? null : regularity >= 85 ? 100 : 100 - 2 * (85 - regularity),
  });
  const readiness: Score = worn
    ? score(readinessComponents, READINESS_WEIGHTS, "estimate")
    : { value: null, components: readinessComponents, note: "no data" };

  // Activity
  const week = [...recent(6), day];
  const metMinutes = (item: Day) =>
    item.zone_moderate_min === null || item.zone_vigorous_min === null
      ? null
      : item.zone_moderate_min * 4 + item.zone_vigorous_min * 8;
  const volume = week.reduce((sum, item) => sum + (metMinutes(item) ?? 0), 0);
  const trainingDays = week.filter((item) => (metMinutes(item) ?? 0) >= 100).length;
  const reached = week.filter((item) => (item.steps ?? 0) >= 9000).length;
  const restDays = week.filter((item) => (dayStrain(item) ?? 0) < 10).length;
  const inactiveHours =
    day.active_minutes_est === null ? null : clamp(15 - (day.active_minutes_est / 60) * 1.6 - (day.steps ?? 0) / 4000, 4, 13);
  const longBouts = worn ? Math.max(0, Math.round(between(random, 0, 3.5) - (day.active_minutes_est ?? 0) / 90)) : null;
  const activity = score(
    rounded({
      meet_daily_targets: [20, 35, 50, 65, 80, 90, 100, 100][reached],
      stay_active: inactiveHours === null ? null : inactiveHours <= 7 ? 100 : 100 - (60 * (inactiveHours - 7)) / 5,
      training_volume: volume >= 750 ? 40 + (60 * (volume - 750)) / 1250 : (40 * volume) / 750,
      training_frequency: [20, 45, 70, 100, 100, 90, 85, 80][trainingDays],
      move_every_hour: longBouts === null ? null : 100 - 15 * longBouts,
      recovery_time: restDays === 0 ? 40 : restDays <= 2 ? 100 : 85,
    }),
    ACTIVITY_WEIGHTS,
    null,
  );
  const missing = Object.entries(activity.components).filter(([, value]) => value === null).map(([key]) => key);
  if (activity.value !== null && missing.length > 0) activity.note = `without ${missing.join(", ")}`;

  // Night signal
  let nightSignal: NightSignal = { level: null, night_hr: null, baseline: null, delta: null };
  if (worn) {
    const usual = mean(recent(28).map((item) => item.hr_resting)) ?? day.hr_resting;
    const baseline = round1((usual ?? 53) + 6.5);
    const delta = nightDelta(day.day);
    const before = nightDelta(addDays(day.day, -1));
    const level = delta < 3 ? "green" : delta >= 4 && before >= 4 ? "red" : "yellow";
    nightSignal = { level, night_hr: round1(baseline + delta), baseline, delta: round1(delta) };
  }

  // Overall
  const parts = [readiness.value, performance.value, activity.value].filter(isNumber);
  let dayScore = parts.length === 0 ? null : round1(parts.reduce((sum, value) => sum + value, 0) / parts.length);
  if (dayScore !== null && nightSignal.level === "red") dayScore = Math.min(50, dayScore);

  // Long term
  const vo2max = round1(49 + 1.5 * Math.sin(epoch / 40));
  const longSleep = mean([...recent(27).map((item) => item.sleep_minutes), sleep]);
  const longSteps = mean([...recent(27).map((item) => item.steps), day.steps]);
  const window28 = [...recent(27), day];
  const weekly = (pickMinutes: (item: Day) => number) =>
    (window28.reduce((sum, item) => sum + pickMinutes(item), 0) / window28.length) * 7;
  const zoneLow = weekly((item) => (item.zone_light_min ?? 0) + (item.zone_moderate_min ?? 0));
  const zoneHigh = weekly((item) => item.zone_vigorous_min ?? 0);
  const strengthMinutes = weekly((item) =>
    item.workouts.filter((workout) => workout.type === "strength_training").reduce((sum, workout) => sum + workout.duration_s / 60, 0),
  );
  const impacts: Record<string, number | null> = {
    sleep_duration: longSleep === null ? null : longSleep >= 420 ? -0.15 : ((420 - longSleep) / 60) * 0.5,
    sleep_consistency: regularity === null ? null : (75 - regularity) * 0.03,
    steps: longSteps === null ? null : longSteps >= 8000 ? -0.3 : ((8000 - longSteps) / 2000) * 0.5,
    zone_1_3: zoneLow >= 100 ? -0.2 : 0.3,
    zone_4_5: zoneHigh >= 10 ? -0.25 : 0.2,
    strength: strengthMinutes >= 40 ? -0.15 : 0.2,
    vo2max: (44 - vo2max) * 0.05,
    resting_hr: restingBaseline === null ? null : (restingBaseline - 60) * 0.03,
    lean_mass: null,
  };
  const impactValues = Object.values(impacts).filter(isNumber);
  const whoopAge: Score = {
    value: round1(AGE + impactValues.reduce((sum, value) => sum + value, 0)),
    components: Object.fromEntries(Object.entries(impacts).map(([key, value]) => [key, value === null ? null : round2(value)])),
    note: "estimate",
  };

  return {
    day: day.day,
    strain,
    cardio_load: {
      strain_7d: strain7 === null ? null : round1(strain7),
      tolerance_28d: tolerance28 === null ? null : round1(tolerance28),
      ratio: ratio === null ? null : round2(ratio),
      status: ratio === null ? null : cardioStatus(ratio),
    },
    sleep_need_minutes: sleepNeed(day),
    sleep_performance: performance,
    apple_sleep: apple,
    sleep_regularity: regularity,
    readiness,
    activity,
    night_signal: nightSignal,
    day_score: dayScore,
    vo2max: worn ? vo2max : null,
    vo2max_uth: day.hr_resting === null ? null : round1((15.3 * 196) / day.hr_resting),
    whoop_age: whoopAge,
  };
}

// ---------------------------------------------------------------------------------------
// Samsung-style scores, tuned in owi on the user's entries

/** Entries of a score owi waits for before it shows its estimate. */
export const SAMSUNG_NEEDED = 10;

// Part names as in owi's samsung_scores.py.
const SAMSUNG_SLEEP_WEIGHTS = { duration: 0.35, deep: 0.15, rem: 0.15, efficiency: 0.15, interruptions: 0.1, latency: 0.1 };
const ENERGY_WEIGHTS = { sleep: 0.3, regularity: 0.15, timing: 0.15, load: 0.2, night_hr: 0.2 };

function learning(entries: number): Score {
  return { value: null, components: { entries, needed: SAMSUNG_NEEDED }, note: "learning" };
}

/** Samsung Sleep Score of the night that ended on `day`; "learning" below SAMSUNG_NEEDED entries. */
export function demoSamsungSleep(day: Day, entries: number, random: Random): Score {
  if (entries < SAMSUNG_NEEDED) return learning(entries);
  const sleep = day.sleep_minutes;
  if (sleep === null || sleep <= 0) {
    const components = Object.fromEntries(Object.keys(SAMSUNG_SLEEP_WEIGHTS).map((key) => [key, null]));
    return { value: null, components, note: "no sleep recorded" };
  }
  const awake = day.sleep_awake_min ?? 0;
  return score(
    rounded({
      duration: 100 * Math.min(1, sleep / 480),
      deep: 100 * Math.min(1, (day.sleep_deep_min ?? 0) / sleep / 0.2),
      rem: 100 * Math.min(1, (day.sleep_rem_min ?? 0) / sleep / 0.23),
      efficiency: (100 * sleep) / (sleep + awake),
      interruptions: 100 - Math.min(100, Math.max(0, awake - 10) * 2),
      latency: between(random, 65, 100),
    }),
    SAMSUNG_SLEEP_WEIGHTS,
    null,
  );
}

/** Samsung Energy Score of `day` from the week's sleep, regularity, yesterday's load and the night. */
export function demoEnergyScore(day: Day, history: Day[], scores: DayScores, entries: number, random: Random): Score {
  if (entries < SAMSUNG_NEEDED) return learning(entries);
  if (day.hr_resting === null) {
    const components = Object.fromEntries(Object.keys(ENERGY_WEIGHTS).map((key) => [key, null]));
    return { value: null, components, note: "no data" };
  }
  const week = [...history.filter((item) => item.day >= addDays(day.day, -6)), day];
  const sleepWeek = mean(week.map((item) => item.sleep_minutes));
  const previous = history.find((item) => item.day === addDays(day.day, -1)) ?? null;
  const previousStrain = previous ? dayStrain(previous) : null;
  const delta = scores.night_signal.delta;
  return score(
    rounded({
      sleep: sleepWeek === null ? null : 100 * Math.min(1, sleepWeek / 480),
      regularity: scores.sleep_regularity === null ? null : (scores.sleep_regularity - 50) * 2,
      timing: between(random, 60, 100),
      load: previousStrain === null ? null : 100 - Math.abs(previousStrain - 10) * 6,
      night_hr: delta === null ? null : 100 - Math.max(0, delta) * 12,
    }),
    ENERGY_WEIGHTS,
    null,
  );
}
