// Calculations behind the sleep detail page: the two sleep scores and their parts, the night
// as a hypnogram with naps apart, sleep need for tonight, history against the need, the
// usual bed and wake times and what the Sleep Regularity Index means. Pure functions; null
// and absent days mean "no data" and are never counted as zero. Texts are Slovak.

import { addDays, dateRange, localMinutesOfDay } from "./dates";
import { average, indexByDay, sleepNights } from "./metrics";
import {
  appleSleepBand,
  bedtimeFor,
  samsungSleepBand,
  scoreValue,
  sleepPerformanceBand,
  typicalWake,
  type Band,
} from "./scores";
import type { Day, Score, SleepStage } from "./types";

const MINUTE_MS = 60_000;
/** Stretches of the timeline closer than this belong to the same nap. */
const NAP_GAP_MINUTES = 30;
/** Timeline stretches may overhang the main sleep by this much and still belong to it. */
const EDGE_MS = 2 * MINUTE_MS;

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---------------------------------------------------------------------------------------
// The two scores

export type SleepKind = "performance" | "apple" | "samsung";

/** localStorage key of the viewer's choice between the scores. */
export const SLEEP_KIND_KEY = "zdravie-sleep-score";

export interface PartInfo {
  key: string;
  /** Top of the part's scale: 100 for percentages, the points for Apple's parts. */
  max: number;
  /** One plain line on what the part measures. */
  explain: string;
}

export interface SleepKindInfo {
  kind: SleepKind;
  label: string;
  /** Text of the switch option when it differs from the label. */
  option?: string;
  /** Whose method it follows; shown subtly in the detail only. */
  vendor: string;
  about: string;
  band: (value: number | null | undefined) => Band | null;
  /** Nights from this score on count as strong in the history. */
  top: number;
  /** Every value is an estimate (≈), whatever its note says. */
  estimate?: boolean;
  /**
   * Known parts in display order. With `onlyPresent` only the ones the score has are shown,
   * so a part owi leaves out never shows as an empty row; parts beyond the list always show.
   */
  parts: PartInfo[];
  onlyPresent?: boolean;
}

export const SLEEP_KINDS: Record<SleepKind, SleepKindInfo> = {
  performance: {
    kind: "performance",
    label: "Sleep Performance",
    vendor: "WHOOP",
    about: "Koľko z potrebného spánku si naozaj naspal. 100 znamená, že si potrebu pokryl celú.",
    band: sleepPerformanceBand,
    top: 85,
    parts: [
      { key: "hours_vs_needed", max: 100, explain: "koľko percent potreby spánku z predošlého dňa si naspal" },
      { key: "consistency", max: 100, explain: "ako sa časy zaspatia a vstávania zhodujú s poslednými nocami" },
      { key: "efficiency", max: 100, explain: "podiel času v posteli, keď si naozaj spal, nie ležal hore" },
    ],
  },
  apple: {
    kind: "apple",
    label: "Sleep Score",
    vendor: "Apple",
    about: "Súčet troch častí: dĺžka spánku do 50 bodov, čas zaspatia do 30 a prerušenia do 20.",
    band: appleSleepBand,
    top: 81,
    parts: [
      { key: "duration", max: 50, explain: "plný počet od asi 7 h 50 min spánku; uberá aj málo hlbokého spánku či REM" },
      { key: "bedtime", max: 30, explain: "zaspatie oproti tvojmu bežnému času za posledných 13 nocí" },
      { key: "interruptions", max: 20, explain: "bdenie počas noci a počet prebudení" },
    ],
  },
  samsung: {
    kind: "samsung",
    label: "Samsung Sleep Score",
    option: "Samsung (odhad)",
    vendor: "Samsung",
    about:
      "Odhad skóre zo Samsung Health. Časti sú podľa toho, ako Samsung skóre popisuje, ich váhy owi dolaďuje podľa tvojich zápisov.",
    band: samsungSleepBand,
    top: 90,
    estimate: true,
    onlyPresent: true,
    // Keys as owi's samsung_scores.py names them.
    parts: [
      { key: "duration", max: 100, explain: "celkový čas spánku oproti potrebe, pri tvojom veku 8 h" },
      { key: "deep", max: 100, explain: "hlboký spánok, fyzická regenerácia" },
      { key: "rem", max: 100, explain: "REM spánok, psychická regenerácia" },
      { key: "efficiency", max: 100, explain: "koľko z času v posteli si naozaj spal" },
      { key: "interruptions", max: 100, explain: "bdenie po zaspaní" },
      { key: "latency", max: 100, explain: "ako dlho ti trvá zaspať" },
    ],
  },
};

