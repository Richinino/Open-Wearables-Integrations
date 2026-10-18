import { describe, expect, it } from "vitest";

import { addDays, dateRange, diffDays, localDay, localMinutesOfDay, weekdayIndex } from "./dates";
import { demoDataset } from "./demo-data";
import { checkBody, ENTRY_FIELDS, hasEntry } from "./entries";
import { AUTO_FIELDS, tunedValue } from "./samsung";
import type { Dataset, Day, Entry } from "./types";

const ZONE = "Europe/Bratislava";
const TODAY = "2026-10-13";
const WORKOUT_TYPES = [
  "running",
  "walking",
  "cycling",
  "pool_swimming",
  "soccer",
  "volleyball",
  "strength_training",
  "generic",
];
const SLEEP_KEYS = [
  "sleep_start",
  "sleep_end",
  "sleep_minutes",
  "sleep_deep_min",
  "sleep_rem_min",
  "sleep_light_min",
  "sleep_awake_min",
  "nap_minutes",
] as const;

const dataset = demoDataset(TODAY);

// The same checks also run on windows that contain each of the two clock changes.
const datasets: [string, Dataset][] = [
  [TODAY, dataset],
  ["2026-04-20", demoDataset("2026-04-20")],
  ["2026-11-08", demoDataset("2026-11-08")],
  ["2027-01-10", demoDataset("2027-01-10", 60)],
];

const minutesBetween = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 60_000;

