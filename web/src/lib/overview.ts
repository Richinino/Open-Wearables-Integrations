// Calculations behind the overview tiles: the 12-week heatmap, records, the week in short,
// the sleep stage strip and the "čo si všimnúť" observations. Pure functions over the days
// returned by the API; null and absent days mean "no data" and are never counted as zero.

import { addDays, dateRange, localMinutesOfDay, weekdayIndex } from "./dates";
import { formatDuration, formatInt } from "./format";
import { average, indexByDay, max, min, sleepNights } from "./metrics";
import type { Day, SleepStage } from "./types";

// ---------------------------------------------------------------------------------------
// Slovak weekday forms

/** Plural, for "najviac bývajú soboty". */
const WEEKDAYS_PLURAL = ["pondelky", "utorky", "stredy", "štvrtky", "piatky", "soboty", "nedele"];
/** The night that starts on weekday i: "v noci z piatka na sobotu". */
const NIGHTS = [
  "z pondelka na utorok",
  "z utorka na stredu",
  "zo stredy na štvrtok",
  "zo štvrtka na piatok",
  "z piatka na sobotu",
  "zo soboty na nedeľu",
  "z nedele na pondelok",
];
export const WEEKDAY_LETTERS = ["po", "ut", "st", "št", "pi", "so", "ne"];

/** The main sleep of `day` ended that morning, so the night began on the weekday before. */
export function nightWeekday(day: string): number {
  return (weekdayIndex(day) + 6) % 7;
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, step: number) {
  return Math.round(value / step) * step;
}

// ---------------------------------------------------------------------------------------
// Heatmap

export type HeatMetric = "steps" | "sleep" | "active" | "resting";

export const HEAT_METRICS: { id: HeatMetric; label: string }[] = [
  { id: "steps", label: "Kroky" },
  { id: "sleep", label: "Spánok" },
  { id: "active", label: "Aktívny čas" },
  { id: "resting", label: "Pokojový tep" },
];

/** Level 0 = no data; 1-4 are the quartiles of the window's own values, low to high. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatCell {
  day: string;
  value: number | null;
  level: HeatLevel;
  /** After `end`: drawn as an empty slot so the columns stay whole weeks. */
  future: boolean;
  /** An unfinished day whose running total is left out; not the same as missing data. */
  running: boolean;
}

export interface Heatmap {
  metric: HeatMetric;
  /** Column-major: week by week, Monday to Sunday. */
  cells: HeatCell[];
  weeks: number;
  first: string;
  last: string;
  average: number | null;
  /** Upper bounds of levels 1-3. */
  thresholds: [number, number, number] | null;
}

/** The day's value for a heatmap metric. Running totals of an unfinished day are left out. */
export function heatValue(day: Day | undefined, metric: HeatMetric): number | null {
  if (!day) return null;
  const cumulative = metric === "steps" || metric === "active";
  if (cumulative && day.complete === false) return null;
  const value =
    metric === "steps"
      ? day.steps
      : metric === "sleep"
        ? day.sleep_minutes
        : metric === "active"
          ? day.active_minutes_est
          : day.hr_resting;
  return isNumber(value) ? value : null;
}

function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** `weeks` whole weeks, Monday first, the last one containing `end`. */
export function heatmap(days: Day[], end: string, metric: HeatMetric, weeks: number = 12): Heatmap {
  const byDay = indexByDay(days);
  const first = addDays(end, -weekdayIndex(end) - (weeks - 1) * 7);
  const last = addDays(first, weeks * 7 - 1);
  const cumulative = metric === "steps" || metric === "active";
  const slots = dateRange(first, last).map((day) => ({
    day,
    future: day > end,
    running: day <= end && cumulative && byDay.get(day)?.complete === false,
    value: day > end ? null : heatValue(byDay.get(day), metric),
  }));
  const values = slots.flatMap((slot) => (slot.value === null ? [] : [slot.value])).sort((a, b) => a - b);
  const thresholds: [number, number, number] | null =
    values.length === 0 ? null : [quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75)];
  const levelOf = (value: number | null): HeatLevel => {
    if (value === null || !thresholds) return 0;
    if (value <= thresholds[0]) return 1;
    if (value <= thresholds[1]) return 2;
    if (value <= thresholds[2]) return 3;
    return 4;
  };
  return {
    metric,
    cells: slots.map((slot) => ({ ...slot, level: levelOf(slot.value) })),
    weeks,
    first,
    last,
    average: average(values),
    thresholds,
  };
}

function meanBy(entries: { group: number; value: number }[], groups: number): (number | null)[] {
  return Array.from({ length: groups }, (_, group) =>
    average(entries.filter((entry) => entry.group === group).map((entry) => entry.value)),
  );
}