export function isSleepKind(value: unknown): value is SleepKind {
  return value === "performance" || value === "apple" || value === "samsung";
}

export function sleepScoreOf(day: Day | null | undefined, kind: SleepKind): Score | null {
  const scores = day?.scores;
  if (!scores) return null;
  const score = kind === "performance" ? scores.sleep_performance : kind === "apple" ? scores.apple_sleep : scores.samsung_sleep;
  return score ?? null;
}

// ---------------------------------------------------------------------------------------
// Last night

/** The latest day up to `date` with a recorded main sleep: the night that ended that morning. */
export function lastNight(days: Day[], date: string): Day | null {
  for (let index = days.length - 1; index >= 0; index--) {
    const day = days[index];
    if (day.day <= date && (isNumber(day.sleep_minutes) || day.sleep_start)) return day;
  }
  return null;
}

export type MainStage = "deep" | "rem" | "light" | "awake";

export interface StageTotal {
  stage: MainStage;
  minutes: number | null;
  /** Share of the sleep (not of the time in bed); null for awake. */
  share: number | null;
}

/** Minutes per stage of the main sleep, deep first, from the day's totals. */
export function stageTotals(day: Day | null | undefined): StageTotal[] {
  const sleep = isNumber(day?.sleep_minutes) && (day?.sleep_minutes ?? 0) > 0 ? (day?.sleep_minutes as number) : null;
  const of = (minutes: number | null | undefined, withShare: boolean): Pick<StageTotal, "minutes" | "share"> => ({
    minutes: isNumber(minutes) ? minutes : null,
    share: withShare && isNumber(minutes) && sleep ? minutes / sleep : null,
  });
  return [
    { stage: "deep", ...of(day?.sleep_deep_min, true) },
    { stage: "rem", ...of(day?.sleep_rem_min, true) },
    { stage: "light", ...of(day?.sleep_light_min, true) },
    { stage: "awake", ...of(day?.sleep_awake_min, false) },
  ];
}

// ---------------------------------------------------------------------------------------
// Hypnogram

export interface StageBlock {
  stage: SleepStage;
  /** Epoch milliseconds. */
  start: number;
  end: number;
}

export interface SleepSession {
  start: number;
  end: number;
  blocks: StageBlock[];
  /** Minutes asleep: every stage except awake. */
  asleepMinutes: number;
  stageMinutes: Partial<Record<SleepStage, number>>;
}

function blocksOf(day: Day): StageBlock[] {
  return (day.sleep_timeline ?? [])
    .map((item) => ({ stage: item.stage, start: Date.parse(item.start), end: Date.parse(item.end) }))
    .filter((block) => !Number.isNaN(block.start) && !Number.isNaN(block.end) && block.end > block.start)
    .sort((a, b) => a.start - b.start);
}

function session(blocks: StageBlock[]): SleepSession {
  const merged: StageBlock[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (previous && previous.stage === block.stage && block.start <= previous.end) {
      previous.end = Math.max(previous.end, block.end);
    } else {
      merged.push({ ...block });
    }
  }
  const stageMinutes: Partial<Record<SleepStage, number>> = {};
  let asleep = 0;
  for (const block of merged) {
    const minutes = (block.end - block.start) / MINUTE_MS;
    stageMinutes[block.stage] = (stageMinutes[block.stage] ?? 0) + minutes;
    if (block.stage !== "awake") asleep += minutes;
  }
  return {
    start: merged[0].start,
    end: Math.max(...merged.map((block) => block.end)),
    blocks: merged,
    asleepMinutes: Math.round(asleep),
    stageMinutes,
  };
}

/**
 * The stage timeline of `day` split into the main sleep (the stretch between sleep_start and
 * sleep_end) and naps (everything else, grouped when less than 30 min apart). `main` is null
 * when the day sends no timeline for its main sleep.
 */
