import { describe, expect, it } from "vitest";

import { addDays, dateRange } from "./dates";
import {
  nightHeartSeries,
  READINESS_PARTS,
  restingBaseline,
  restingComparison,
  restingTrend,
  signalNights,
  signalNightText,
  signalStatus,
} from "./detail-heart";
import { makeDay, makeScores } from "./test-fixtures";
import type { Day, NightSignal } from "./types";

const END = "2026-10-15";
const plain = (text: string) => text.replace(/\s/g, " ");

function signal(level: NightSignal["level"], night_hr: number | null, baseline: number | null, delta: number | null): NightSignal {
  return { level, night_hr, baseline, delta };
}

describe("READINESS_PARTS", () => {
  it("covers the seven parts with the documented weights (0.97 without HRV and temperature)", () => {
    expect(READINESS_PARTS).toHaveLength(7);
    expect(READINESS_PARTS.reduce((total, part) => total + part.weight, 0)).toBeCloseTo(0.97, 5);
    expect(READINESS_PARTS[0].key).toBe("sleep");
    expect(READINESS_PARTS.every((part) => part.explain.length > 10)).toBe(true);
  });
});

describe("restingBaseline", () => {
  const days = dateRange(addDays(END, -20), END).map((day, index) => makeDay(day, { hr_resting: index % 2 ? 52 : 54 }));

  it("averages the days before the date, not the date itself", () => {
    const withSpike = days.map((day) => (day.day === END ? { ...day, hr_resting: 90 } : day));
    const baseline = restingBaseline(withSpike, END, 60);
    expect(baseline?.mean).toBeCloseTo(53, 0);
    expect(baseline?.days).toBe(20);
    expect(baseline?.sd).toBeCloseTo(1);
  });

  it("needs a week of values", () => {
    expect(restingBaseline(days.slice(-5), END)).toBeNull();
    expect(restingBaseline([], END)).toBeNull();
  });

  it("never reports a spread under 1 bpm", () => {
    const flat = days.map((day) => ({ ...day, hr_resting: 50 }));
    expect(restingBaseline(flat, END)?.sd).toBe(1);
  });
});

describe("restingComparison", () => {
  const baseline = { mean: 53, sd: 2, days: 40 };

  it("says how far the value is from the usual and whether that is ordinary", () => {
    expect(plain(restingComparison(52, baseline))).toBe("O 1 bpm nižší než tvoj priemer 53 bpm za 40 dní. To je v rámci bežného kolísania.");
    expect(restingComparison(49, baseline)).toContain("dobré zotavenie");
    expect(restingComparison(58, baseline)).toContain("vyšší");
    expect(restingComparison(53.2, baseline)).toContain("Rovnaký");
  });

  it("explains a missing value or baseline", () => {
    expect(restingComparison(null, baseline)).toContain("chýba");
    expect(restingComparison(52, null)).toContain("málo dní");
  });
});

describe("signalStatus", () => {
  it("words a green night and a missing one", () => {
    expect(signalStatus(signal("green", 58.2, 57.9, 0.3))).toMatchObject({ level: "green", title: "Nočný tep je v norme" });
    expect(plain(signalStatus(signal("green", 58.2, 57.9, 0.3)).text)).toContain("Nočný tep 58 bpm, tvoj normál 58 bpm");
    expect(signalStatus(null).level).toBeNull();
    expect(signalStatus(signal(null, null, null, null)).level).toBeNull();
  });

  it("uses the overview's warning words for yellow and red", () => {
    expect(signalStatus(signal("red", 63, 58, 5)).level).toBe("red");
    expect(signalStatus(signal("yellow", 61, 58, 3)).title).toBe("Nočný tep bol vyšší než zvyčajne");
  });
});

describe("signalNights", () => {
  const levels: NightSignal["level"][] = ["green", "yellow", "green", "red", "red", null, "green"];
  const days: Day[] = levels.map((level, index) => {
    const day = addDays(END, index - (levels.length - 1));
    return makeDay(day, { scores: makeScores(day, { night_signal: signal(level, 60 + index, 57, level === "green" ? 1 : 4) }) });
  });

  it("lists yellow and red nights in the window, newest first", () => {
    const nights = signalNights([...days, makeDay("2026-01-01", { scores: makeScores("2026-01-01", { night_signal: signal("red", 70, 57, 13) }) })], END, 90);
    expect(nights.map((night) => [night.day, night.level])).toEqual([
      ["2026-10-13", "red"],
      ["2026-10-12", "red"],
      ["2026-10-10", "yellow"],
    ]);
  });

  it("describes a night in one line", () => {
    const [red] = signalNights(days, END);
    expect(plain(signalNightText(red))).toBe("Nočný tep 64 bpm, o 4 bpm nad normálom (57 bpm), druhá zvýšená noc po sebe.");
    expect(signalNightText({ day: END, level: "yellow", nightHr: null, baseline: null, delta: null })).toBe("Nočný tep nad normálom.");
  });

  it("gives the night heart rate and baseline for every day of a window", () => {
    const series = nightHeartSeries(days, END, 8);
    expect(series).toHaveLength(8);
    expect(series[0]).toEqual({ day: addDays(END, -7), nightHr: null, baseline: null, level: null });
    expect(series[7]).toMatchObject({ nightHr: 66, baseline: 57, level: "green" });
  });
});

describe("restingTrend", () => {
  it("compares the last week with the same week a period earlier", () => {
    const days = dateRange(addDays(END, -40), END).map((day) => makeDay(day, { hr_resting: day > addDays(END, -7) ? 50 : 54 }));
    const trend = restingTrend(days, END, 30);
    expect(trend.recent).toBe(50);
    expect(trend.before).toBe(54);
    expect(trend.change).toBe(-4);
    expect(restingTrend([], END, 30).change).toBeNull();
  });
});
