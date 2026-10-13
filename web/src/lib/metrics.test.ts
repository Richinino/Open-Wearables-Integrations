import { describe, expect, it } from "vitest";

import {
  allWorkouts,
  average,
  averageClock,
  indexByDay,
  isStale,
  max,
  min,
  periodSummary,
  series,
  sleepNights,
  sum,
  windowEnding,
  workoutTotals,
} from "./metrics";
import type { Day, Workout } from "./types";

const ZONE = "Europe/Bratislava";

function makeDay(day: string, values: Partial<Day> = {}): Day {
  return {
    day,
    timezone: ZONE,
    complete: true,
    steps: null,
    steps_source: null,
    distance_m_est: null,
    active_minutes_est: null,
    activity_kcal_est: null,
    basal_kcal: null,
    total_kcal_est: null,
    hr_resting: null,
    hr_avg: null,
    hr_max: null,
    hr_min: null,
    zone_light_min: null,
    zone_moderate_min: null,
    zone_vigorous_min: null,
    sleep_start: null,
    sleep_end: null,
    sleep_minutes: null,
    sleep_deep_min: null,
    sleep_rem_min: null,
    sleep_light_min: null,
    sleep_awake_min: null,
    nap_minutes: null,
    workouts: [],
    ...values,
  };
}

function makeWorkout(id: string, values: Partial<Workout> = {}): Workout {
  return {
    id,
    day: "2026-06-10",
    type: "running",
    start: "2026-06-10T16:00:00+00:00",
    end: "2026-06-10T16:30:00+00:00",
    duration_s: 1800,
    source: "test",
    hr_avg: null,
    hr_max: null,
    hr_min: null,
    zone_light_min: 0,
    zone_moderate_min: 0,
    zone_vigorous_min: 0,
    distance_m: null,
    kcal_est: null,
    ...values,
  };
}

/** Fourteen consecutive days, 1–14 June 2026, with steps 1000, 2000, … 14000. */
function fortnight(): Day[] {
  return Array.from({ length: 14 }, (_, index) =>
    makeDay(`2026-06-${String(index + 1).padStart(2, "0")}`, { steps: (index + 1) * 1000 }),
  );
}

describe("indexByDay", () => {
  it("maps each date to its day", () => {
    const days = [makeDay("2026-06-01"), makeDay("2026-06-03")];
    const index = indexByDay(days);
    expect(index.size).toBe(2);
    expect(index.get("2026-06-03")).toBe(days[1]);
    expect(index.get("2026-06-02")).toBeUndefined();
    expect(indexByDay([]).size).toBe(0);
  });
});

