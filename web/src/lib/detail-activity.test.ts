import { describe, expect, it } from "vitest";

import { addDays, dateRange } from "./dates";
import {
  ACTIVITY_PARTS,
  bestStepDays,
  cardioText,
  cardioTrend,
  cardioWeeks,
  finishedSteps,
  STRAIN_BANDS,
  stepsCategory,
  stepsStats,
  weekdaySteps,
  weekendShare,
  zoneTotals,
} from "./detail-activity";
import { makeDay, makeScores } from "./test-fixtures";
import type { Day } from "./types";

const END = "2026-10-15"; // a Thursday

describe("parts and bands", () => {
  it("covers the six Activity parts with weights adding up to one", () => {
    expect(ACTIVITY_PARTS).toHaveLength(6);
    expect(ACTIVITY_PARTS.reduce((total, part) => total + part.weight, 0)).toBeCloseTo(1, 5);
  });

  it("splits the strain scale without gaps", () => {
    expect(STRAIN_BANDS[0].from).toBe(0);
    expect(STRAIN_BANDS[STRAIN_BANDS.length - 1].to).toBe(21);
    STRAIN_BANDS.slice(1).forEach((band, index) => expect(band.from).toBe(STRAIN_BANDS[index].to));
  });

  it("words every cardio status, including recovering", () => {
    expect(cardioText("productive")).toContain("forma zlepšuje");
    expect(cardioText("recovering")).toContain("zotavuje");
    expect(cardioText(null)).toBeNull();
  });
});

describe("cardioTrend and cardioWeeks", () => {
  const days: Day[] = dateRange(addDays(END, -20), END).map((day, index) =>
    makeDay(day, {
      scores: makeScores(day, {
        cardio_load: index === 20 ? { strain_7d: null, tolerance_28d: null, ratio: null, status: null } : { strain_7d: 100 + index, tolerance_28d: 100, ratio: 1 + index / 100, status: "productive" },
      }),
    }),
  );

  it("gives one point per day, missing days as null", () => {
    const trend = cardioTrend(days, END, 28);
    expect(trend).toHaveLength(28);
    expect(trend[0]).toEqual({ day: addDays(END, -27), ratio: null, strain7: null, tolerance28: null, status: null });
    expect(trend[26]).toMatchObject({ ratio: 1.19, strain7: 119, status: "productive" });
    expect(trend[27].ratio).toBeNull();
  });

  it("takes the last known value of each week, newest first", () => {
    const weeks = cardioWeeks(cardioTrend(days, END, 28));
    expect(weeks.map((week) => week.day)).toEqual([addDays(END, -1), addDays(END, -7), addDays(END, -14)]);
  });
});

describe("zoneTotals", () => {
  it("adds up the zones of the window and counts days with zone data", () => {
    const days = [
      makeDay(addDays(END, -8), { zone_light_min: 500, zone_moderate_min: 500, zone_vigorous_min: 500 }),
      makeDay(addDays(END, -1), { zone_light_min: 40, zone_moderate_min: 10, zone_vigorous_min: 2 }),
      makeDay(END, { zone_light_min: 20, zone_moderate_min: null, zone_vigorous_min: 5 }),
      makeDay(addDays(END, -2)),
    ];
    expect(zoneTotals(days, END, 7)).toEqual({ light: 60, moderate: 10, vigorous: 7, days: 2 });
    expect(zoneTotals([makeDay(END)], END, 7)).toBeNull();
  });
});

describe("steps", () => {
  const days: Day[] = dateRange(addDays(END, -13), END).map((day, index) =>
    makeDay(day, {
      steps: index === 3 ? null : 5000 + index * 500,
      distance_m_est: index === 3 ? null : (5000 + index * 500) * 0.7,
      complete: day !== END,
    }),
  );

  it("places a day among Tudor-Locke's categories", () => {
    expect(stepsCategory(4000)?.label).toBe("sedavý");
    expect(stepsCategory(7500)?.label).toBe("čiastočne aktívny");
    expect(stepsCategory(12_500)?.label).toBe("veľmi aktívny");
    expect(stepsCategory(null)).toBeNull();
  });

  it("leaves out the running day and missing steps", () => {
    expect(finishedSteps(days[days.length - 1])).toBeNull();
    expect(finishedSteps(days[3])).toBeNull();
    expect(finishedSteps(days[0])).toBe(5000);
    const stats = stepsStats(days, END, 14);
    // Finished days with steps: indexes 0-12 without 3.
    expect(stats.days).toBe(12);
    const expected = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((index) => 5000 + index * 500);
    expect(stats.average).toBeCloseTo(expected.reduce((a, b) => a + b, 0) / 12);
    expect(stats.distance).toBeCloseTo(expected.reduce((a, b) => a + b, 0) * 0.7);
  });

  it("ranks the best finished days, earlier first on a tie", () => {
    const best = bestStepDays([...days, makeDay(addDays(END, -20), { steps: 11000 })], END, 30, 3);
    expect(best.map((item) => [item.day, item.steps])).toEqual([
      [addDays(END, -20), 11000],
      [addDays(END, -1), 11000],
      [addDays(END, -2), 10500],
    ]);
  });

  it("averages each weekday and compares the weekend with working days", () => {
    const pattern = weekdaySteps(days, END, 14);
    expect(pattern).toHaveLength(7);
    expect(pattern.every((item) => item.days <= 2)).toBe(true);
    // Monday 5 Oct has no steps, so Mondays rest on 12 Oct alone.
    expect(pattern[0]).toEqual({ weekday: 0, average: 10000, days: 1 });
    const share = weekendShare(pattern);
    expect(share).not.toBeNull();
    expect(weekendShare(pattern.map((item) => ({ ...item, average: null })))).toBeNull();
  });
});


describe("distance totals independent of steps", () => {
  const measured = makeDay(END, { distance_m: 2400, distance_m_est: 9999, steps: null });
  it("includes completed measured-distance-only days without changing step statistics", () => {
    expect(stepsStats([measured], END, 7)).toEqual({ average: null, days: 0, total: null, distance: 2400, distanceAverage: 2400 });
  });
  it.each([7, 30])("combines measured and estimated distances in %s-day windows", (length) => {
    const days = [measured,
      makeDay(addDays(END, -1), { steps: 5000, distance_m_est: 3500 }),
      makeDay(addDays(END, -2), { steps: 6000, distance_m: 4100, distance_m_est: 9999 }),
      makeDay(addDays(END, -3), { complete: false, distance_m: 9000 }),
      makeDay(addDays(END, -length), { distance_m: 9999 }),
      makeDay(addDays(END, 1), { distance_m: 9999 }),
    ];
    expect(stepsStats(days, END, length)).toEqual({ average: 5500, days: 2, total: 11000, distance: 10000, distanceAverage: 10000 / 3 });
  });
});