function extremeIndex(values: (number | null)[], highest: boolean): number | null {
  let best: number | null = null;
  values.forEach((value, index) => {
    if (value === null) return;
    if (best === null || (highest ? value > (values[best] as number) : value < (values[best] as number))) {
      best = index;
    }
  });
  return best;
}

/** The line under the heatmap's headline figure. */
export function heatmapNote(map: Heatmap): string {
  const present = map.cells.filter((cell) => cell.value !== null) as (HeatCell & { value: number })[];
  if (present.length === 0) return "za 12 týždňov zatiaľ bez dát";
  if (map.metric === "resting") {
    const firstWeeks = average(present.filter((cell) => cell.day < addDays(map.first, 28)).map((c) => c.value));
    const lastWeeks = average(present.filter((cell) => cell.day > addDays(map.last, -28)).map((c) => c.value));
    if (firstWeeks === null || lastWeeks === null) return "priemer za 12 týždňov";
    const change = Math.round(lastWeeks - firstWeeks);
    if (change === 0) return "priemer · za 12 týždňov sa nezmenil";
    return `priemer · za 12 týždňov ${change < 0 ? "klesol" : "stúpol"} o ${formatInt(Math.abs(change))} bpm`;
  }
  if (map.metric === "sleep") {
    const byNight = meanBy(present.map((c) => ({ group: nightWeekday(c.day), value: c.value })), 7);
    const shortest = extremeIndex(byNight, false);
    return shortest === null ? "za noc" : `za noc · najkratšie spíš v noci ${NIGHTS[shortest]}`;
  }
  const byWeekday = meanBy(present.map((c) => ({ group: weekdayIndex(c.day), value: c.value })), 7);
  const busiest = extremeIndex(byWeekday, true);
  const lead = map.metric === "steps" ? "krokov za deň" : "za deň · odhad z tepu a tréningov";
  return busiest === null ? lead : `${lead} · najviac bývajú ${WEEKDAYS_PLURAL[busiest]}`;
}

// ---------------------------------------------------------------------------------------
// Records

export type RecordKey = "steps" | "sleep" | "resting" | "workout" | "dayScore";

export interface RecordItem {
  key: RecordKey;
  value: number;
  day: string;
  /** Workout type, for the longest workout. */
  type?: string;
}

/**
 * Bests of the `length` days ending at `end`: most steps, longest sleep, lowest resting
 * heart rate, longest workout and best day score. Unfinished days do not compete on
 * running totals. On a tie the earlier day keeps the record.
 */
export function records(days: Day[], end: string, length: number = 90): RecordItem[] {
  const from = addDays(end, -(length - 1));
  const inWindow = days.filter((day) => day.day >= from && day.day <= end);
  const best = (
    key: RecordKey,
    pick: (day: Day) => number | null | undefined,
    highest: boolean,
    candidates: Day[] = inWindow,
  ): RecordItem | null => {
    let found: RecordItem | null = null;
    for (const day of candidates) {
      const value = pick(day);
      if (!isNumber(value)) continue;
      if (!found || (highest ? value > found.value : value < found.value)) found = { key, value, day: day.day };
    }
    return found;
  };
  const complete = inWindow.filter((day) => day.complete !== false);
  let workout: RecordItem | null = null;
  for (const day of inWindow) {
    for (const item of day.workouts ?? []) {
      if (!isNumber(item.duration_s)) continue;
      if (!workout || item.duration_s > workout.value) {
        workout = { key: "workout", value: item.duration_s, day: item.day, type: item.type };
      }
    }
  }
  return [
    best("steps", (day) => day.steps, true, complete),
    best("sleep", (day) => day.sleep_minutes, true),
    best("resting", (day) => day.hr_resting, false),
    workout,
    best("dayScore", (day) => day.scores?.day_score, true),
  ].filter((item): item is RecordItem => item !== null);
}

// ---------------------------------------------------------------------------------------
// The week in short

export interface WeekCard {
  day: string;
  data: Day | null;
  steps: number | null;
  /** Steps against the 30-day daily average, 0..1, for the small ring. */
  stepsShare: number | null;
  sleepMinutes: number | null;
  dayScore: number | null;
  workout: { type: string; minutes: number } | null;
}

