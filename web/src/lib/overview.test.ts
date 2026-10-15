import { describe, expect, it } from "vitest";

import { addDays, dateRange, weekdayIndex } from "./dates";
import {
  barRange,
  heatmap,
  heatmapNote,
  heatValue,
  insights,
  nightWeekday,
  records,
  sleepSegments,
  sleepWindow,
  weekCards,
} from "./overview";
import { makeDay, makeScores, makeWorkout, ZONE } from "./test-fixtures";
import type { Day } from "./types";

const END = "2026-10-15"; // a Thursday
const plain = (text: string) => text.replace(/\s/g, " ");

/** `count` days ending at END, built by `values(day, index)`. */
function run(count: number, values: (day: string, index: number) => Partial<Day>): Day[] {
  return dateRange(addDays(END, -(count - 1)), END).map((day, index) => makeDay(day, values(day, index)));
}

describe("heatValue", () => {
  it("leaves out running totals of an unfinished day but keeps its sleep and heart rate", () => {
    const running = makeDay(END, { complete: false, steps: 3000, active_minutes_est: 20, sleep_minutes: 400, hr_resting: 50 });
    expect(heatValue(running, "steps")).toBeNull();
    expect(heatValue(running, "active")).toBeNull();
    expect(heatValue(running, "sleep")).toBe(400);
    expect(heatValue(running, "resting")).toBe(50);
    expect(heatValue(undefined, "steps")).toBeNull();
  });
});

