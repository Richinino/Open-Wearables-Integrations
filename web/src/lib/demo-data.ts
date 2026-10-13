// Invented data for local development and tests. Nothing here is measured on a person.
//
// Every value is drawn from a generator seeded with the day's own date, so a given calendar
// day looks the same whatever `today` is. Only the gaps (counted back from `today`) and the
// unfinished last day depend on the arguments. No Math.random, no clock access.

import { addDays, diffDays, isValidDay, localDay, localMinutesOfDay, weekdayIndex } from "./dates";
import type { Dataset, Day, StepsSource, Workout } from "./types";

const TIME_ZONE = "Europe/Bratislava";
const MINUTE_MS = 60_000;
const STRIDE_M = 0.74;
const BASAL_KCAL_PER_DAY = 1680;

/** Days before `today` that are absent from the array altogether. */
const MISSING_OFFSETS = new Set([13, 14, 47, 92]);
/** One night in this many has no sleep record. */
const NO_SLEEP_PERIOD = 31;
/** One day in this many the watch stayed at home: phone steps only, no heart rate, no sleep. */
const NO_WATCH_PERIOD = 41;

type Random = () => number;

interface Activity {
  /** [min, max] in minutes. */
  duration: [number, number];
  heartRate: [number, number];
  /** Metres per second; absent for activities that record no distance. */
  speed?: [number, number];
  /** How often a distance that could exist is missing anyway. */
  distanceGap: number;
  /** Shares of the duration spent in each zone. */
  vigorous: [number, number];
  moderate: [number, number];
  kcalPerMinute: [number, number];
  stepsPerMinute: number;
}

const ACTIVITIES: Record<string, Activity> = {
  running: {
    duration: [28, 62],
    heartRate: [142, 160],
    speed: [2.6, 3.2],
    distanceGap: 0.15,
    vigorous: [0.25, 0.55],
    moderate: [0.35, 0.45],
    kcalPerMinute: [10, 13],
    stepsPerMinute: 165,
  },
  walking: {
    duration: [35, 110],
    heartRate: [92, 112],
    speed: [1.25, 1.55],
    distanceGap: 0.12,
    vigorous: [0, 0],
    moderate: [0.05, 0.3],
    kcalPerMinute: [3.5, 5],
    stepsPerMinute: 108,
  },
  cycling: {
    duration: [45, 150],
    heartRate: [118, 142],
    speed: [5.5, 7.5],
    distanceGap: 0.1,
    vigorous: [0.05, 0.25],
    moderate: [0.4, 0.6],
    kcalPerMinute: [7, 10],
    stepsPerMinute: 0,
  },
  pool_swimming: {
    duration: [30, 55],
    heartRate: [118, 138],
    speed: [0.55, 0.75],
    distanceGap: 0.2,
    vigorous: [0.05, 0.2],
    moderate: [0.4, 0.6],
    kcalPerMinute: [7, 9.5],
    stepsPerMinute: 0,
  },
  soccer: {
    duration: [60, 95],
    heartRate: [138, 156],
    distanceGap: 1,
    vigorous: [0.25, 0.45],
    moderate: [0.3, 0.45],
    kcalPerMinute: [9, 12],
    stepsPerMinute: 95,
  },
  volleyball: {
    duration: [70, 105],
    heartRate: [108, 128],
    distanceGap: 1,
    vigorous: [0.02, 0.1],
    moderate: [0.25, 0.45],
    kcalPerMinute: [5, 7],
    stepsPerMinute: 45,
  },
  strength_training: {
    duration: [40, 70],
    heartRate: [100, 122],
    distanceGap: 1,
    vigorous: [0, 0.05],
    moderate: [0.15, 0.35],
    kcalPerMinute: [4.5, 6.5],
    stepsPerMinute: 12,
  },
  generic: {
    duration: [20, 50],
    heartRate: [105, 135],
    distanceGap: 1,
    vigorous: [0, 0.15],
    moderate: [0.2, 0.5],
    kcalPerMinute: [5, 8],
    stepsPerMinute: 30,
  },
};

interface Candidate {
  type: string;
  probability: number;
  /** Window for the start, minutes after local midnight. Windows on one day never overlap. */
  start: [number, number];
}

