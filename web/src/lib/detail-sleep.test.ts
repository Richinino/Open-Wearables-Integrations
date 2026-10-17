import { describe, expect, it } from "vitest";

import { addDays, dateRange } from "./dates";
import {
  clockSummary,
  hourTicks,
  isSleepKind,
  lastNight,
  needCoverage,
  needTonight,
  regularityBand,
  sleepHistory,
  sleepScoreOf,
  SLEEP_KINDS,
  splitTimeline,
  stageTotals,
} from "./detail-sleep";
import { makeDay, makeScore, makeScores, ZONE } from "./test-fixtures";
import type { Day } from "./types";

const END = "2026-10-15"; // a Thursday; Bratislava is on UTC+2 until 25 October

function night(day: string, bed: string, wake: string, values: Partial<Day> = {}): Day {
  const previous = addDays(day, -1);
  const start = bed >= "12:00" ? `${previous}T${bed}:00+02:00` : `${day}T${bed}:00+02:00`;
  return makeDay(day, {
    sleep_start: new Date(start).toISOString(),
    sleep_end: new Date(`${day}T${wake}:00+02:00`).toISOString(),
    sleep_minutes: 420,
    ...values,
  });
}

describe("sleep kinds", () => {
  it("names the vendor and the scale of each part", () => {
    expect(SLEEP_KINDS.performance.vendor).toBe("WHOOP");
    expect(SLEEP_KINDS.apple.vendor).toBe("Apple");
    expect(SLEEP_KINDS.apple.parts.map((part) => part.max)).toEqual([50, 30, 20]);
    expect(SLEEP_KINDS.performance.parts.map((part) => part.key)).toEqual(["hours_vs_needed", "consistency", "efficiency"]);
  });

  it("accepts only the three stored values", () => {
    expect(isSleepKind("apple")).toBe(true);
    expect(isSleepKind("performance")).toBe(true);
    expect(isSleepKind("samsung")).toBe(true);
    expect(isSleepKind("whoop")).toBe(false);
    expect(isSleepKind(null)).toBe(false);
  });

  it("marks the Samsung score as an estimate whose parts owi names", () => {
    expect(SLEEP_KINDS.samsung).toMatchObject({ option: "Samsung (odhad)", vendor: "Samsung", estimate: true, onlyPresent: true, top: 90 });
    expect(SLEEP_KINDS.samsung.band(90)?.label).toBe("výborné");
    expect(SLEEP_KINDS.samsung.band(49)?.label).toBe("slabé");
  });

  it("picks the score of the chosen kind", () => {
    const day = makeDay(END, {
      scores: makeScores(END, { sleep_performance: makeScore(91), apple_sleep: makeScore(77), samsung_sleep: makeScore(83) }),
    });
    expect(sleepScoreOf(day, "performance")?.value).toBe(91);
    expect(sleepScoreOf(day, "apple")?.value).toBe(77);
    expect(sleepScoreOf(day, "samsung")?.value).toBe(83);
    expect(sleepScoreOf(makeDay(END), "apple")).toBeNull();
    expect(sleepScoreOf(null, "apple")).toBeNull();
    // Older responses have no Samsung score at all.
    expect(sleepScoreOf(makeDay(END, { scores: makeScores(END) }), "samsung")).toBeNull();
  });
});

describe("lastNight", () => {
  it("takes the latest day up to the date that has a main sleep", () => {
    const days = [night("2026-10-13", "23:00", "07:00"), makeDay("2026-10-14"), makeDay(END, { steps: 100 })];
    expect(lastNight(days, END)?.day).toBe("2026-10-13");
    expect(lastNight(days, "2026-10-12")).toBeNull();
  });
});

describe("stageTotals", () => {
  it("gives shares of the sleep for the three sleep stages and none for awake", () => {
    const totals = stageTotals(
      makeDay(END, { sleep_minutes: 400, sleep_deep_min: 80, sleep_rem_min: 100, sleep_light_min: 220, sleep_awake_min: 15 }),
    );
    expect(totals.map((item) => item.stage)).toEqual(["deep", "rem", "light", "awake"]);
    expect(totals[0].share).toBeCloseTo(0.2);
    expect(totals[1].share).toBeCloseTo(0.25);
    expect(totals[3]).toEqual({ stage: "awake", minutes: 15, share: null });
  });

  it("keeps missing stages null instead of zero", () => {
    const totals = stageTotals(makeDay(END, { sleep_minutes: 400 }));
    expect(totals.every((item) => item.minutes === null && item.share === null)).toBe(true);
    expect(stageTotals(null).every((item) => item.minutes === null)).toBe(true);
  });
});