describe("demoDataset", () => {
  it("is deterministic for equal input", () => {
    expect(demoDataset(TODAY)).toEqual(dataset);
    expect(JSON.stringify(demoDataset(TODAY, 120))).toBe(JSON.stringify(dataset));
    expect(demoDataset(TODAY, 30, "2026-10-13T15:00:00+00:00")).toEqual(
      demoDataset(TODAY, 30, "2026-10-13T15:00:00+00:00"),
    );
  });

  it("differs for another day", () => {
    expect(JSON.stringify(demoDataset("2026-10-12"))).not.toBe(JSON.stringify(dataset));
  });

  it("keeps a finished day the same when today moves on", () => {
    const later = demoDataset(addDays(TODAY, 3));
    const before = new Map(dataset.days.map((day) => [day.day, day]));
    const shared = later.days.filter((day) => day.complete && before.get(day.day)?.complete);
    expect(shared.length).toBeGreaterThan(100);
    for (const day of shared) expect(day).toEqual(before.get(day.day));
  });

  it("survives a JSON round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(dataset))).toEqual(dataset);
    const walk = (value: unknown, path: string): void => {
      expect(value, path).not.toBeUndefined();
      if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
      else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
      else if (value !== null && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
      }
    };
    walk(dataset, "dataset");
  });

  it("describes itself: zone, span and sync time", () => {
    expect(dataset.timezone).toBe(ZONE);
    expect(dataset.first_day).toBe(dataset.days[0].day);
    expect(dataset.first_day).toBe(addDays(TODAY, -119));
    expect(dataset.last_day).toBe(TODAY);
    expect(dataset.last_day).toBe(dataset.days[dataset.days.length - 1].day);
    expect(dataset.synced_at).toBe("2026-10-13T08:00:00+00:00");
    expect(demoDataset(TODAY, 120, "2026-10-13T17:23:00+00:00").synced_at).toBe(
      "2026-10-13T17:23:00+00:00",
    );
  });

  it("lists days oldest first, with three or four missing entirely", () => {
    const listed = dataset.days.map((day) => day.day);
    expect([...listed].sort()).toEqual(listed);
    expect(new Set(listed).size).toBe(listed.length);

    const calendar = dateRange(addDays(TODAY, -119), TODAY);
    const absent = calendar.filter((day) => !listed.includes(day));
    expect(listed.every((day) => calendar.includes(day))).toBe(true);
    expect(absent.length).toBeGreaterThanOrEqual(3);
    expect(absent.length).toBeLessThanOrEqual(4);
    // Two of the gaps are neighbours, so the UI also sees a hole longer than one day.
    expect(absent.some((day) => absent.includes(addDays(day, 1)))).toBe(true);
    expect(absent).not.toContain(TODAY);
    expect(absent).not.toContain(addDays(TODAY, -1));
  });

  it("honours the requested length", () => {
    expect(demoDataset(TODAY, 30).days[0].day).toBe(addDays(TODAY, -29));
    expect(demoDataset(TODAY, 30).days).toHaveLength(28);
    expect(demoDataset(TODAY, 1).days.map((day) => day.day)).toEqual([TODAY]);
    const params = { stride_m: 0.74, active_hr_delta: 30, kcal_scale: 1, basal_kcal: null };
    expect(demoDataset(TODAY, 0)).toEqual({
      timezone: ZONE,
      first_day: null,
      last_day: null,
      synced_at: null,
      days: [],
      calibration: { fitted_at: null, entries: 0, params, defaults: params, quality: {} },
    });
  });

  it("rejects a today that is not a day", () => {
    expect(() => demoDataset("2026-02-30")).toThrow(RangeError);
  });

  it("leaves only the last day incomplete, with partial values", () => {
    const last = dataset.days[dataset.days.length - 1];
    expect(last.complete).toBe(false);
    expect(dataset.days.slice(0, -1).every((day) => day.complete)).toBe(true);

    const finished = dataset.days.slice(0, -1);
    const fullDaySteps = finished
      .flatMap((day) => (day.steps === null ? [] : [day.steps]))
      .sort((a, b) => a - b);
    const medianSteps = fullDaySteps[Math.floor(fullDaySteps.length / 2)];
    const lowestFullBasal = Math.min(...finished.map((day) => day.basal_kcal ?? Infinity));
    expect(last.steps).not.toBeNull();
    expect(last.steps!).toBeGreaterThan(0);
    expect(last.steps!).toBeLessThan(medianSteps / 2);
    expect(last.basal_kcal!).toBeLessThan(lowestFullBasal * 0.6);
    expect(last.total_kcal_est).toBe(last.basal_kcal! + last.activity_kcal_est!);
  });

  it("fills the unfinished day as the sync time moves through it", () => {
    const at = (time: string) => {
      const days = demoDataset(TODAY, 10, `${TODAY}T${time}:00+00:00`).days;
      return days[days.length - 1];
    };
    const night = at("02:00");
    const morning = at("08:00");
    const evening = at("20:30");
    expect(night.sleep_end).toBeNull();
    expect(night.nap_minutes).toBeNull();
    expect(morning.sleep_end).not.toBeNull();
    expect(morning.steps!).toBeGreaterThan(night.steps!);
    expect(evening.steps!).toBeGreaterThan(morning.steps!);
    expect(evening.basal_kcal!).toBeGreaterThan(morning.basal_kcal!);
    expect(evening.workouts.length).toBeGreaterThanOrEqual(morning.workouts.length);
    for (const workout of evening.workouts) {
      expect(Date.parse(workout.end)).toBeLessThanOrEqual(Date.parse(`${TODAY}T20:30:00+00:00`));
    }
  });

  it("has no steps on roughly a tenth of the days", () => {
    const without = dataset.days.filter((day) => day.steps === null);
    const share = without.length / dataset.days.length;
    expect(share).toBeGreaterThan(0.04);
    expect(share).toBeLessThan(0.18);
  });

  it("uses all three step sources", () => {
    const sources = new Set(dataset.days.map((day) => day.steps_source));
    expect(sources).toEqual(new Set(["samsung_health_total", "samsung_hourly", "phone", null]));
  });

  it("has a few nights without any sleep data, and occasional naps", () => {
    const sleepless = dataset.days.filter((day) => day.sleep_start === null);
    expect(sleepless.length).toBeGreaterThanOrEqual(2);
    expect(sleepless.length).toBeLessThanOrEqual(8);

    const naps = dataset.days.filter((day) => (day.nap_minutes ?? 0) > 0);
    const noNap = dataset.days.filter((day) => day.nap_minutes === 0);
    expect(naps.length).toBeGreaterThanOrEqual(3);
    expect(naps.length).toBeLessThan(dataset.days.length / 3);
    expect(noNap.length).toBeGreaterThan(naps.length);
    for (const day of naps) {
      expect(day.nap_minutes!).toBeGreaterThanOrEqual(20);
      expect(day.nap_minutes!).toBeLessThanOrEqual(80);
    }
  });

  it("has days when the watch was not worn: phone steps, nothing from the heart", () => {
    const bare = dataset.days.filter((day) => day.hr_resting === null);
    expect(bare.length).toBeGreaterThanOrEqual(1);
    expect(bare.length).toBeLessThanOrEqual(4);
    for (const day of bare) {
      expect(day.steps_source).toBe("phone");
      expect(day.steps).not.toBeNull();
      expect(day.basal_kcal).not.toBeNull();
      expect(day.workouts).toEqual([]);
      for (const key of ["hr_avg", "hr_max", "hr_min", "active_minutes_est"] as const) {
        expect(day[key], key).toBeNull();
      }
      for (const key of ["zone_light_min", "zone_moderate_min", "zone_vigorous_min"] as const) {
        expect(day[key], key).toBeNull();
      }
      expect(day.activity_kcal_est).toBeNull();
      expect(day.total_kcal_est).toBeNull();
      expect(day.sleep_start).toBeNull();
    }
  });

  it("has zero to three workouts a day, of every listed type", () => {
    const counts = dataset.days.map((day) => day.workouts.length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    expect(counts.filter((count) => count === 0).length).toBeGreaterThan(20);
    expect(counts.filter((count) => count === 1).length).toBeGreaterThan(20);
    expect(counts.filter((count) => count === 2).length).toBeGreaterThanOrEqual(3);
    expect(counts.filter((count) => count === 3).length).toBeGreaterThanOrEqual(1);

    const workouts = dataset.days.flatMap((day) => day.workouts);
    expect(new Set(workouts.map((workout) => workout.type))).toEqual(new Set(WORKOUT_TYPES));
    expect(new Set(workouts.map((workout) => workout.id)).size).toBe(workouts.length);
  });

  it("has workouts with and without a distance, also among those that could have one", () => {
    const workouts = dataset.days.flatMap((day) => day.workouts);
    const measurable = workouts.filter((workout) =>
      ["running", "walking", "cycling", "pool_swimming"].includes(workout.type),
    );
    expect(measurable.some((workout) => workout.distance_m === null)).toBe(true);
    expect(measurable.filter((workout) => workout.distance_m !== null).length).toBeGreaterThan(10);
    expect(
      workouts
        .filter((workout) => ["soccer", "volleyball", "strength_training"].includes(workout.type))
        .every((workout) => workout.distance_m === null),
    ).toBe(true);
  });

  it("follows a weekly rhythm", () => {
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const inBed = (weekend: boolean) =>
      mean(
        dataset.days
          .filter((day) => day.sleep_start !== null && weekdayIndex(day.day) >= 5 === weekend)
          .map((day) => minutesBetween(day.sleep_start!, day.sleep_end!)),
      );
    const wakeUp = (weekend: boolean) =>
      mean(
        dataset.days
          .filter((day) => day.sleep_end !== null && weekdayIndex(day.day) >= 5 === weekend)
          .map((day) => localMinutesOfDay(day.sleep_end!, ZONE)),
      );
    expect(inBed(true)).toBeGreaterThan(inBed(false) + 20);
    expect(wakeUp(true)).toBeGreaterThan(wakeUp(false) + 45);

    const typesOn = (weekday: number) =>
      new Set(
        dataset.days
          .filter((day) => weekdayIndex(day.day) === weekday)
          .flatMap((day) => day.workouts.map((workout) => workout.type)),
      );
    expect(typesOn(5).has("soccer")).toBe(true);
    expect(typesOn(1)).toEqual(new Set(["running"]));
    expect(typesOn(0).has("soccer")).toBe(false);
  });
});