/** The seven days ending at `end`, oldest first. */
export function weekCards(days: Day[], end: string): WeekCard[] {
  const byDay = indexByDay(days);
  const month = dateRange(addDays(end, -30), addDays(end, -1)).map((day) => heatValue(byDay.get(day), "steps"));
  const usual = average(month);
  return dateRange(addDays(end, -6), end).map((day) => {
    const data = byDay.get(day) ?? null;
    const steps = isNumber(data?.steps) ? data.steps : null;
    const longest = [...(data?.workouts ?? [])].sort((a, b) => b.duration_s - a.duration_s)[0];
    return {
      day,
      data,
      steps,
      stepsShare: steps === null || !usual ? null : Math.min(1, steps / usual),
      sleepMinutes: isNumber(data?.sleep_minutes) ? data.sleep_minutes : null,
      dayScore: isNumber(data?.scores?.day_score) ? data.scores.day_score : null,
      workout: longest ? { type: longest.type, minutes: longest.duration_s / 60 } : null,
    };
  });
}

// ---------------------------------------------------------------------------------------
// Sleep

export type StripStage = Exclude<SleepStage, "asleep"> | "asleep";

export interface StageSegment {
  stage: StripStage;
  minutes: number;
}

/**
 * The night of `day` as a strip of stages, in time order. Uses the stage timeline when
 * the API sends one (only the stretch of the main sleep), otherwise one block per stage.
 */
export function sleepSegments(day: Day | null | undefined): StageSegment[] {
  if (!day) return [];
  const start = day.sleep_start ? Date.parse(day.sleep_start) : NaN;
  const end = day.sleep_end ? Date.parse(day.sleep_end) : NaN;
  const timeline = (day.sleep_timeline ?? []).filter((item) => {
    const from = Date.parse(item.start);
    const to = Date.parse(item.end);
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return false;
    return Number.isNaN(start) || Number.isNaN(end) ? true : from >= start && to <= end;
  });
  if (timeline.length > 0) {
    const segments: StageSegment[] = [];
    for (const item of timeline) {
      const minutes = (Date.parse(item.end) - Date.parse(item.start)) / 60_000;
      const previous = segments[segments.length - 1];
      if (previous?.stage === item.stage) previous.minutes += minutes;
      else segments.push({ stage: item.stage, minutes });
    }
    return segments;
  }
  const blocks: [StripStage, number | null][] = [
    ["light", day.sleep_light_min],
    ["deep", day.sleep_deep_min],
    ["rem", day.sleep_rem_min],
    ["awake", day.sleep_awake_min],
  ];
  return blocks
    .filter((block): block is [StripStage, number] => isNumber(block[1]) && block[1] > 0)
    .map(([stage, minutes]) => ({ stage, minutes }));
}

export interface SleepWindow {
  /** Minutes since local midnight. */
  bedtime: number;
  wake: number;
  /** Standard deviation of the bedtime, minutes. */
  spread: number;
  nights: number;
}

/** Usual bedtime and wake-up over the last `nights` nights ending at `end`. */
export function sleepWindow(days: Day[], timeZone: string, end: string, nights: number = 14): SleepWindow | null {
  const from = addDays(end, -(nights - 1));
  const recent = sleepNights(days.filter((day) => day.day >= from && day.day <= end), timeZone);
  if (recent.length < 3) return null;
  const beds = recent.map((night) => night.bedMinutes);
  const meanBed = average(beds) as number;
  const wakes = recent.map((night) => localMinutesOfDay(night.end, timeZone));
  const spread = Math.sqrt(average(beds.map((bed) => (bed - meanBed) ** 2)) as number);
  return {
    bedtime: (Math.round(meanBed) + 720) % 1440,
    wake: Math.round(average(wakes) as number),
    spread: Math.round(spread),
    nights: recent.length,
  };
}

// ---------------------------------------------------------------------------------------
// "Čo si všimnúť"

export interface InsightBar {
  label: string;
  value: number | null;
  highlight: boolean;
}

export interface Insight {
  key: "weekendSteps" | "shortNight" | "restingTrend";
  text: string;
  detail: string;
  bars: InsightBar[];
  tone: "accent" | "sleep" | "heart";
  href: string;
}

const WINDOW_DAYS = 28;