describe("windowEnding", () => {
  it("returns consecutive calendar days, oldest first, with null for absent days", () => {
    const days = [makeDay("2026-02-27"), makeDay("2026-03-01"), makeDay("2026-03-02")];
    const slots = windowEnding(days, "2026-03-02", 5);
    expect(slots.map((slot) => slot.day)).toEqual([
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(slots.map((slot) => slot.data?.day ?? null)).toEqual([
      null,
      "2026-02-27",
      null,
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("ignores days outside the window", () => {
    const slots = windowEnding(fortnight(), "2026-06-10", 3);
    expect(slots.map((slot) => slot.data?.steps)).toEqual([8000, 9000, 10000]);
  });

  it("gives only empty slots for empty input and nothing for a zero length", () => {
    const slots = windowEnding([], "2026-06-03", 3);
    expect(slots).toEqual([
      { day: "2026-06-01", data: null },
      { day: "2026-06-02", data: null },
      { day: "2026-06-03", data: null },
    ]);
    expect(windowEnding(fortnight(), "2026-06-03", 0)).toEqual([]);
  });
});

describe("series", () => {
  const days = [
    makeDay("2026-06-01", { steps: 5000 }),
    makeDay("2026-06-02", { steps: null }),
    makeDay("2026-06-04", { steps: 0 }),
    makeDay("2026-06-05", { steps: 1200, complete: false }),
  ];
  const slots = windowEnding(days, "2026-06-05", 5);

  it("keeps null values and absent days as null and zero as zero", () => {
    expect(series(slots, "steps")).toEqual([
      { day: "2026-06-01", value: 5000 },
      { day: "2026-06-02", value: null },
      { day: "2026-06-03", value: null },
      { day: "2026-06-04", value: 0 },
      { day: "2026-06-05", value: 1200 },
    ]);
  });

  it("includes the incomplete day unless told otherwise", () => {
    expect(series(slots, "steps", {}).at(-1)?.value).toBe(1200);
    expect(series(slots, "steps", { includeIncomplete: true }).at(-1)?.value).toBe(1200);
    const strict = series(slots, "steps", { includeIncomplete: false });
    expect(strict.at(-1)).toEqual({ day: "2026-06-05", value: null });
    expect(strict[0].value).toBe(5000);
  });

  it("reads any numeric key", () => {
    const night = [makeDay("2026-06-01", { sleep_minutes: 440, hr_resting: 52.5 })];
    const one = windowEnding(night, "2026-06-01", 1);
    expect(series(one, "sleep_minutes")[0].value).toBe(440);
    expect(series(one, "hr_resting")[0].value).toBe(52.5);
    expect(series(one, "nap_minutes")[0].value).toBeNull();
  });

  it("returns nothing for no slots", () => {
    expect(series([], "steps")).toEqual([]);
  });
});

describe("average, sum, min, max", () => {
  it("skip null and undefined", () => {
    const values = [4, null, 10, undefined, 1];
    expect(average(values)).toBe(5);
    expect(sum(values)).toBe(15);
    expect(min(values)).toBe(1);
    expect(max(values)).toBe(10);
  });

  it("count zero as a value", () => {
    expect(average([0, 10])).toBe(5);
    expect(sum([0])).toBe(0);
    expect(min([0, 5])).toBe(0);
    expect(max([0, -5])).toBe(0);
  });

  it("return null when there is nothing to work with", () => {
    for (const values of [[], [null], [null, undefined], [Number.NaN]]) {
      expect(average(values)).toBeNull();
      expect(sum(values)).toBeNull();
      expect(min(values)).toBeNull();
      expect(max(values)).toBeNull();
    }
  });
});

describe("periodSummary", () => {
  it("summarises the window and compares it with the one before", () => {
    const summary = periodSummary(fortnight(), "2026-06-14", 7, "steps");
    expect(summary.average).toBe(11000);
    expect(summary.total).toBe(77000);
    expect(summary.count).toBe(7);
    expect(summary.previousAverage).toBe(4000);
    expect(summary.change).toBeCloseTo((11000 - 4000) / 4000, 10);
  });

  it("reports a falling value as a negative change", () => {
    const days = [makeDay("2026-06-01", { hr_resting: 60 }), makeDay("2026-06-02", { hr_resting: 54 })];
    expect(periodSummary(days, "2026-06-02", 1, "hr_resting").change).toBeCloseTo(-0.1, 10);
  });

  it("leaves the incomplete day out by default", () => {
    const days = fortnight();
    days[13] = makeDay("2026-06-14", { steps: 300, complete: false });

    const strict = periodSummary(days, "2026-06-14", 7, "steps");
    expect(strict.count).toBe(6);
    expect(strict.total).toBe(8000 + 9000 + 10000 + 11000 + 12000 + 13000);
    expect(strict.average).toBe(10500);

    const loose = periodSummary(days, "2026-06-14", 7, "steps", { includeIncomplete: true });
    expect(loose.count).toBe(7);
    expect(loose.total).toBe(63300);
  });

  it("counts only days that contributed a value", () => {
    const days = [
      makeDay("2026-06-01", { steps: 4000 }),
      makeDay("2026-06-02", { steps: null }),
      makeDay("2026-06-04", { steps: 8000 }),
    ];
    const summary = periodSummary(days, "2026-06-05", 5, "steps");
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(6000);
    expect(summary.total).toBe(12000);
  });

  it("has no change without a usable previous window", () => {
    const week = fortnight().slice(7);
    const noHistory = periodSummary(week, "2026-06-14", 7, "steps");
    expect(noHistory.average).toBe(11000);
    expect(noHistory.previousAverage).toBeNull();
    expect(noHistory.change).toBeNull();

    const zeroBefore = [makeDay("2026-06-01", { steps: 0 }), makeDay("2026-06-02", { steps: 500 })];
    const fromZero = periodSummary(zeroBefore, "2026-06-02", 1, "steps");
    expect(fromZero.previousAverage).toBe(0);
    expect(fromZero.change).toBeNull();

    const nothingNow = periodSummary(fortnight(), "2026-06-21", 7, "steps");
    expect(nothingNow.average).toBeNull();
    expect(nothingNow.total).toBeNull();
    expect(nothingNow.count).toBe(0);
    expect(nothingNow.previousAverage).toBe(11000);
    expect(nothingNow.change).toBeNull();
  });

  it("copes with empty input", () => {
    expect(periodSummary([], "2026-06-14", 7, "steps")).toEqual({
      average: null,
      total: null,
      count: 0,
      previousAverage: null,
      change: null,
    });
  });
});

describe("allWorkouts", () => {
  it("lists every workout, newest first", () => {
    const days = [
      makeDay("2026-06-09", {
        workouts: [makeWorkout("a", { start: "2026-06-09T06:00:00+00:00" })],
      }),
      makeDay("2026-06-10", {
        workouts: [
          makeWorkout("b", { start: "2026-06-10T07:00:00+00:00" }),
          makeWorkout("c", { start: "2026-06-10T17:00:00+00:00" }),
        ],
      }),
      makeDay("2026-06-11"),
    ];
    expect(allWorkouts(days).map((workout) => workout.id)).toEqual(["c", "b", "a"]);
    expect(days[1].workouts.map((workout) => workout.id)).toEqual(["b", "c"]);
  });

  it("is empty when there are no workouts", () => {
    expect(allWorkouts([])).toEqual([]);
    expect(allWorkouts([makeDay("2026-06-09")])).toEqual([]);
  });
});

describe("workoutTotals", () => {
  it("adds up durations, distances and calories", () => {
    const totals = workoutTotals([
      makeWorkout("a", { type: "running", duration_s: 1800, distance_m: 5000, kcal_est: 400 }),
      makeWorkout("b", { type: "cycling", duration_s: 3600, distance_m: 20000, kcal_est: null }),
      makeWorkout("c", { type: "running", duration_s: 2400, distance_m: null, kcal_est: 500 }),
      makeWorkout("d", { type: "strength_training", duration_s: 3000 }),
    ]);
    expect(totals.count).toBe(4);
    expect(totals.seconds).toBe(10800);
    expect(totals.distanceM).toBe(25000);
    expect(totals.kcal).toBe(900);
    expect(totals.byType).toEqual([
      { type: "running", count: 2, seconds: 4200 },
      { type: "cycling", count: 1, seconds: 3600 },
      { type: "strength_training", count: 1, seconds: 3000 },
    ]);
  });

  it("has no distance or calories when no workout has one", () => {
    const totals = workoutTotals([makeWorkout("a"), makeWorkout("b")]);
    expect(totals.distanceM).toBeNull();
    expect(totals.kcal).toBeNull();
    expect(totals.seconds).toBe(3600);
  });

  it("orders types by count, then by name", () => {
    const totals = workoutTotals([
      makeWorkout("a", { type: "yoga" }),
      makeWorkout("b", { type: "soccer" }),
      makeWorkout("c", { type: "walking" }),
      makeWorkout("d", { type: "walking" }),
      makeWorkout("e", { type: "cycling" }),
    ]);
    expect(totals.byType.map((entry) => entry.type)).toEqual(["walking", "cycling", "soccer", "yoga"]);
  });

  it("is all zeroes and nulls for no workouts", () => {
    expect(workoutTotals([])).toEqual({
      count: 0,
      seconds: 0,
      distanceM: null,
      kcal: null,
      byType: [],
    });
  });
});

describe("sleepNights", () => {
  it("measures bedtime from local noon and adds the time in bed", () => {
    // Summer time: 22:30 local is 20:30 UTC, 07:00 local is 05:00 UTC.
    const days = [
      makeDay("2026-07-15", {
        sleep_start: "2026-07-14T20:30:00+00:00",
        sleep_end: "2026-07-15T05:00:00+00:00",
        sleep_minutes: 480,
        sleep_deep_min: 90,
        sleep_rem_min: 100,
        sleep_light_min: 290,
        sleep_awake_min: 30,
        nap_minutes: 25,
      }),
    ];
    expect(sleepNights(days, ZONE)).toEqual([
      {
        day: "2026-07-15",
        start: "2026-07-14T20:30:00+00:00",
        end: "2026-07-15T05:00:00+00:00",
        minutes: 480,
        deep: 90,
        rem: 100,
        light: 290,
        awake: 30,
        nap: 25,
        bedMinutes: 630,
        wakeMinutes: 1140,
      },
    ]);
  });

  it("places a bedtime after midnight later than an evening one", () => {
    // Winter time: 00:15 local is 23:15 UTC the day before.
    const [night] = sleepNights(
      [
        makeDay("2026-01-10", {
          sleep_start: "2026-01-09T23:15:00+00:00",
          sleep_end: "2026-01-10T06:45:00+00:00",
        }),
      ],
      ZONE,
    );
    expect(night.bedMinutes).toBe(735);
    expect(night.wakeMinutes).toBe(735 + 450);
    expect(night.minutes).toBeNull();
    expect(night.nap).toBeNull();
  });

  it("keeps bedMinutes within a day at the edges", () => {
    const at = (start: string) =>
      sleepNights(
        [makeDay("2026-01-10", { sleep_start: start, sleep_end: "2026-01-10T07:00:00+00:00" })],
        ZONE,
      )[0].bedMinutes;
    expect(at("2026-01-09T11:00:00+00:00")).toBe(0); // 12:00 local
    expect(at("2026-01-09T10:59:00+00:00")).toBe(1439); // 11:59 local
    expect(at("2026-01-09T23:00:00+00:00")).toBe(720); // midnight
  });

  it("uses elapsed time on the night the clocks go back", () => {
    // 22:30 summer time to 06:00 winter time is eight and a half hours in bed.
    const [night] = sleepNights(
      [
        makeDay("2026-10-25", {
          sleep_start: "2026-10-24T20:30:00+00:00",
          sleep_end: "2026-10-25T05:00:00+00:00",
        }),
      ],
      ZONE,
    );
    expect(night.bedMinutes).toBe(630);
    expect(night.wakeMinutes).toBe(630 + 510);
  });

  it("skips days without a complete pair of timestamps and sorts oldest first", () => {
    const days = [
      makeDay("2026-07-16", {
        sleep_start: "2026-07-15T21:00:00+00:00",
        sleep_end: "2026-07-16T05:00:00+00:00",
      }),
      makeDay("2026-07-13", { sleep_start: "2026-07-12T21:00:00+00:00", sleep_end: null }),
      makeDay("2026-07-14", { sleep_start: null, sleep_end: "2026-07-14T05:00:00+00:00" }),
      makeDay("2026-07-15", { sleep_minutes: 400 }),
      makeDay("2026-07-12", {
        sleep_start: "2026-07-11T21:00:00+00:00",
        sleep_end: "2026-07-12T05:00:00+00:00",
      }),
      makeDay("2026-07-11", { sleep_start: "not a time", sleep_end: "2026-07-11T05:00:00+00:00" }),
    ];
    expect(sleepNights(days, ZONE).map((night) => night.day)).toEqual(["2026-07-12", "2026-07-16"]);
    expect(sleepNights([], ZONE)).toEqual([]);
  });
});

describe("averageClock", () => {
  it("averages bedtimes on either side of midnight", () => {
    expect(averageClock([690, 750])).toBe(720); // 23:30 and 00:30 → midnight
    expect(averageClock([630, 735])).toBe(682.5);
    expect(averageClock([1140])).toBe(1140);
  });

  it("is null without values", () => {
    expect(averageClock([])).toBeNull();
  });
});

describe("isStale", () => {
  const now = new Date("2026-10-13T12:00:00Z");

  it("treats a missing or unreadable time as stale", () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale("", now)).toBe(true);
    expect(isStale("not a time", now)).toBe(true);
  });

  it("uses ninety minutes by default", () => {
    expect(isStale("2026-10-13T11:53:00+00:00", now)).toBe(false);
    expect(isStale("2026-10-13T10:31:00+00:00", now)).toBe(false);
    expect(isStale("2026-10-13T10:30:00+00:00", now)).toBe(false);
    expect(isStale("2026-10-13T10:29:59+00:00", now)).toBe(true);
    expect(isStale("2026-10-12T12:00:00+00:00", now)).toBe(true);
  });

  it("accepts another threshold", () => {
    expect(isStale("2026-10-13T11:49:00+00:00", now, 10)).toBe(true);
    expect(isStale("2026-10-13T11:51:00+00:00", now, 10)).toBe(false);
  });

  it("does not call a time in the future stale", () => {
    expect(isStale("2026-10-13T12:05:00+00:00", now)).toBe(false);
  });
});
