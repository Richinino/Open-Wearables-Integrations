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
  /** WHOOP-style strain of this workout, 0-21; absent until owi has scored it. */
  strain?: number | null;
}

export type SleepStage = "deep" | "rem" | "light" | "awake" | "asleep";

/** One stretch of the sleep stage timeline. ISO 8601, UTC. */
export interface SleepInterval {
  start: string;
  end: string;
  stage: SleepStage;
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
  /** Stage timeline of the main sleep and naps of this day, oldest first. */
  sleep_timeline?: SleepInterval[] | null;
  /** Scores computed by owi for this day; absent until owi has scored it. */
  scores?: DayScores | null;
}

/** A score with the parts it was built from. Mirrors owi's score_models.Score. */
export interface Score {
  value: number | null;
  components: Record<string, number | null>;
  /** Why the value is missing or limited, e.g. "too little history" or "estimate". */
  note: string | null;
}

export type CardioLoadStatus = "detraining" | "recovering" | "maintaining" | "productive" | "overreaching";

export interface CardioLoad {
  strain_7d: number | null;
  tolerance_28d: number | null;
  ratio: number | null;
  status: CardioLoadStatus | null;
}

export interface NightSignal {
  level: "green" | "yellow" | "red" | null;
  night_hr: number | null;
  baseline: number | null;
  delta: number | null;
}

/** Mirrors owi's score_models.DayScores; field names follow the API. */
export interface DayScores {
  day: string;
  /** WHOOP-style strain of the day, 0-21. */
  strain: number | null;
  cardio_load: CardioLoad;
  /** Sleep need for the night that follows this day, in minutes. */
  sleep_need_minutes: number | null;
  /** Last night against the need set the day before (WHOOP-style), 0-100. */
  sleep_performance: Score;
  /** Last night, Apple-style, 0-100 (duration 50, bedtime 30, interruptions 20). */
  apple_sleep: Score;
  /** Sleep Regularity Index over 14 days, -100..100. */
  sleep_regularity: number | null;
  /** Oura-style readiness without HRV and temperature, 0-100. */
  readiness: Score;
  /** Oura-style activity, 0-100. */
  activity: Score;
  night_signal: NightSignal;
  /** Mean of readiness, sleep performance and activity; capped at 50 on a red night signal. */
  day_score: number | null;
  vo2max: number | null;
  vo2max_uth: number | null;
  /** Estimated body age in years; components are per-metric impacts in years. */
  whoop_age: Score;
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