describe.each(datasets)("internal consistency of the window ending %s", (_today, data) => {
  const finished = (day: Day) => day.complete;

  it("uses the zone everywhere", () => {
    expect(data.timezone).toBe(ZONE);
    expect(data.days.every((day) => day.timezone === ZONE)).toBe(true);
  });

  it("derives the distance from the steps, or has neither", () => {
    for (const day of data.days) {
      if (day.steps === null) {
        expect(day.distance_m_est, day.day).toBeNull();
        expect(day.steps_source, day.day).toBeNull();
      } else {
        expect(Number.isInteger(day.steps), day.day).toBe(true);
        expect(day.steps_source, day.day).not.toBeNull();
        expect(day.distance_m_est!, day.day).toBeCloseTo(day.steps * 0.74, 1);
      }
    }
  });

  it("adds basal and activity calories up to the total", () => {
    for (const day of data.days) {
      if (day.activity_kcal_est === null) {
        expect(day.total_kcal_est, day.day).toBeNull();
        continue;
      }
      expect(day.total_kcal_est, day.day).toBe(day.basal_kcal! + day.activity_kcal_est);
      if (finished(day)) {
        expect(day.total_kcal_est!, day.day).toBeGreaterThan(1700);
        expect(day.total_kcal_est!, day.day).toBeLessThan(4500);
      }
    }
  });

  it("keeps heart rates in a believable order", () => {
    for (const day of data.days.filter((item) => item.hr_resting !== null)) {
      expect(day.hr_resting!, day.day).toBeGreaterThan(45);
      expect(day.hr_resting!, day.day).toBeLessThan(62);
      expect(day.hr_min!, day.day).toBeLessThan(day.hr_resting!);
      expect(day.hr_avg!, day.day).toBeGreaterThan(day.hr_resting!);
      expect(day.hr_max!, day.day).toBeGreaterThan(day.hr_avg!);
      expect(day.hr_max!, day.day).toBeLessThanOrEqual(189);
      for (const workout of day.workouts) {
        if (workout.hr_max !== null) expect(day.hr_max!, workout.id).toBeGreaterThanOrEqual(workout.hr_max);
      }
    }
  });

  it("has day zones that cover the zones of the day's workouts", () => {
    for (const day of data.days.filter((item) => item.zone_light_min !== null)) {
      for (const key of ["zone_light_min", "zone_moderate_min", "zone_vigorous_min"] as const) {
        const inWorkouts = day.workouts.reduce((sum, workout) => sum + workout[key], 0);
        expect(day[key]!, `${day.day} ${key}`).toBeGreaterThanOrEqual(inWorkouts);
        expect(Number.isInteger(day[key]), `${day.day} ${key}`).toBe(true);
      }
      const workoutMinutes = day.workouts.reduce((sum, workout) => sum + workout.duration_s / 60, 0);
      expect(day.active_minutes_est!, day.day).toBeGreaterThanOrEqual(workoutMinutes);
    }
  });

  it("has sleep that starts the evening before or just after midnight and ends that morning", () => {
    const nights = data.days.filter((day) => day.sleep_start !== null);
    expect(nights.length).toBeGreaterThan(data.days.length * 0.8);
    let afterMidnight = 0;

    for (const day of nights) {
      expect(day.sleep_start!, day.day).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
      expect(day.sleep_end!, day.day).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);

      expect(localDay(day.sleep_end!, ZONE), day.day).toBe(day.day);
      const wake = localMinutesOfDay(day.sleep_end!, ZONE);
      expect(wake, day.day).toBeGreaterThanOrEqual(6 * 60);
      expect(wake, day.day).toBeLessThanOrEqual(9 * 60 + 30);

      const startDay = localDay(day.sleep_start!, ZONE);
      const bed = localMinutesOfDay(day.sleep_start!, ZONE);
      if (startDay === day.day) {
        afterMidnight += 1;
        expect(bed, day.day).toBeLessThan(3 * 60 + 30);
      } else {
        expect(startDay, day.day).toBe(addDays(day.day, -1));
        expect(bed, day.day).toBeGreaterThanOrEqual(20 * 60);
      }
    }
    expect(afterMidnight).toBeGreaterThan(0);
    expect(afterMidnight).toBeLessThan(nights.length / 2);
  });

  it("has sleep stages that add up", () => {
    for (const day of data.days.filter((item) => item.sleep_start !== null)) {
      const inBed = minutesBetween(day.sleep_start!, day.sleep_end!);
      const stages = day.sleep_deep_min! + day.sleep_rem_min! + day.sleep_light_min!;
      expect(stages, day.day).toBe(day.sleep_minutes);
      expect(day.sleep_minutes! + day.sleep_awake_min!, day.day).toBe(inBed);
      expect(inBed, day.day).toBeGreaterThanOrEqual(300);
      expect(inBed, day.day).toBeLessThanOrEqual(570);
      expect(day.sleep_deep_min!, day.day).toBeGreaterThan(0);
      expect(day.sleep_light_min!, day.day).toBeGreaterThan(day.sleep_deep_min!);
      expect(day.nap_minutes, day.day).not.toBeNull();
    }
  });

  it("leaves every sleep field empty on a night without data", () => {
    for (const day of data.days.filter((item) => item.sleep_start === null)) {
      for (const key of SLEEP_KEYS) expect(day[key], `${day.day} ${key}`).toBeNull();
    }
  });

  it("has well-formed workouts", () => {
    for (const day of data.days) {
      let previousEnd = 0;
      for (const workout of day.workouts) {
        const label = workout.id;
        expect(WORKOUT_TYPES, label).toContain(workout.type);
        expect(workout.day, label).toBe(day.day);
        expect(workout.id, label).toMatch(/^demo-/);
        expect(workout.start, label).toMatch(/\+00:00$/);
        expect(workout.end, label).toMatch(/\+00:00$/);
        expect(localDay(workout.start, ZONE), label).toBe(day.day);
        expect(localDay(workout.end, ZONE), label).toBe(day.day);
        expect(workout.duration_s, label).toBe(minutesBetween(workout.start, workout.end) * 60);
        expect(workout.duration_s, label).toBeGreaterThanOrEqual(20 * 60);

        // Workouts on one day are in order and never overlap; none starts during the night's sleep.
        expect(Date.parse(workout.start), label).toBeGreaterThan(previousEnd);
        previousEnd = Date.parse(workout.end);
        if (day.sleep_end !== null) {
          expect(Date.parse(workout.start), label).toBeGreaterThan(Date.parse(day.sleep_end));
        }

        const zones = workout.zone_light_min + workout.zone_moderate_min + workout.zone_vigorous_min;
        expect(zones, label).toBeLessThanOrEqual(workout.duration_s / 60);
        if (workout.hr_avg === null) {
          expect([workout.hr_max, workout.hr_min, workout.kcal_est], label).toEqual([null, null, null]);
          expect(zones, label).toBe(0);
        } else {
          expect(workout.hr_min!, label).toBeLessThan(workout.hr_avg);
          expect(workout.hr_max!, label).toBeGreaterThan(workout.hr_avg);
          expect(workout.kcal_est!, label).toBeGreaterThan(0);
        }
        if (workout.distance_m !== null) expect(workout.distance_m, label).toBeGreaterThan(500);
      }
    }
  });

  it("stays inside the requested span", () => {
    const length = diffDays(data.days[0].day, data.days[data.days.length - 1].day) + 1;
    expect([60, 120]).toContain(length);
    expect(data.first_day).toBe(data.days[0].day);
    expect(data.last_day).toBe(data.days[data.days.length - 1].day);
  });
});

