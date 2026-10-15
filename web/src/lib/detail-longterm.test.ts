import { describe, expect, it } from "vitest";

import { bodyAge, latestValue, longRecords, seriesChange, vo2maxLevel, vo2maxWeeks, weeklyMeans } from "./detail-longterm";
import { makeDay, makeScore, makeScores, makeWorkout } from "./test-fixtures";

const END = "2026-10-15"; // a Thursday

describe("weeklyMeans", () => {
  it("averages each week and drops leading weeks without values", () => {
    const days = [
      makeDay("2026-09-28", { hr_resting: 50 }),
      makeDay("2026-09-30", { hr_resting: 54 }),
      makeDay("2026-10-13", { hr_resting: 49 }),
    ];
    expect(weeklyMeans(days, END, (day) => day.hr_resting, 8)).toEqual([
      { week: "2026-09-28", value: 52 },
      { week: "2026-10-05", value: null },
      { week: "2026-10-12", value: 49 },
    ]);
  });

  it("is empty without values", () => {
    expect(weeklyMeans([makeDay(END)], END, (day) => day.hr_resting)).toEqual([]);
  });
});

describe("vo2maxWeeks", () => {
  it("lines up the watch and the estimate on the same weeks", () => {
    const days = [
      makeDay("2026-09-30", { scores: makeScores("2026-09-30", { vo2max_uth: 56 }) }),
      makeDay("2026-10-06", { scores: makeScores("2026-10-06", { vo2max: 48, vo2max_uth: 58 }) }),
      makeDay("2026-10-08", { scores: makeScores("2026-10-08", { vo2max: 49 }) }),
    ];
    expect(vo2maxWeeks(days, END)).toEqual([
      { week: "2026-09-28", watch: null, uth: 56 },
      { week: "2026-10-05", watch: 48.5, uth: 58 },
      { week: "2026-10-12", watch: null, uth: null },
    ]);
  });
});

describe("latestValue and seriesChange", () => {
  it("finds the latest value on or before the end", () => {
    const days = [
      makeDay("2026-10-10", { scores: makeScores("2026-10-10", { vo2max: 47 }) }),
      makeDay("2026-10-12", { scores: makeScores("2026-10-12") }),
      makeDay("2026-10-16", { scores: makeScores("2026-10-16", { vo2max: 50 }) }),
    ];
    expect(latestValue(days, END, (day) => day.scores?.vo2max)).toEqual({ value: 47, day: "2026-10-10" });
    expect(latestValue([], END, (day) => day.hr_resting)).toBeNull();
  });

  it("compares the last weeks with the first ones", () => {
    expect(seriesChange([56, 56, 55, 55, 53, 53, 52, 52], 2)).toBe(-4);
    expect(seriesChange([56, 55, 54], 2)).toBeNull();
    expect(seriesChange([null, null, 50, 50], 2)).toBeNull();
  });
});

describe("vo2maxLevel", () => {
  it("words the value for a 17-year-old male", () => {
    expect(vo2maxLevel(null)).toBeNull();
    expect(vo2maxLevel(42)).toBe("pod bežnou hodnotou");
    expect(vo2maxLevel(47)).toBe("bežná hodnota");
    expect(vo2maxLevel(52)).toBe("nad bežnou hodnotou");
    expect(vo2maxLevel(55)).toBe("výborná kondícia");
  });
});

describe("bodyAge", () => {
  it("reads the age back with owi's overlap factor and sorts younger first", () => {
    const components = { steps: -1, vo2max: -2, resting_hr: 1, sleep_duration: 0.5, lean_mass: null };
    // 17 + 0.45 × (−1.5) = 16.325, rounded by owi to 16.3
    const result = bodyAge(makeScore(16.3, components, "estimate"));
    expect(result).not.toBeNull();
    expect(result?.realAge).toBe(17);
    expect(result?.factor).toBe(0.45);
    expect(result?.difference).toBeCloseTo(-0.7, 5);
    expect(result?.contributions.map((item) => item.key)).toEqual(["vo2max", "steps", "sleep_duration", "resting_hr"]);
    expect(result?.contributions[0]).toMatchObject({ label: "VO2max", raw: -2 });
    expect(result?.contributions[0].share).toBeCloseTo(2 / 4.5, 5);
    expect(result?.contributions[0].years).toBeCloseTo(-0.9, 5);
    expect(result?.missing).toEqual(["svalová hmota"]);
    expect(result?.note).toBe("odhad");
  });

  it("falls back to factor 1 for scores built without the overlap factor", () => {
    const result = bodyAge(makeScore(15.8, { steps: -0.7, vo2max: -0.5 }, "estimate"));
    expect(result?.realAge).toBe(17);
    expect(result?.factor).toBe(1);
    expect(result?.contributions[0].years).toBeCloseTo(-0.7, 5);
  });

  it("keeps the parts when the value is missing", () => {
    const result = bodyAge(makeScore(null, { steps: 0.4, vo2max: null }, "too little history"));
    expect(result).toMatchObject({ value: null, realAge: null, difference: null, missing: ["VO2max"], note: "zatiaľ málo dát" });
    expect(result?.contributions).toHaveLength(1);
    expect(bodyAge(makeScore(null, {}, "age missing"))?.note).toBe("chýba vek");
    expect(bodyAge(null)).toBeNull();
  });
});

describe("longRecords", () => {
  it("adds strain, workout strain, distance, active time and VO2max to the overview records", () => {
    const days = [
      makeDay("2026-10-01", {
        steps: 12000,
        active_minutes_est: 140,
        scores: makeScores("2026-10-01", { strain: 15.2, vo2max: 49 }),
        workouts: [makeWorkout("a", { day: "2026-10-01", type: "cycling", duration_s: 5400, strain: 13.1, distance_m: 32000 })],
      }),
      makeDay("2026-10-15", {
        complete: false,
        steps: 30000,
        active_minutes_est: 300,
        scores: makeScores("2026-10-15", { strain: 18, vo2max: 50 }),
        workouts: [makeWorkout("b", { day: "2026-10-15", type: "running", duration_s: 1800, strain: 11, distance_m: 6000 })],
      }),
    ];
    const items = longRecords(days, END);
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey.steps).toMatchObject({ value: 12000, day: "2026-10-01" });
    expect(byKey.strain).toMatchObject({ value: 15.2, day: "2026-10-01" });
    expect(byKey.active).toMatchObject({ value: 140 });
    expect(byKey.workoutStrain).toMatchObject({ value: 13.1, type: "cycling" });
    expect(byKey.distance).toMatchObject({ value: 32000, type: "cycling" });
    expect(byKey.vo2max).toMatchObject({ value: 50, day: "2026-10-15" });
  });

  it("leaves days outside the window out", () => {
    const days = [makeDay("2026-07-01", { steps: 50000 }), makeDay("2026-10-10", { steps: 7000 })];
    expect(longRecords(days, END).find((item) => item.key === "steps")?.value).toBe(7000);
  });
});
