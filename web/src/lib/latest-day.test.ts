import { describe, expect, it } from "vitest";

import { ageLabel, hasDayData, latestDay } from "./latest-day";
import { makeDay, makeWorkout } from "./test-fixtures";

const TODAY = "2026-10-15";

describe("hasDayData", () => {
  it("needs steps, sleep or a workout", () => {
    expect(hasDayData(null)).toBe(false);
    expect(hasDayData(makeDay(TODAY))).toBe(false);
    expect(hasDayData(makeDay(TODAY, { steps: 0, sleep_minutes: null, hr_resting: 52 }))).toBe(false);
    expect(hasDayData(makeDay(TODAY, { steps: 14 }))).toBe(true);
    expect(hasDayData(makeDay(TODAY, { sleep_minutes: 420 }))).toBe(true);
    expect(hasDayData(makeDay(TODAY, { workouts: [makeWorkout("w")] }))).toBe(true);
  });
});

describe("latestDay", () => {
  const yesterday = makeDay("2026-10-14", { steps: 9000, sleep_minutes: 430 });

  it("keeps today when it has data of its own, even partial", () => {
    const today = makeDay(TODAY, { complete: false, steps: 800 });
    expect(latestDay([yesterday, today], TODAY, TODAY)).toEqual({ day: today, date: TODAY, fallback: false, label: null });
    const sleptOnly = makeDay(TODAY, { complete: false, steps: 0, sleep_minutes: 400 });
    expect(latestDay([yesterday, sleptOnly], TODAY, TODAY).day).toBe(sleptOnly);
  });

  it("falls back to yesterday while today is still an empty shell", () => {
    const empty = makeDay(TODAY, { complete: false, steps: 0, hr_resting: 51 });
    expect(latestDay([yesterday, empty], TODAY, TODAY)).toEqual({
      day: yesterday,
      date: "2026-10-14",
      fallback: true,
      label: "posledné dáta: včera",
    });
  });

  it("falls back when today is missing altogether", () => {
    expect(latestDay([yesterday], TODAY, TODAY)).toMatchObject({ date: "2026-10-14", fallback: true });
  });

  it("skips earlier empty days and words older data by its date", () => {
    const older = makeDay("2026-10-11", { steps: 5000 });
    const days = [older, makeDay("2026-10-13"), makeDay(TODAY)];
    expect(latestDay(days, TODAY, TODAY)).toMatchObject({
      date: "2026-10-11",
      fallback: true,
      label: "posledné dáta: ne 11. 10.",
    });
  });

  it("never looks past the focus day", () => {
    const later = makeDay("2026-10-16", { steps: 100 });
    expect(latestDay([yesterday, later], "2026-10-14", TODAY)).toMatchObject({ date: "2026-10-14", fallback: false });
  });

  it("keeps the empty focus day when nothing earlier has data", () => {
    const empty = makeDay(TODAY);
    expect(latestDay([empty], TODAY, TODAY)).toEqual({ day: empty, date: TODAY, fallback: false, label: null });
    expect(latestDay([], TODAY, TODAY)).toEqual({ day: null, date: TODAY, fallback: false, label: null });
  });
});

describe("ageLabel", () => {
  it("words the age of the shown day", () => {
    expect(ageLabel(TODAY, TODAY)).toBe("dnes");
    expect(ageLabel("2026-10-14", TODAY)).toBe("včera");
    expect(ageLabel("2026-10-13", TODAY)).toBe("predvčerom");
    expect(ageLabel("2026-10-12", TODAY)).toBe("po 12. 10.");
  });
});