export function splitTimeline(day: Day | null | undefined): { main: SleepSession | null; naps: SleepSession[] } {
  if (!day) return { main: null, naps: [] };
  const blocks = blocksOf(day);
  const from = day.sleep_start ? Date.parse(day.sleep_start) : NaN;
  const to = day.sleep_end ? Date.parse(day.sleep_end) : NaN;
  const hasMain = !Number.isNaN(from) && !Number.isNaN(to) && to > from;
  const inMain = (block: StageBlock) => hasMain && block.start >= from - EDGE_MS && block.end <= to + EDGE_MS;

  const mainBlocks = blocks.filter(inMain);
  const napBlocks = blocks.filter((block) => !inMain(block) && block.stage !== "awake");
  const groups: StageBlock[][] = [];
  for (const block of napBlocks) {
    const group = groups[groups.length - 1];
    const lastEnd = group ? Math.max(...group.map((item) => item.end)) : -Infinity;
    if (group && block.start - lastEnd <= NAP_GAP_MINUTES * MINUTE_MS) group.push(block);
    else groups.push([block]);
  }
  return {
    main: mainBlocks.length ? session(mainBlocks) : null,
    naps: groups.map(session),
  };
}

export interface HourTick {
  /** Epoch milliseconds. */
  at: number;
  /** Local clock, "23:00". */
  label: string;
}

/** Whole local hours (every `step` minutes) between two instants, both ends included. */
export function hourTicks(start: number, end: number, timeZone: string, step: number = 60): HourTick[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || step <= 0) return [];
  const local = localMinutesOfDay(new Date(start).toISOString(), timeZone);
  const seconds = new Date(start).getUTCSeconds() * 1000 + new Date(start).getUTCMilliseconds();
  const offset = (step - (local % step)) % step;
  const first = start - seconds + offset * MINUTE_MS;
  const ticks: HourTick[] = [];
  for (let at = first, minutes = local + offset; at <= end; at += step * MINUTE_MS, minutes += step) {
    if (at < start) continue;
    const ofDay = ((minutes % 1440) + 1440) % 1440;
    ticks.push({ at, label: `${String(Math.floor(ofDay / 60)).padStart(2, "0")}:${String(ofDay % 60).padStart(2, "0")}` });
  }
  return ticks;
}

// ---------------------------------------------------------------------------------------
// Sleep need for tonight

export interface NeedPlan {
  /** The day whose evening it is; its sleep need is for the night that follows. */
  day: string;
  need: number | null;
  /** Usual wake-up on the next morning, minutes since local midnight. */
  wake: number | null;
  /** Suggested time to fall asleep, minutes since local midnight. */
  bedtime: number | null;
  strain: number | null;
  /** The day is still running, so its strain and therefore the need may still grow. */
  partial: boolean;
}

export function needTonight(days: Day[], timeZone: string, date: string): NeedPlan {
  const day = indexByDay(days).get(date) ?? null;
  const need = day?.scores?.sleep_need_minutes ?? null;
  const wake = typicalWake(days, timeZone, addDays(date, 1));
  return {
    day: date,
    need: isNumber(need) ? need : null,
    wake,
    bedtime: bedtimeFor(isNumber(need) ? need : null, wake),
    strain: isNumber(day?.scores?.strain) ? (day?.scores?.strain as number) : null,
    partial: day?.complete === false,
  };
}

// ---------------------------------------------------------------------------------------
// History

export interface NightPoint {
  /** The day the night ended on. */
  day: string;
  data: Day | null;
  minutes: number | null;
  /** The need set the evening before, which this night is measured against. */
  need: number | null;
  score: number | null;
  scoreNote: string | null;
  regularity: number | null;
}

/** One entry per day of the window ending at `end`, oldest first; missing days stay null. */
export function sleepHistory(days: Day[], end: string, nights: number, kind: SleepKind): NightPoint[] {
  const byDay = indexByDay(days);
  return dateRange(addDays(end, -(Math.max(1, Math.floor(nights)) - 1)), end).map((date) => {
    const data = byDay.get(date) ?? null;
    const need = byDay.get(addDays(date, -1))?.scores?.sleep_need_minutes;
    const score = sleepScoreOf(data, kind);
    const regularity = data?.scores?.sleep_regularity;
    return {
      day: date,
      data,
      minutes: isNumber(data?.sleep_minutes) ? (data?.sleep_minutes as number) : null,
      need: isNumber(need) ? need : null,
      score: scoreValue(score),
      scoreNote: score?.note ?? null,
      regularity: isNumber(regularity) ? regularity : null,
    };
  });
}

