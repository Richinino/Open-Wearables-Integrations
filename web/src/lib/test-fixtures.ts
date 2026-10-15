// Builders for invented days in tests. Not imported by the app.

import type { Day, DayScores, Score, Workout } from "./types";

export const ZONE = "Europe/Bratislava";

export function makeDay(day: string, values: Partial<Day> = {}): Day {
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

export function makeWorkout(id: string, values: Partial<Workout> = {}): Workout {
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

export function makeScore(value: number | null, components: Record<string, number | null> = {}, note: string | null = null): Score {
  return { value, components, note };
}

export function makeScores(day: string, values: Partial<DayScores> = {}): DayScores {
  return {
    day,
    strain: null,
    cardio_load: { strain_7d: null, tolerance_28d: null, ratio: null, status: null },
    sleep_need_minutes: null,
    sleep_performance: makeScore(null),
    apple_sleep: makeScore(null),
    sleep_regularity: null,
    readiness: makeScore(null),
    activity: makeScore(null),
    night_signal: { level: null, night_hr: null, baseline: null, delta: null },
    day_score: null,
    vo2max: null,
    vo2max_uth: null,
    whoop_age: makeScore(null),
    ...values,
  };
}