function weekendSteps(days: Day[], end: string): Insight | null {
  const byDay = indexByDay(days);
  const window = dateRange(addDays(end, -(WINDOW_DAYS - 1)), end)
    .map((day) => ({ day, value: heatValue(byDay.get(day), "steps") }))
    .filter((entry): entry is { day: string; value: number } => entry.value !== null);
  const weekend = window.filter((entry) => weekdayIndex(entry.day) >= 5).map((entry) => entry.value);
  const weekday = window.filter((entry) => weekdayIndex(entry.day) < 5).map((entry) => entry.value);
  if (weekend.length < 3 || weekday.length < 8) return null;
  const we = average(weekend) as number;
  const wd = average(weekday) as number;
  if (wd <= 0 || we <= 0) return null;
  const byWeekday = meanBy(window.map((entry) => ({ group: weekdayIndex(entry.day), value: entry.value })), 7);
  const weekendMore = we >= wd;
  const bars = byWeekday.map((value, index) => ({
    label: WEEKDAY_LETTERS[index],
    value,
    highlight: weekendMore ? index >= 5 : index < 5,
  }));
  const share = weekendMore ? we / wd - 1 : wd / we - 1;
  const percent = Math.round(share * 100);
  const detail = `${formatInt(round(we, 100))} oproti ${formatInt(round(wd, 100))} krokom`;
  if (percent < 10) {
    return { key: "weekendSteps", text: "Cez víkendy a v pracovné dni prejdeš zhruba rovnako.", detail: `víkend ${detail}`, bars, tone: "accent", href: "/kroky" };
  }
  return {
    key: "weekendSteps",
    text: weekendMore
      ? `Cez víkendy prejdeš o ${formatInt(percent)} % viac než v pracovné dni.`
      : `V pracovné dni prejdeš o ${formatInt(percent)} % viac než cez víkendy.`,
    detail: weekendMore ? detail : `${formatInt(round(wd, 100))} oproti ${formatInt(round(we, 100))} krokom`,
    bars,
    tone: "accent",
    href: "/kroky",
  };
}

function shortNight(days: Day[], end: string): Insight | null {
  const from = addDays(end, -(WINDOW_DAYS - 1));
  const nights = days
    .filter((day) => day.day >= from && day.day <= end && isNumber(day.sleep_minutes))
    .map((day) => ({ group: nightWeekday(day.day), value: day.sleep_minutes as number }));
  const byNight = meanBy(nights, 7);
  if (byNight.filter((value) => value !== null).length < 5 || nights.length < 14) return null;
  const shortest = extremeIndex(byNight, false) as number;
  const others = average(nights.filter((night) => night.group !== shortest).map((night) => night.value)) as number;
  const value = byNight[shortest] as number;
  const bars = byNight.map((night, index) => ({ label: WEEKDAY_LETTERS[index], value: night, highlight: index === shortest }));
  if (others - value < 20) {
    return {
      key: "shortNight",
      text: `Spíš podobne dlho každú noc, okolo ${formatDuration(round(average(nights.map((n) => n.value)) as number, 5))}.`,
      detail: "rozdiel medzi nocami je menší ako 20 min",
      bars,
      tone: "sleep",
      href: "/spanok",
    };
  }
  return {
    key: "shortNight",
    text: `Najkratšie spíš v noci ${NIGHTS[shortest]}, priemerne ${formatDuration(value)}.`,
    detail: `ostatné noci ${formatDuration(others)}`,
    bars,
    tone: "sleep",
    href: "/spanok",
  };
}

function restingTrend(days: Day[], end: string): Insight | null {
  const byDay = indexByDay(days);
  const mean = (last: string) =>
    average(dateRange(addDays(last, -6), last).map((day) => byDay.get(day)?.hr_resting));
  const recent = mean(end);
  const before = mean(addDays(end, -30));
  if (recent === null || before === null) return null;
  const bars = Array.from({ length: 8 }, (_, index) => {
    const last = addDays(end, -7 * (7 - index));
    return { label: `${index + 1}`, value: mean(last), highlight: index === 7 };
  });
  const change = Math.round(recent - before);
  const from = formatInt(before);
  const to = formatInt(recent);
  if (change === 0) {
    return { key: "restingTrend", text: `Pokojový tep je za mesiac stabilný, okolo ${to} bpm.`, detail: `pred mesiacom ${from} bpm`, bars, tone: "heart", href: "/tep" };
  }
  return {
    key: "restingTrend",
    text: `Pokojový tep ti za mesiac ${change < 0 ? "klesol" : "stúpol"} o ${formatInt(Math.abs(change))} bpm.`,
    detail:
      change < 0
        ? `z ${from} na ${to} · často to sprevádza lepšiu kondíciu`
        : `z ${from} na ${to} · môže to súvisieť so záťažou, spánkom alebo stresom`,
    bars,
    tone: "heart",
    href: "/tep",
  };
}

/** Observations from the last weeks ending at `end`; each needs enough data to appear. */
export function insights(days: Day[], end: string): Insight[] {
  return [weekendSteps(days, end), shortNight(days, end), restingTrend(days, end)].filter(
    (item): item is Insight => item !== null,
  );
}

/** Lowest and highest of a run of bars, for scaling them to a common height. */
export function barRange(bars: { value: number | null }[]): { low: number | null; high: number | null } {
  return { low: min(bars.map((bar) => bar.value)), high: max(bars.map((bar) => bar.value)) };
}