describe("heatmap", () => {
  const days = run(84, (day, index) => ({ steps: (index + 1) * 100 }));

  it("lays out whole weeks, Monday first, the last one holding the end day", () => {
    const map = heatmap(days, END, "steps");
    expect(map.cells).toHaveLength(84);
    expect(map.first).toBe("2026-07-27");
    expect(weekdayIndex(map.first)).toBe(0);
    expect(map.last).toBe("2026-10-18");
    expect(map.cells[0].day).toBe(map.first);
    expect(map.cells[6].day).toBe("2026-08-02");
    expect(map.cells[83].day).toBe(map.last);
  });

  it("marks the days after the end as future and empty", () => {
    const future = heatmap(days, END, "steps").cells.filter((cell) => cell.future);
    expect(future.map((cell) => cell.day)).toEqual(["2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(future.every((cell) => cell.value === null && cell.level === 0)).toBe(true);
  });

  it("splits the window's values into quartiles and keeps level 0 for missing days", () => {
    const withGap = days.filter((day) => day.day !== "2026-09-01");
    const map = heatmap(withGap, END, "steps");
    const cell = (day: string) => map.cells.find((item) => item.day === day)!;
    expect(cell("2026-09-01")).toMatchObject({ value: null, level: 0, future: false });
    expect(cell("2026-07-27").level).toBe(1);
    expect(cell(END).level).toBe(4);
    const levels = map.cells.filter((item) => item.value !== null).map((item) => item.level);
    for (const level of [1, 2, 3, 4]) expect(levels.filter((item) => item === level).length).toBeGreaterThan(15);
    expect(map.average).toBeCloseTo(
      withGap.filter((day) => day.day >= map.first).reduce((sum, day) => sum + day.steps!, 0) / 80,
      5,
    );
  });

  it("marks an unfinished day as running for running totals only", () => {
    const withRunning = [...days.slice(0, -1), { ...days[days.length - 1], complete: false, sleep_minutes: 400 }];
    const steps = heatmap(withRunning, END, "steps").cells.find((cell) => cell.day === END)!;
    expect(steps).toMatchObject({ value: null, level: 0, running: true });
    const sleep = heatmap(withRunning, END, "sleep").cells.find((cell) => cell.day === END)!;
    expect(sleep).toMatchObject({ value: 400, running: false });
  });

  it("is empty without data", () => {
    const map = heatmap([], END, "sleep");
    expect(map.average).toBeNull();
    expect(map.thresholds).toBeNull();
    expect(map.cells.every((cell) => cell.level === 0)).toBe(true);
    expect(heatmapNote(map)).toBe("za 12 týždňov zatiaľ bez dát");
  });
});

describe("heatmapNote", () => {
  it("names the busiest weekday for steps", () => {
    const days = run(84, (day) => ({ steps: weekdayIndex(day) === 5 ? 20000 : 8000 }));
    expect(heatmapNote(heatmap(days, END, "steps"))).toBe("krokov za deň · najviac bývajú soboty");
    expect(heatmapNote(heatmap(days, END, "active"))).toBe("za 12 týždňov zatiaľ bez dát");
  });

  it("names the shortest night, counted from the evening it starts", () => {
    // Sleep that ends on Saturday morning is the night from Friday to Saturday.
    const days = run(84, (day) => ({ sleep_minutes: weekdayIndex(day) === 5 ? 300 : 450 }));
    expect(heatmapNote(heatmap(days, END, "sleep"))).toBe("za noc · najkratšie spíš v noci z piatka na sobotu");
  });

  it("says how the resting heart rate moved over the weeks", () => {
    const falling = run(84, (_day, index) => ({ hr_resting: 58 - index / 14 }));
    expect(heatmapNote(heatmap(falling, END, "resting"))).toMatch(/^priemer · za 12 týždňov klesol o \d bpm$/);
    const flat = run(84, () => ({ hr_resting: 52 }));
    expect(heatmapNote(heatmap(flat, END, "resting"))).toBe("priemer · za 12 týždňov sa nezmenil");
  });
});

describe("records", () => {
  const days = run(100, (day, index) => ({
    steps: index === 5 ? 30000 : index === 50 ? 24000 : 9000,
    sleep_minutes: index === 60 ? 540 : 420,
    hr_resting: index === 70 ? 46 : 52,
    scores: makeScores(day, { day_score: index === 80 ? 92 : 70 }),
    workouts:
      index === 90
        ? [makeWorkout("long", { day, type: "cycling", duration_s: 9000 })]
        : [makeWorkout(`w${index}`, { day, duration_s: 1800 })],
  }));
  days[99] = { ...days[99], complete: false, steps: 40000 };

  it("finds the bests of the last 90 days", () => {
    const found = records(days, END);
    expect(found.map((item) => item.key)).toEqual(["steps", "sleep", "resting", "workout", "dayScore"]);
    const byKey = Object.fromEntries(found.map((item) => [item.key, item]));
    // Day 5 is older than 90 days and the unfinished day does not count for steps.
    expect(byKey.steps).toEqual({ key: "steps", value: 24000, day: days[50].day });
    expect(byKey.sleep.day).toBe(days[60].day);
    expect(byKey.resting).toEqual({ key: "resting", value: 46, day: days[70].day });
    expect(byKey.workout).toEqual({ key: "workout", value: 9000, day: days[90].day, type: "cycling" });
    expect(byKey.dayScore.value).toBe(92);
  });

  it("keeps the earlier day on a tie and skips what is missing", () => {
    const tie = run(5, () => ({ steps: 5000 }));
    expect(records(tie, END)).toEqual([{ key: "steps", value: 5000, day: tie[0].day }]);
    expect(records([], END)).toEqual([]);
  });
});

describe("weekCards", () => {
  it("covers the seven days ending at the end day", () => {
    const days = run(40, (day, index) => ({
      steps: index === 39 ? 5000 : 10000,
      sleep_minutes: 420,
      scores: makeScores(day, { day_score: 75 }),
      workouts: index === 38 ? [makeWorkout("a", { type: "walking", duration_s: 1200 }), makeWorkout("b", { duration_s: 3000 })] : [],
    }));
    const cards = weekCards(days.filter((day) => day.day !== addDays(END, -3)), END);
    expect(cards.map((card) => card.day)).toEqual(dateRange(addDays(END, -6), END));
    expect(cards[6]).toMatchObject({ steps: 5000, stepsShare: 0.5, sleepMinutes: 420, dayScore: 75, workout: null });
    expect(cards[5].workout).toEqual({ type: "running", minutes: 50 });
    expect(cards[5].stepsShare).toBe(1);
    expect(cards[3]).toMatchObject({ data: null, steps: null, stepsShare: null, dayScore: null });
  });
});

describe("sleepSegments", () => {
  const night = {
    sleep_start: "2026-10-14T21:00:00+00:00",
    sleep_end: "2026-10-15T05:00:00+00:00",
    sleep_deep_min: 90,
    sleep_rem_min: 100,
    sleep_light_min: 270,
    sleep_awake_min: 20,
  };

  it("follows the timeline, merges repeats and drops what lies outside the main sleep", () => {
    const day = makeDay(END, {
      ...night,
      sleep_timeline: [
        { start: "2026-10-14T13:00:00+00:00", end: "2026-10-14T13:30:00+00:00", stage: "asleep" },
        { start: "2026-10-14T21:00:00+00:00", end: "2026-10-14T21:30:00+00:00", stage: "light" },
        { start: "2026-10-14T21:30:00+00:00", end: "2026-10-14T22:00:00+00:00", stage: "light" },
        { start: "2026-10-14T22:00:00+00:00", end: "2026-10-14T23:00:00+00:00", stage: "deep" },
        { start: "2026-10-14T23:00:00+00:00", end: "2026-10-14T23:05:00+00:00", stage: "awake" },
        { start: "2026-10-14T23:05:00+00:00", end: "2026-10-14T23:05:00+00:00", stage: "rem" },
      ],
    });
    expect(sleepSegments(day)).toEqual([
      { stage: "light", minutes: 60 },
      { stage: "deep", minutes: 60 },
      { stage: "awake", minutes: 5 },
    ]);
  });

  it("falls back to one block per stage, and to nothing", () => {
    expect(sleepSegments(makeDay(END, night))).toEqual([
      { stage: "light", minutes: 270 },
      { stage: "deep", minutes: 90 },
      { stage: "rem", minutes: 100 },
      { stage: "awake", minutes: 20 },
    ]);
    expect(sleepSegments(makeDay(END))).toEqual([]);
    expect(sleepSegments(null)).toEqual([]);
  });
});

describe("sleepWindow", () => {
  it("averages bedtime and wake-up of recent nights, with the bedtime spread", () => {
    // 23:00 and 23:40 local bedtimes (UTC+2), up at 07:00.
    const days = run(4, (day, index) => ({
      sleep_start: `${addDays(day, -1)}T${index % 2 ? "21:40" : "21:00"}:00+00:00`,
      sleep_end: `${day}T05:00:00+00:00`,
      sleep_minutes: 420,
    }));
    expect(sleepWindow(days, ZONE, END)).toEqual({ bedtime: 23 * 60 + 20, wake: 7 * 60, spread: 20, nights: 4 });
    expect(sleepWindow(days.slice(0, 2), ZONE, END)).toBeNull();
  });
});

describe("nightWeekday", () => {
  it("is the weekday the night started on", () => {
    expect(nightWeekday("2026-10-17")).toBe(4); // Saturday morning: Friday's night
    expect(nightWeekday("2026-10-12")).toBe(6); // Monday morning: Sunday's night
  });
});

describe("insights", () => {
  const days = run(40, (day, index) => {
    const weekday = weekdayIndex(day);
    return {
      steps: weekday >= 5 ? 16000 : 10000,
      // Saturday mornings end the short night from Friday.
      sleep_minutes: weekday === 5 ? 330 : 450,
      hr_resting: 56 - index * 0.12,
    };
  });

  it("compares weekend and weekday steps", () => {
    const found = insights(days, END).find((item) => item.key === "weekendSteps")!;
    expect(found.text).toBe("Cez víkendy prejdeš o 60 % viac než v pracovné dni.");
    expect(plain(found.detail)).toBe("16 000 oproti 10 000 krokom");
    expect(found.bars.map((bar) => bar.highlight)).toEqual([false, false, false, false, false, true, true]);
    expect(found.href).toBe("/kroky");
  });

  it("names the shortest night", () => {
    const found = insights(days, END).find((item) => item.key === "shortNight")!;
    expect(found.text).toBe("Najkratšie spíš v noci z piatka na sobotu, priemerne 5 h 30 min.");
    expect(found.detail).toBe("ostatné noci 7 h 30 min");
    expect(found.bars.findIndex((bar) => bar.highlight)).toBe(4);
  });

  it("follows the resting heart rate over a month", () => {
    const found = insights(days, END).find((item) => item.key === "restingTrend")!;
    expect(found.text).toBe("Pokojový tep ti za mesiac klesol o 4 bpm.");
    expect(found.detail).toMatch(/^z 55 na 52 · /);
    expect(found.bars).toHaveLength(8);
    expect(found.bars[7].highlight).toBe(true);
  });

  it("says when things are even and stays silent without enough data", () => {
    const even = run(40, () => ({ steps: 9000, sleep_minutes: 440, hr_resting: 52 }));
    const texts = insights(even, END).map((item) => item.text);
    expect(texts).toEqual([
      "Cez víkendy a v pracovné dni prejdeš zhruba rovnako.",
      "Spíš podobne dlho každú noc, okolo 7 h 20 min.",
      "Pokojový tep je za mesiac stabilný, okolo 52 bpm.",
    ]);
    expect(insights(run(5, () => ({ steps: 9000 })), END)).toEqual([]);
  });

  it("gives the bars a common range", () => {
    expect(barRange([{ value: 3 }, { value: null }, { value: 9 }])).toEqual({ low: 3, high: 9 });
  });
});