export interface NeedCoverage {
  /** Nights with both a duration and a need. */
  nights: number;
  covered: number;
  /** Mean shortfall over the nights that fell short, minutes. */
  shortfall: number | null;
  averageMinutes: number | null;
  averageNeed: number | null;
}

export function needCoverage(points: NightPoint[]): NeedCoverage {
  const paired = points.filter((point) => point.minutes !== null && point.need !== null) as (NightPoint & {
    minutes: number;
    need: number;
  })[];
  const short = paired.filter((point) => point.minutes < point.need);
  return {
    nights: paired.length,
    covered: paired.length - short.length,
    shortfall: average(short.map((point) => point.need - point.minutes)),
    averageMinutes: average(points.map((point) => point.minutes)),
    averageNeed: average(points.map((point) => point.need)),
  };
}

export interface ClockSummary {
  nights: number;
  /** Minutes since local midnight. */
  bedMean: number;
  bedEarliest: number;
  bedLatest: number;
  wakeMean: number;
  wakeEarliest: number;
  wakeLatest: number;
  /** Standard deviation of the bedtime, minutes. */
  bedSpread: number;
}

const fromNoon = (minutes: number) => (Math.round(minutes) + 720) % 1440;

/** Usual, earliest and latest bed and wake times of the nights in the window ending at `end`. */
export function clockSummary(days: Day[], timeZone: string, end: string, nights: number): ClockSummary | null {
  const from = addDays(end, -(Math.max(1, Math.floor(nights)) - 1));
  const recent = sleepNights(
    days.filter((day) => day.day >= from && day.day <= end),
    timeZone,
  );
  if (recent.length === 0) return null;
  const beds = recent.map((night) => night.bedMinutes);
  // Wake times in the same noon-based scale, so a wake-up after midnight never wraps.
  const wakes = recent.map(
    (night) => (localMinutesOfDay(night.end, timeZone) - 720 + 1440) % 1440,
  );
  const meanBed = average(beds) as number;
  return {
    nights: recent.length,
    bedMean: fromNoon(meanBed),
    bedEarliest: fromNoon(Math.min(...beds)),
    bedLatest: fromNoon(Math.max(...beds)),
    wakeMean: fromNoon(average(wakes) as number),
    wakeEarliest: fromNoon(Math.min(...wakes)),
    wakeLatest: fromNoon(Math.max(...wakes)),
    bedSpread: Math.round(Math.sqrt(average(beds.map((bed) => (bed - meanBed) ** 2)) as number)),
  };
}

// ---------------------------------------------------------------------------------------
// Sleep Regularity Index

/** Quintile limits of the SRI in UK Biobank (Windred 2024); the median is 81. */
export const SRI_QUINTILES = [71.7, 78.6, 83.2, 87.3] as const;
export const SRI_MEDIAN = 81;

export interface RegularityBand {
  /** 1 = least regular fifth of adults, 5 = most regular. */
  fifth: 1 | 2 | 3 | 4 | 5;
  label: string;
  text: string;
}

export function regularityBand(sri: number | null | undefined): RegularityBand | null {
  if (!isNumber(sri)) return null;
  if (sri >= SRI_QUINTILES[3]) {
    return { fifth: 5, label: "veľmi pravidelný", text: "Patríš medzi pätinu dospelých s najpravidelnejším spánkom." };
  }
  if (sri >= SRI_QUINTILES[2]) {
    return { fifth: 4, label: "pravidelný", text: "Spíš pravidelnejšie než väčšina dospelých." };
  }
  if (sri >= SRI_QUINTILES[1]) {
    return { fifth: 3, label: "priemerný", text: "Pravidelnosť je okolo bežnej hodnoty dospelých (medián 81)." };
  }
  if (sri >= SRI_QUINTILES[0]) {
    return { fifth: 2, label: "menej pravidelný", text: "Spíš o niečo nepravidelnejšie než väčšina dospelých." };
  }
  return {
    fifth: 1,
    label: "nepravidelný",
    text: "Patríš medzi pätinu dospelých s najmenej pravidelným spánkom. Pomáha zaspávať a vstávať v podobných časoch aj cez víkend.",
  };
}