describe("splitTimeline", () => {
  const day = makeDay(END, {
    sleep_start: "2026-10-14T21:00:00Z",
    sleep_end: "2026-10-15T05:00:00Z",
    sleep_timeline: [
      { start: "2026-10-14T21:00:00Z", end: "2026-10-14T22:00:00Z", stage: "light" },
      { start: "2026-10-14T22:00:00Z", end: "2026-10-14T23:00:00Z", stage: "deep" },
      { start: "2026-10-14T23:00:00Z", end: "2026-10-14T23:30:00Z", stage: "deep" },
      { start: "2026-10-15T02:00:00Z", end: "2026-10-15T02:10:00Z", stage: "awake" },
      { start: "2026-10-15T02:10:00Z", end: "2026-10-15T05:00:00Z", stage: "rem" },
      // Two naps in the afternoon: 12:00-12:20 and 12:40-12:50 belong together, 15:00 apart.
      { start: "2026-10-15T12:00:00Z", end: "2026-10-15T12:20:00Z", stage: "light" },
      { start: "2026-10-15T12:40:00Z", end: "2026-10-15T12:50:00Z", stage: "light" },
      { start: "2026-10-15T15:00:00Z", end: "2026-10-15T15:25:00Z", stage: "asleep" },
      // Broken entries are dropped.
      { start: "2026-10-15T16:00:00Z", end: "2026-10-15T15:00:00Z", stage: "light" },
      { start: "nonsense", end: "2026-10-15T15:00:00Z", stage: "light" },
    ],
  });

  it("keeps the main sleep apart and merges touching stretches of one stage", () => {
    const { main } = splitTimeline(day);
    expect(main).not.toBeNull();
    expect(main?.blocks.map((block) => block.stage)).toEqual(["light", "deep", "awake", "rem"]);
    expect(main?.stageMinutes.deep).toBe(90);
    expect(main?.asleepMinutes).toBe(60 + 90 + 170);
    expect(main?.start).toBe(Date.parse("2026-10-14T21:00:00Z"));
    expect(main?.end).toBe(Date.parse("2026-10-15T05:00:00Z"));
  });

  it("groups naps less than 30 minutes apart", () => {
    const { naps } = splitTimeline(day);
    expect(naps).toHaveLength(2);
    expect(naps[0].asleepMinutes).toBe(30);
    expect(naps[0].end).toBe(Date.parse("2026-10-15T12:50:00Z"));
    expect(naps[1].asleepMinutes).toBe(25);
  });

  it("treats everything as naps when the day has no main sleep, and handles no timeline", () => {
    const napOnly = makeDay(END, { sleep_timeline: day.sleep_timeline?.slice(5) });
    expect(splitTimeline(napOnly).main).toBeNull();
    expect(splitTimeline(napOnly).naps).toHaveLength(2);
    expect(splitTimeline(makeDay(END))).toEqual({ main: null, naps: [] });
    expect(splitTimeline(null)).toEqual({ main: null, naps: [] });
  });
});

describe("hourTicks", () => {
  it("puts ticks on whole local hours inside the span", () => {
    // 23:12 to 06:56 local time.
    const ticks = hourTicks(Date.parse("2026-10-14T21:12:00Z"), Date.parse("2026-10-15T04:56:00Z"), ZONE);
    expect(ticks.map((tick) => tick.label)).toEqual(["00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00"]);
    expect(ticks[0].at).toBe(Date.parse("2026-10-14T22:00:00Z"));
  });

  it("can step by two hours and includes an exact start", () => {
    const ticks = hourTicks(Date.parse("2026-10-14T20:00:00Z"), Date.parse("2026-10-15T04:00:00Z"), ZONE, 120);
    expect(ticks.map((tick) => tick.label)).toEqual(["22:00", "00:00", "02:00", "04:00", "06:00"]);
  });

  it("returns nothing for an empty or reversed span", () => {
    expect(hourTicks(10, 10, ZONE)).toEqual([]);
    expect(hourTicks(20, 10, ZONE)).toEqual([]);
  });
});