describe("demo scores, sleep timelines and workout strain", () => {
  const days = dataset.days;
  const finished = days.filter((day) => day.complete);
  const scored = (day: Day) => day.scores!;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const STATUSES = ["detraining", "recovering", "maintaining", "productive", "overreaching"];

  it("scores every day, under the day's own date", () => {
    for (const day of days) {
      expect(day.scores, day.day).toBeTruthy();
      expect(scored(day).day, day.day).toBe(day.day);
    }
  });

  it("keeps strain at 4-19 on finished days with heart rate, and none without", () => {
    for (const day of finished) {
      if (day.hr_resting === null) {
        expect(scored(day).strain, day.day).toBeNull();
        continue;
      }
      expect(scored(day).strain!, day.day).toBeGreaterThanOrEqual(4);
      expect(scored(day).strain!, day.day).toBeLessThanOrEqual(19);
    }
    const strains = finished.flatMap((day) => (scored(day).strain === null ? [] : [scored(day).strain!]));
    expect(Math.min(...strains)).toBeLessThan(8);
    expect(Math.max(...strains)).toBeGreaterThan(15);
    const withWorkout = finished.filter((day) => day.workouts.length > 0 && scored(day).strain !== null);
    const without = finished.filter((day) => day.workouts.length === 0 && scored(day).strain !== null);
    expect(mean(withWorkout.map((day) => scored(day).strain!))).toBeGreaterThan(
      mean(without.map((day) => scored(day).strain!)) + 3,
    );
  });

  it("asks for 8 to 10 hours of sleep", () => {
    for (const day of days) {
      expect(scored(day).sleep_need_minutes!, day.day).toBeGreaterThanOrEqual(480);
      expect(scored(day).sleep_need_minutes!, day.day).toBeLessThanOrEqual(600);
    }
    expect(new Set(days.map((day) => scored(day).sleep_need_minutes)).size).toBeGreaterThan(20);
  });

  it("keeps 0-100 scores in range, with their parts and notes", () => {
    for (const day of days) {
      const scores = scored(day);
      for (const key of ["readiness", "sleep_performance", "apple_sleep", "activity"] as const) {
        const score = scores[key];
        if (score.value !== null) {
          expect(score.value, `${day.day} ${key}`).toBeGreaterThanOrEqual(0);
          expect(score.value, `${day.day} ${key}`).toBeLessThanOrEqual(100);
        }
        for (const part of Object.values(score.components)) {
          if (part !== null) expect(part, `${day.day} ${key}`).toBeGreaterThanOrEqual(0);
        }
      }
      expect(Object.keys(scores.readiness.components).sort()).toEqual([
        "activity_balance",
        "previous_day_activity",
        "recovery_index",
        "resting_hr",
        "sleep",
        "sleep_balance",
        "sleep_regularity",
      ]);
      expect(Object.keys(scores.activity.components)).toHaveLength(6);
      if (scores.readiness.value !== null) expect(scores.readiness.note).toBe("estimate");
      expect(scores.whoop_age.note).toBe("estimate");
      expect(scores.whoop_age.value!).toBeGreaterThan(13);
      expect(scores.whoop_age.value!).toBeLessThan(21);
    }
  });

  it("has no sleep scores on a night without sleep, and no readiness without the watch", () => {
    const sleepless = days.filter((day) => day.sleep_start === null);
    expect(sleepless.length).toBeGreaterThan(0);
    for (const day of sleepless) {
      expect(scored(day).sleep_performance, day.day).toMatchObject({ value: null, note: "no sleep recorded" });
      expect(scored(day).apple_sleep.value, day.day).toBeNull();
    }
    for (const day of days.filter((item) => item.hr_resting === null)) {
      expect(scored(day).readiness, day.day).toMatchObject({ value: null, note: "no data" });
      expect(scored(day).night_signal.level, day.day).toBeNull();
    }
  });

  it("makes the day score the mean of its three parts", () => {
    for (const day of days) {
      const scores = scored(day);
      const parts = [scores.readiness.value, scores.sleep_performance.value, scores.activity.value].flatMap(
        (value) => (value === null ? [] : [value]),
      );
      if (parts.length === 0) {
        expect(scores.day_score, day.day).toBeNull();
        continue;
      }
      const expected = scores.night_signal.level === "red" ? Math.min(50, mean(parts)) : mean(parts);
      expect(scores.day_score!, day.day).toBeCloseTo(expected, 0);
    }
  });

  it("has occasional yellow nights and exactly one pair of red ones", () => {
    const byDay = new Map(days.map((day) => [day.day, day]));
    const red = days.filter((day) => scored(day).night_signal.level === "red").map((day) => day.day);
    expect(red).toHaveLength(2);
    expect(red[1]).toBe(addDays(red[0], 1));
    // The night before a red pair is the first elevated one, so it is yellow.
    expect(scored(byDay.get(addDays(red[0], -1))!).night_signal.level).toBe("yellow");
    const yellow = days.filter((day) => scored(day).night_signal.level === "yellow").length;
    expect(yellow).toBeGreaterThanOrEqual(3);
    expect(yellow).toBeLessThanOrEqual(12);
    for (const day of red) {
      const scores = scored(byDay.get(day)!);
      expect(scores.night_signal.delta!).toBeGreaterThanOrEqual(4);
      expect(scores.night_signal.night_hr!).toBeCloseTo(scores.night_signal.baseline! + scores.night_signal.delta!, 1);
      expect(scores.day_score!).toBeLessThanOrEqual(50);
    }
  });

  it("gives a load status from the last 7 against the last 28 days", () => {
    const statuses = new Set(days.map((day) => scored(day).cardio_load.status));
    expect(statuses.size).toBeGreaterThanOrEqual(2);
    for (const status of statuses) expect(STATUSES).toContain(status);
    for (const day of days) {
      const load = scored(day).cardio_load;
      if (load.ratio !== null) expect(load.ratio).toBeCloseTo(load.strain_7d! / load.tolerance_28d!, 1);
    }
  });

  it("gives every workout with heart rate a strain of 0-21", () => {
    const workouts = days.flatMap((day) => day.workouts);
    for (const workout of workouts) {
      if (workout.hr_avg === null) expect(workout.strain, workout.id).toBeNull();
      else {
        expect(workout.strain!, workout.id).toBeGreaterThan(2);
        expect(workout.strain!, workout.id).toBeLessThanOrEqual(21);
      }
    }
    const strainOf = (type: string) =>
      mean(workouts.filter((workout) => workout.type === type && workout.strain != null).map((workout) => workout.strain!));
    expect(strainOf("running")).toBeGreaterThan(strainOf("walking"));
  });

  it("draws a stage timeline of the main sleep that matches the stage totals", () => {
    for (const day of days) {
      if (day.sleep_start === null) {
        expect(day.sleep_timeline, day.day).toBeNull();
        continue;
      }
      const timeline = day.sleep_timeline!;
      expect(timeline[0].start, day.day).toBe(day.sleep_start);
      expect(timeline[timeline.length - 1].end, day.day).toBe(day.sleep_end);
      const totals: Record<string, number> = {};
      timeline.forEach((interval, index) => {
        expect(["deep", "rem", "light", "awake"], day.day).toContain(interval.stage);
        expect(Date.parse(interval.end), day.day).toBeGreaterThan(Date.parse(interval.start));
        if (index > 0) {
          expect(interval.start, day.day).toBe(timeline[index - 1].end);
          expect(interval.stage, day.day).not.toBe(timeline[index - 1].stage);
        }
        totals[interval.stage] = (totals[interval.stage] ?? 0) + minutesBetween(interval.start, interval.end);
      });
      expect(totals.deep, day.day).toBe(day.sleep_deep_min);
      expect(totals.rem, day.day).toBe(day.sleep_rem_min);
      expect(totals.light, day.day).toBe(day.sleep_light_min);
      expect(totals.awake ?? 0, day.day).toBe(day.sleep_awake_min);
      // Deep sleep comes early in the night.
      const firstDeep = timeline.find((interval) => interval.stage === "deep")!;
      expect(minutesBetween(day.sleep_start, firstDeep.start), day.day).toBeLessThan(90);
    }
  });
});

