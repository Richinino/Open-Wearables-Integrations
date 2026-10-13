// Shape of `GET /v1/days` served by `owi serve`. Field names follow the API.

export type StepsSource = "samsung_health_total" | "samsung_hourly" | "phone";

export interface Workout {
  id: string;
  /** Local date the workout belongs to, YYYY-MM-DD. */
  day: string;
  type: string;
  /** ISO 8601, UTC. */
  start: string;
  end: string;
  duration_s: number;
  source: string;
  hr_avg: number | null;
  hr_max: number | null;
  hr_min: number | null;
  zone_light_min: number;
  zone_moderate_min: number;
  zone_vigorous_min: number;
  distance_m: number | null;
  kcal_est: number | null;
}

export interface Day {
  /** Local date, YYYY-MM-DD. */
  day: string;
  timezone: string;
  /** False while the day is still running; cumulative values are partial then. */
  complete: boolean;
  steps: number | null;
  steps_source: StepsSource | null;
  distance_m_est: number | null;
  active_minutes_est: number | null;
  activity_kcal_est: number | null;
  basal_kcal: number | null;
  total_kcal_est: number | null;
  hr_resting: number | null;
  hr_avg: number | null;
  hr_max: number | null;
  hr_min: number | null;
  zone_light_min: number | null;
  zone_moderate_min: number | null;
  zone_vigorous_min: number | null;
  /** Main sleep that ended on this day. ISO 8601, UTC. */
  sleep_start: string | null;
  sleep_end: string | null;
  sleep_minutes: number | null;
  sleep_deep_min: number | null;
  sleep_rem_min: number | null;
  sleep_light_min: number | null;
  sleep_awake_min: number | null;
  nap_minutes: number | null;
  workouts: Workout[];
}

export interface Dataset {
  timezone: string;
  /** Span of everything stored, not of the returned days. */
  first_day: string | null;
  last_day: string | null;
  /** When the results were last recomputed. ISO 8601, UTC. */
  synced_at: string | null;
  /** Oldest first. Days without any data are absent. */
  days: Day[];
}