describe("needTonight", () => {
  it("suggests a bedtime from the need and the usual wake-up of that kind of day", () => {
    // Four school-day nights waking at 06:30; the 16th is a Friday, a school day.
    const days = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"].map((day) => night(day, "22:30", "06:30"));
    days.push(makeDay(END, { complete: false, scores: makeScores(END, { sleep_need_minutes: 510, strain: 9.4 }) }));
    const plan = needTonight(days, ZONE, END);
    expect(plan.need).toBe(510);
    expect(plan.wake).toBe(6 * 60 + 30);
    // 06:30 − 8 h 30 min − 15 min to fall asleep = 21:45.
    expect(plan.bedtime).toBe(21 * 60 + 45);
    expect(plan.strain).toBe(9.4);
    expect(plan.partial).toBe(true);
  });

  it("stays empty without a need", () => {
    const plan = needTonight([makeDay(END)], ZONE, END);
    expect(plan).toMatchObject({ need: null, bedtime: null, strain: null, partial: false });
  });
});

describe("sleepHistory and needCoverage", () => {
  const days = dateRange("2026-10-10", END).map((day, index) =>
    makeDay(day, {
      sleep_minutes: index === 2 ? null : 420 + index * 10,
      scores: makeScores(day, {
        sleep_need_minutes: 480,
        sleep_performance: makeScore(index === 2 ? null : 80 + index, {}, index === 2 ? "no sleep recorded" : null),
        apple_sleep: makeScore(70),
        sleep_regularity: 82,
      }),
    }),
  );

  it("lists every night of the window with the need set the evening before", () => {
    const points = sleepHistory(days, END, 7, "performance");
    expect(points.map((point) => point.day)).toEqual(dateRange("2026-10-09", END));
    expect(points[0]).toMatchObject({ data: null, minutes: null, need: null, score: null });
    expect(points[1]).toMatchObject({ minutes: 420, need: null, score: 80 });
    expect(points[2]).toMatchObject({ minutes: 430, need: 480, score: 81 });
    expect(points[3]).toMatchObject({ minutes: null, score: null, scoreNote: "no sleep recorded" });
    expect(sleepHistory(days, END, 7, "apple")[2].score).toBe(70);
  });

  it("counts covered nights and the mean shortfall of the rest", () => {
    const coverage = needCoverage(sleepHistory(days, END, 7, "performance"));
    // Nights with a need: 11th (430), 13th (450), 14th (460), 15th (470): none reach 480.
    expect(coverage.nights).toBe(4);
    expect(coverage.covered).toBe(0);
    expect(coverage.shortfall).toBeCloseTo((50 + 30 + 20 + 10) / 4);
    expect(coverage.averageNeed).toBe(480);
  });
});

describe("clockSummary", () => {
  it("keeps bedtimes on both sides of midnight together", () => {
    const days = [
      night("2026-10-13", "23:30", "06:40"),
      night("2026-10-14", "00:30", "07:00"),
      night(END, "23:00", "06:20"),
    ];
    const summary = clockSummary(days, ZONE, END, 14);
    expect(summary).not.toBeNull();
    expect(summary?.nights).toBe(3);
    expect(summary?.bedEarliest).toBe(23 * 60);
    expect(summary?.bedLatest).toBe(30);
    expect(summary?.bedMean).toBe(23 * 60 + 40);
    expect(summary?.wakeEarliest).toBe(6 * 60 + 20);
    expect(summary?.wakeLatest).toBe(7 * 60);
    expect(summary?.wakeMean).toBe(6 * 60 + 40);
  });

  it("is null without nights in the window", () => {
    expect(clockSummary([night("2026-09-01", "23:00", "07:00")], ZONE, END, 14)).toBeNull();
  });
});

describe("regularityBand", () => {
  it("places the index among the fifths of adults", () => {
    expect(regularityBand(90)?.fifth).toBe(5);
    expect(regularityBand(87.3)?.fifth).toBe(5);
    expect(regularityBand(85)?.label).toBe("pravidelný");
    expect(regularityBand(81)?.fifth).toBe(3);
    expect(regularityBand(75)?.fifth).toBe(2);
    expect(regularityBand(60)?.label).toBe("nepravidelný");
    expect(regularityBand(null)).toBeNull();
  });
});
