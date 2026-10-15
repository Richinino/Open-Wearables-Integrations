import { describe, expect, it } from "vitest";

import {
  adjacentPeriod,
  averagesTitle,
  calendarCells,
  latestDataDay,
  monthTitle,
  periodAverages,
  periodOf,
  periodRange,
  periodsWithData,
  selectionIn,
  trainingWeeks,
  weekStartOf,
  weekTitle,
} from "./calendar";
import { makeDay, makeScores, makeWorkout } from "./test-fixtures";

const TODAY = "2026-10-15"; // a Thursday

describe("periods", () => {
  it("finds the Monday of a week and the month of a day", () => {
    expect(weekStartOf("2026-10-15")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-12")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-18")).toBe("2026-10-12");
    expect(periodOf("month", "2026-10-15")).toBe("2026-10");
    expect(periodOf("week", "2026-11-01")).toBe("2026-10-26");
  });

  it("gives the first and last day of a month and of a week", () => {
    expect(periodRange("month", "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("month", "2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(periodRange("month", "2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(periodRange("week", "2026-12-28")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("stops only at periods with data and at the current one", () => {
    const days = [
      makeDay("2026-07-03", { steps: 4000 }),
      makeDay("2026-08-20"), // a row without any value does not count
      makeDay("2026-09-10", { sleep_minutes: 420 }),
    ];
    const months = periodsWithData(days, "month", TODAY);
    expect(months).toEqual(["2026-07", "2026-09", "2026-10"]);
    expect(adjacentPeriod(months, "2026-10", -1)).toBe("2026-09");
    expect(adjacentPeriod(months, "2026-09", -1)).toBe("2026-07");
    expect(adjacentPeriod(months, "2026-07", -1)).toBeNull();
    expect(adjacentPeriod(months, "2026-07", 1)).toBe("2026-09");
    expect(adjacentPeriod(months, "2026-10", 1)).toBeNull();
    expect(periodsWithData(days, "week", TODAY)).toEqual(["2026-06-29", "2026-09-07", "2026-10-12"]);
  });

  it("ignores data after today", () => {
    const days = [makeDay("2026-11-02", { steps: 100 })];
    expect(periodsWithData(days, "month", TODAY)).toEqual(["2026-10"]);
  });
});

describe("selection", () => {
  const days = [
    makeDay("2026-09-28", { steps: 5000 }),
    makeDay("2026-10-05", { steps: 6000 }),
    makeDay("2026-10-13", { steps: 7000 }),
    makeDay("2026-10-15", { complete: false, steps: 900 }),
  ];

  it("starts on the latest day with data", () => {
    expect(latestDataDay(days, TODAY)).toBe("2026-10-15");
    expect(latestDataDay(days, "2026-10-14")).toBe("2026-10-13");
    expect(latestDataDay([], TODAY)).toBe(TODAY);
  });

  it("keeps the selected day inside the new period, else picks its latest day with data", () => {
    expect(selectionIn(days, "month", "2026-10", TODAY, "2026-10-05")).toBe("2026-10-05");
    expect(selectionIn(days, "month", "2026-10", TODAY, "2026-09-28")).toBe("2026-10-15");
    expect(selectionIn(days, "month", "2026-09", TODAY, "2026-10-15")).toBe("2026-09-28");
    expect(selectionIn(days, "week", "2026-10-05", TODAY)).toBe("2026-10-05");
    // A kept day without data is not kept.
    expect(selectionIn(days, "month", "2026-10", TODAY, "2026-10-06")).toBe("2026-10-15");
  });

  it("selects nothing in a period without data", () => {
    expect(selectionIn(days, "month", "2026-08", TODAY)).toBeNull();
    expect(selectionIn(days, "week", "2026-10-19", TODAY)).toBeNull();
  });
});

describe("calendarCells", () => {
  const days = [
    makeDay("2026-09-30", { steps: 3000 }),
    makeDay("2026-10-01", {
      steps: 8000,
      sleep_minutes: 600,
      scores: makeScores("2026-10-01", { day_score: 77 }),
      workouts: [
        makeWorkout("a", { day: "2026-10-01", type: "walking", duration_s: 600 }),
        makeWorkout("b", { day: "2026-10-01", type: "running", duration_s: 1800 }),
      ],
    }),
    makeDay("2026-10-15", { complete: false, steps: 1200, sleep_minutes: 270 }),
    makeDay("2026-10-20", { steps: 50 }),
  ];

  it("fills whole weeks, Monday first, and marks the neighbouring months", () => {
    const cells = calendarCells(days, "month", "2026-10", TODAY);
    expect(cells).toHaveLength(35); // 28. 9. (Monday) to 1. 11. (Sunday)
    expect(cells[0].day).toBe("2026-09-28");
    expect(cells[cells.length - 1].day).toBe("2026-11-01");
    expect(cells[2]).toMatchObject({ day: "2026-09-30", inPeriod: false, steps: 3000 });
    expect(cells[3]).toMatchObject({ day: "2026-10-01", inPeriod: true, dayScore: 77, steps: 8000, sleepShare: 1 });
  });

  it("sorts the workouts of a day longest first", () => {
    const cells = calendarCells(days, "month", "2026-10", TODAY);
    expect(cells[3].workouts.map((workout) => workout.id)).toEqual(["b", "a"]);
  });

  it("marks today as running and leaves future days empty, even with stray data", () => {
    const cells = calendarCells(days, "week", "2026-10-12", TODAY);
    expect(cells).toHaveLength(7);
    const today = cells.find((cell) => cell.day === TODAY);
    expect(today).toMatchObject({ isToday: true, running: true, steps: 1200, sleepShare: 0.5 });
    const later = calendarCells(days, "week", "2026-10-19", TODAY).find((cell) => cell.day === "2026-10-20");
    expect(later).toMatchObject({ future: true, data: null, steps: null });
  });
});

describe("periodAverages", () => {
  it("averages days with data and leaves running totals of today out of the steps", () => {
    const days = [
      makeDay("2026-10-12", { steps: 10000, sleep_minutes: 400, hr_resting: 50, scores: makeScores("2026-10-12", { day_score: 70, strain: 10 }) }),
      makeDay("2026-10-13", { steps: 6000, sleep_minutes: 500, hr_resting: 52, scores: makeScores("2026-10-13", { day_score: 80, strain: 14 }) }),
      makeDay("2026-10-14"),
      makeDay("2026-10-15", {
        complete: false,
        steps: 500,
        sleep_minutes: 450,
        scores: makeScores("2026-10-15", { strain: 2 }),
        workouts: [makeWorkout("w", { day: "2026-10-15", duration_s: 2700 })],
      }),
    ];
    const result = periodAverages(days, "2026-10-12", "2026-10-18", TODAY);
    expect(result).toEqual({
      dayScore: 75,
      steps: 8000,
      sleepMinutes: 450,
      restingHr: 51,
      strain: 12,
      workouts: 1,
      workoutSeconds: 2700,
      daysWithData: 3,
    });
  });

  it("returns nulls for a period without data", () => {
    const result = periodAverages([], "2026-10-01", "2026-10-31", TODAY);
    expect(result.dayScore).toBeNull();
    expect(result.steps).toBeNull();
    expect(result.workouts).toBe(0);
  });
});

describe("headings", () => {
  it("names months and weeks", () => {
    expect(monthTitle("2026-10", TODAY)).toBe("Október");
    expect(monthTitle("2025-12", TODAY)).toBe("December 2025");
    expect(weekTitle("2026-10-12", TODAY)).toBe("12. – 18. 10.");
    expect(weekTitle("2026-09-28", TODAY)).toBe("28. 9. – 4. 10.");
    expect(weekTitle("2025-12-29", TODAY)).toBe("29. 12. 2025 – 4. 1. 2026");
    expect(averagesTitle("month", "2026-10", TODAY)).toBe("Október v priemere");
    expect(averagesTitle("week", "2026-10-12", TODAY)).toBe("Týždeň v priemere");
  });
});

describe("trainingWeeks", () => {
  it("adds up workout time per week and averages the day strain of finished days", () => {
    const workouts = [
      makeWorkout("a", { day: "2026-10-01", duration_s: 3600 }),
      makeWorkout("b", { day: "2026-10-03", duration_s: 1800 }),
      makeWorkout("c", { day: "2026-10-13", duration_s: 2400 }),
    ];
    const days = [
      makeDay("2026-10-01", { scores: makeScores("2026-10-01", { strain: 12 }) }),
      makeDay("2026-10-03", { scores: makeScores("2026-10-03", { strain: 8 }) }),
      makeDay("2026-10-15", { complete: false, scores: makeScores("2026-10-15", { strain: 3 }) }),
    ];
    const weeks = trainingWeeks(days, workouts, "2026-09-30", TODAY, TODAY);
    expect(weeks.map((week) => week.week)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(weeks[0]).toMatchObject({ count: 2, seconds: 5400, dayStrain: 10, partial: false });
    expect(weeks[1]).toMatchObject({ count: 0, seconds: 0, dayStrain: null });
    // Today's running strain is left out.
    expect(weeks[2]).toMatchObject({ count: 1, seconds: 2400, dayStrain: null, partial: true });
  });

  it("leaves out workouts before the start of the period", () => {
    const workouts = [makeWorkout("a", { day: "2026-09-28", duration_s: 3600 }), makeWorkout("b", { day: "2026-10-01", duration_s: 600 })];
    const weeks = trainingWeeks([], workouts, "2026-09-30", "2026-10-04", TODAY);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].seconds).toBe(600);
  });
});
