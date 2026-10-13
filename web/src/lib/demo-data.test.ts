import { describe, expect, it } from "vitest";

import { addDays, dateRange, diffDays, localDay, localMinutesOfDay, weekdayIndex } from "./dates";
import { demoDataset } from "./demo-data";
import type { Dataset, Day } from "./types";

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
    expect(demoDataset(TODAY, 0)).toEqual({
      timezone: ZONE,
      first_day: null,
      last_day: null,
      synced_at: null,
      days: [],
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