describe("demo entries from Samsung Health and calibration", () => {
  const live = demoDataset("2026-10-16");
  const days = live.days;
  const today = days[days.length - 1];
  const finishedWindow = days.filter((day) => day.complete && day.day >= addDays("2026-10-16", -30));

  it("gives some recent days an entry and leaves others missing, never the running day", () => {
    const withEntry = finishedWindow.filter((day) => hasEntry(day.samsung));
    expect(withEntry.length).toBeGreaterThan(10);
    expect(finishedWindow.length - withEntry.length).toBeGreaterThan(3);
    expect(today.samsung).toBeNull();
    // Before the demo user started, there are none.
    expect(days.filter((day) => day.day < "2026-08-20").every((day) => day.samsung === null)).toBe(true);
  });

  it("keeps every entry inside owi's ranges, on its own day", () => {
    for (const day of days) {
      if (!day.samsung) continue;
      expect(day.samsung.day, day.day).toBe(day.day);
      const entry = day.samsung;
      const values = Object.fromEntries(ENTRY_FIELDS.map((spec) => [spec.key, entry[spec.key]]));
      expect(checkBody(values), day.day).toEqual({ ok: true, values });
      expect(Date.parse(String(entry.saved_at)), day.day).toBeGreaterThan(Date.parse(`${day.day}T00:00:00Z`));
    }
    const filled = (key: keyof Entry) => days.filter((day) => day.samsung && day.samsung[key] !== null).length;
    expect(filled("sleep_score")).toBeGreaterThan(filled("energy_score"));
    expect(filled("energy_score")).toBeGreaterThan(0);
  });

  it("has a Samsung Sleep Score on recent nights, still learning on early ones", () => {
    const sleep = days.map((day) => day.scores!.samsung_sleep!);
    expect(sleep.some((score) => score.note === "learning")).toBe(true);
    expect(sleep[0]).toEqual({ value: null, components: { entries: 0, needed: 10 }, note: "learning" });
    const last = days.filter((day) => day.sleep_minutes !== null).at(-1)!.scores!.samsung_sleep!;
    expect(last.note).toBeNull();
    expect(last.value!).toBeGreaterThan(30);
    expect(last.value!).toBeLessThanOrEqual(100);
  });

  it("keeps the Energy Score learning, with fewer than ten entries", () => {
    const energy = today.scores!.energy_score!;
    expect(energy.note).toBe("learning");
    expect(energy.components.needed).toBe(10);
    expect(energy.components.entries!).toBeGreaterThan(0);
    expect(energy.components.entries!).toBeLessThan(10);
    // Later on enough entries exist and it shows.
    const later = demoDataset("2027-03-01", 30).days.at(-1)!.scores!.energy_score!;
    expect(later.value).not.toBeNull();
  });

  it("has Samsung send its own numbers on recent days, which the entries then leave out", () => {
    const sending = days.filter((day) => day.samsung_auto);
    expect(sending.length).toBeGreaterThan(8);
    expect(sending[0].day >= "2026-10-04").toBe(true);
    expect(days.filter((day) => day.day < "2026-10-04").every((day) => day.samsung_auto === null)).toBe(true);
    // The running day already has Samsung's steps so far.
    expect(today.samsung_auto?.steps).not.toBeNull();
    for (const day of sending) {
      const auto = day.samsung_auto!;
      expect(checkBody({ steps: auto.steps, active_kcal: auto.active_kcal, sleep_score: auto.sleep_score }).ok, day.day).toBe(true);
      for (const field of AUTO_FIELDS) {
        if (auto[field] !== null) expect(day.samsung?.[field] ?? null, `${day.day} ${field}`).toBeNull();
      }
    }
  });

  it("reports calibration measured on the entries of the window", () => {
    const calibration = live.calibration!;
    expect(calibration.entries).toBe(
      days.filter((day) => hasEntry(day.samsung) || AUTO_FIELDS.some((field) => tunedValue(day, field) !== null)).length,
    );
    expect(calibration.entries).toBeGreaterThan(days.filter((day) => day.samsung).length);
    expect(calibration.fitted_at).toBe(live.synced_at);
    expect(calibration.params.stride_m).not.toBe(calibration.defaults.stride_m);
    const quality = calibration.quality;
    expect(Object.keys(quality).sort()).toEqual(["active_kcal", "active_minutes", "distance_km", "sleep_score", "total_kcal"]);
    expect(quality.distance_km!.unit).toBe("%");
    expect(quality.sleep_score!.unit).toBe("body");
    expect(quality.sleep_score!.previous_error).toBeNull();
    expect(quality.distance_km!.error!).toBeLessThan(quality.distance_km!.previous_error!);
    expect(quality.total_kcal!.error!).toBeGreaterThan(quality.total_kcal!.previous_error!);
    for (const item of Object.values(quality)) {
      expect(item.n).toBeGreaterThan(0);
      expect(item.error!).toBeGreaterThan(0);
      expect(item.error!).toBeLessThan(25);
    }
  });

  it("has no calibration to speak of before the first entry", () => {
    const early = demoDataset("2026-06-01", 30).calibration!;
    expect(early).toMatchObject({ fitted_at: null, entries: 0, quality: {} });
  });
});