const at = (hours: number, minutes: number = 0) => hours * 60 + minutes;

/** What might happen on each weekday, Monday first. */
const WEEK: Candidate[][] = [
  [{ type: "strength_training", probability: 0.55, start: [at(17, 30), at(19)] }],
  [{ type: "running", probability: 0.7, start: [at(17), at(18, 45)] }],
  [
    { type: "walking", probability: 0.15, start: [at(12), at(12, 30)] },
    { type: "volleyball", probability: 0.6, start: [at(18), at(19)] },
  ],
  [
    { type: "running", probability: 0.5, start: [at(7, 15), at(7, 45)] },
    { type: "pool_swimming", probability: 0.3, start: [at(18), at(19, 30)] },
  ],
  [
    { type: "generic", probability: 0.2, start: [at(12), at(12, 30)] },
    { type: "strength_training", probability: 0.4, start: [at(16, 30), at(18)] },
  ],
  [
    { type: "soccer", probability: 0.5, start: [at(9, 30), at(10, 30)] },
    { type: "cycling", probability: 0.45, start: [at(14), at(15, 30)] },
    { type: "walking", probability: 0.3, start: [at(18, 30), at(19, 30)] },
  ],
  [
    { type: "walking", probability: 0.55, start: [at(9, 30), at(11)] },
    { type: "cycling", probability: 0.25, start: [at(14), at(15, 30)] },
    { type: "generic", probability: 0.12, start: [at(18, 30), at(19, 30)] },
  ],
];

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, and identical on every JavaScript engine. */
function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const between = (random: Random, [low, high]: [number, number]) => low + random() * (high - low);
const whole = (random: Random, low: number, high: number) =>
  low + Math.floor(random() * (high - low + 1));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const oneDecimal = (value: number) => Math.round(value * 10) / 10;
const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

function isoUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/** The instant at which the zone's wall clock shows `minutes` past midnight on `day`. */
function instantAt(day: string, minutes: number): number {
  const wanted = Date.parse(`${day}T00:00:00Z`) + minutes * MINUTE_MS;
  // Guess with winter time, then correct by whatever the zone really shows at that instant.
  const guess = wanted - 60 * MINUTE_MS;
  const iso = new Date(guess).toISOString();
  const shown =
    Date.parse(`${localDay(iso, TIME_ZONE)}T00:00:00Z`) +
    localMinutesOfDay(iso, TIME_ZONE) * MINUTE_MS;
  return guess + (wanted - shown);
}

interface PlannedWorkout {
  workout: Workout;
  endMs: number;
  minutes: number;
  steps: number;
}

function planWorkout(random: Random, day: string, candidate: Candidate, index: number): PlannedWorkout {
  const activity = ACTIVITIES[candidate.type];
  const minutes = whole(random, ...activity.duration);
  const startMs = instantAt(day, whole(random, ...candidate.start));
  const endMs = startMs + minutes * MINUTE_MS;

  const heartRate = Math.round(between(random, activity.heartRate));
  const peak = Math.min(189, heartRate + whole(random, 12, 30));
  const low = Math.max(68, heartRate - whole(random, 25, 48));
  const vigorous = Math.round(minutes * between(random, activity.vigorous));
  const moderate = Math.round(minutes * between(random, activity.moderate));
  const belowZones = whole(random, 0, 4);
  const light = Math.max(0, minutes - vigorous - moderate - belowZones);
  const kcal = Math.round(minutes * between(random, activity.kcalPerMinute));
  const speed = activity.speed ? between(random, activity.speed) : null;
  const distanceMissing = random() < activity.distanceGap;
  const fromHealthConnect = random() < 0.75;
  // Without heart rate there are no zones and no calorie estimate either.
  const heartRateMissing = random() < 0.05;

  return {
    endMs,
    minutes,
    steps: minutes * activity.stepsPerMinute,
    workout: {
      id: `demo-${day}-${index + 1}`,
      day,
      type: candidate.type,
      start: isoUtc(startMs),
      end: isoUtc(endMs),
      duration_s: minutes * 60,
      source: fromHealthConnect ? "google" : "samsung",
      hr_avg: heartRateMissing ? null : heartRate,
      hr_max: heartRateMissing ? null : peak,
      hr_min: heartRateMissing ? null : low,
      zone_light_min: heartRateMissing ? 0 : light,
      zone_moderate_min: heartRateMissing ? 0 : moderate,
      zone_vigorous_min: heartRateMissing ? 0 : vigorous,
      distance_m: speed === null || distanceMissing ? null : Math.round((speed * minutes * 60) / 10) * 10,
      kcal_est: heartRateMissing ? null : kcal,
    },
  };
}

/** `cutoffMs` is set for the day still in progress: only what happened before it is reported. */
function buildDay(day: string, cutoffMs: number | null): Day {
  const random = seeded(hashText(`owi-demo:${day}`));
  const weekday = weekdayIndex(day);
  const weekend = weekday >= 5;
  const epochDay = diffDays("1970-01-01", day);
  const inProgress = cutoffMs !== null;
  const watchWorn = inProgress || epochDay % NO_WATCH_PERIOD !== 19;

  const dayStart = instantAt(day, 0);
  const dayLength = instantAt(addDays(day, 1), 0) - dayStart;
  const elapsed = inProgress ? clamp((cutoffMs - dayStart) / dayLength, 0.02, 1) : 1;
  // Share of the day's movement already done: next to nothing happens before about 07:00.
  const moved = inProgress ? clamp((elapsed - 0.28) / 0.64, 0, 1) : 1;

  // Sleep that ended this morning. Weekend mornings start later and follow later nights.
  const wakeUp = weekend ? whole(random, at(7, 20), at(9, 20)) : whole(random, at(6, 10), at(7));
  const shortNight = random() < 0.06;
  const longNight = weekend ? whole(random, 450, 570) : whole(random, 400, 500);
  const inBed = shortNight ? whole(random, 300, 365) : longNight;
  const awake = whole(random, 8, 45);
  const asleep = inBed - awake;
  const deep = Math.round(asleep * between(random, [0.13, 0.22]));
  const rem = Math.round(asleep * between(random, [0.18, 0.26]));
  const napped = random() < (weekend ? 0.22 : 0.1);
  const napLength = whole(random, 20, 80);
  const sleepEnd = instantAt(day, wakeUp);
  const sleepStart = sleepEnd - inBed * MINUTE_MS;
  const sleepRecorded =
    watchWorn && epochDay % NO_SLEEP_PERIOD !== 11 && (cutoffMs === null || sleepEnd <= cutoffMs);

  // Every fourth Saturday is a full sports day, so a day with three workouts always exists.
  const fullDay = weekday === 5 && Math.floor(epochDay / 7) % 4 === 0;
  const planned = WEEK[weekday]
    .map((candidate) => ({ candidate, happens: random() < candidate.probability || fullDay }))
    .filter(({ happens }) => happens && watchWorn)
    .map(({ candidate }, index) => planWorkout(random, day, candidate, index))
    .filter(({ endMs }) => cutoffMs === null || endMs <= cutoffMs);
  const workouts = planned.map(({ workout }) => workout);
  const workoutMinutes = total(planned.map(({ minutes }) => minutes));

  const usualSteps =
    weekday === 5
      ? whole(random, 5000, 9500)
      : weekday === 6
        ? whole(random, 3800, 8000)
        : whole(random, 5200, 9200);
  const ambientSteps = Math.max(1500, usualSteps + Math.round(700 * Math.sin(epochDay / 9)));
  const sourceRoll = random();
  const stepsMissing = random() < 0.1 && !inProgress && watchWorn;
  const watchSource: StepsSource =
    sourceRoll < 0.72 ? "samsung_health_total" : sourceRoll < 0.9 ? "samsung_hourly" : "phone";
  const stepsSource: StepsSource = watchWorn ? watchSource : "phone";
  // A phone left on the desk misses part of the day.
  const counted = watchWorn ? ambientSteps * moved : ambientSteps * 0.7;
  const steps = stepsMissing ? null : Math.round(counted) + total(planned.map((item) => item.steps));

  const ambientLight = whole(random, weekend ? 35 : 25, weekend ? 95 : 70);
  const ambientModerate = whole(random, 0, 14);
  const ambientVigorous = random() < 0.15 ? whole(random, 1, 3) : 0;
  const briskShare = between(random, [0.3, 0.6]);
  const ambientActive = ambientModerate + ambientVigorous + ambientLight * briskShare;

  const resting = oneDecimal(53 + 2.5 * Math.sin(epochDay / 14) + between(random, [-1.5, 1.5]));
  const lowest = Math.round(resting) - whole(random, 2, 6);
  const mean = oneDecimal(resting + between(random, [13, 19]) + workoutMinutes * 0.05);
  const ambientPeak = whole(random, 108, 132);
  const peak = Math.max(ambientPeak, ...workouts.map((workout) => workout.hr_max ?? 0));

  const basal = Math.round((BASAL_KCAL_PER_DAY + 8 * Math.sin(epochDay / 40)) * elapsed);
  const activity =
    Math.round((ambientSteps * 0.032 + ambientModerate * 4) * moved) +
    total(workouts.map((workout) => workout.kcal_est ?? 0));

  const zone = (ambient: number, key: "zone_light_min" | "zone_moderate_min" | "zone_vigorous_min") =>
    watchWorn ? Math.round(ambient * moved) + total(workouts.map((workout) => workout[key])) : null;

  return {
    day,
    timezone: TIME_ZONE,
    complete: !inProgress,
    steps,
    steps_source: steps === null ? null : stepsSource,
    distance_m_est: steps === null ? null : oneDecimal(steps * STRIDE_M),
    active_minutes_est: watchWorn ? workoutMinutes + Math.round(ambientActive * moved) : null,
    activity_kcal_est: watchWorn ? activity : null,
    basal_kcal: basal,
    total_kcal_est: watchWorn ? basal + activity : null,
    hr_resting: watchWorn ? resting : null,
    hr_avg: watchWorn ? mean : null,
    hr_max: watchWorn ? peak : null,
    hr_min: watchWorn ? lowest : null,
    zone_light_min: zone(ambientLight, "zone_light_min"),
    zone_moderate_min: zone(ambientModerate, "zone_moderate_min"),
    zone_vigorous_min: zone(ambientVigorous, "zone_vigorous_min"),
    sleep_start: sleepRecorded ? isoUtc(sleepStart) : null,
    sleep_end: sleepRecorded ? isoUtc(sleepEnd) : null,
    sleep_minutes: sleepRecorded ? asleep : null,
    sleep_deep_min: sleepRecorded ? deep : null,
    sleep_rem_min: sleepRecorded ? rem : null,
    sleep_light_min: sleepRecorded ? asleep - deep - rem : null,
    sleep_awake_min: sleepRecorded ? awake : null,
    // A nap is an afternoon thing, so an unfinished day only has one late in the day.
    nap_minutes: sleepRecorded ? (napped && elapsed > 0.7 ? napLength : 0) : null,
    workouts,
  };
}

/**
 * `days` calendar days ending at `today`, minus a few gaps. The last day is still in progress
 * and holds only what happened before `syncedAt` (default: 08:00 UTC on `today`).
 */
export function demoDataset(today: string, days: number = 120, syncedAt?: string): Dataset {
  if (!isValidDay(today)) throw new RangeError(`Invalid day: ${String(today)}`);

  const fallbackSync = `${today}T08:00:00+00:00`;
  const synced = syncedAt !== undefined && !Number.isNaN(Date.parse(syncedAt)) ? syncedAt : fallbackSync;
  const cutoffMs = Date.parse(synced);

  const result: Day[] = [];
  for (let offset = Math.floor(days) - 1; offset >= 0; offset--) {
    if (MISSING_OFFSETS.has(offset)) continue;
    result.push(buildDay(addDays(today, -offset), offset === 0 ? cutoffMs : null));
  }

  return {
    timezone: TIME_ZONE,
    first_day: result.length > 0 ? result[0].day : null,
    last_day: result.length > 0 ? result[result.length - 1].day : null,
    synced_at: result.length > 0 ? synced : null,
    days: result,
  };
}
