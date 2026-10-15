"""Data shared by the score modules.

Scores are computed in two stages. Stage one turns one day's raw inputs into
`DayFeatures` (features.py). Stage two reads a run of stored `DayFeatures`, oldest
first, and produces `DayScores` (scoring.py), because most scores compare a day with
the person's own recent history. Formulas and their sources: docs/skore.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from owi.models import SleepInterval

MALE = "male"
FEMALE = "female"


@dataclass(frozen=True)
class Person:
    """Profile values the formulas depend on. `sex` is MALE or FEMALE."""

    age: int | None = None
    sex: str | None = None
    weight_kg: float | None = None
    height_cm: float | None = None
    body_fat_pct: float | None = None
    max_hr: float | None = None


@dataclass(frozen=True)
class DayFeatures:
    """Everything stage two needs about one local day. Missing data is None, never 0."""

    day: date
    complete: bool
    # Minutes with at least one heart-rate reading; a proxy for how long the watch was worn.
    wear_minutes: int

    # Heart
    resting_hr: float | None  # the day's lowest 30-minute rolling mean (DayResult.hr_resting)
    sleep_rhr: float | None  # lowest 5-minute rolling mean during the main sleep
    sleep_hr_low_at: datetime | None  # when that low began, UTC
    night_hr: float | None  # mean heart rate over the minutes asleep 00:00-07:00 local
    max_hr_seen: float | None  # highest heart rate of the day after spike filtering

    # Load
    trimp: float | None  # Banister TRIMP over the whole day
    strain_load: float | None  # WHOOP-style weighted load of the day, before the 0-21 mapping
    strain: float | None  # 0-21
    workout_strain: dict[str, float] = field(default_factory=dict)  # workout id -> 0-21

    # Activity, from per-minute METs estimated from heart rate
    awake_hr_p10: float | None = None  # 10th percentile of awake minutes outside workouts
    awake_rest_hr: float | None = None  # the resting heart rate the METs were computed with
    met_minutes_medium: float | None = None  # MET-minutes spent at 3-6 MET
    met_minutes_high: float | None = None  # MET-minutes spent at 6+ MET
    medium_minutes: int | None = None  # minutes at 3-6 MET
    high_minutes: int | None = None  # minutes at 6+ MET
    # Awake, worn, below 1.5 MET, outside workouts; with hourly steps, awake worn hours under
    # 250 steps without workouts, each also counted as one long bout.
    inactive_hours: float | None = None
    long_inactive_bouts: int | None = None  # awake inactive stretches of 50+ minutes
    active_kcal: float | None = None  # DayResult.activity_kcal_est
    steps: int | None = None
    zone_low_minutes: int | None = None  # 50-80 % of heart-rate reserve (WHOOP zones 1-3)
    zone_high_minutes: int | None = None  # 80 %+ of heart-rate reserve (WHOOP zones 4-5)
    strength_minutes: float = 0.0  # minutes of strength-type workouts

    # Main sleep that ended on this day, plus naps that started on it
    sleep_start: datetime | None = None
    sleep_end: datetime | None = None
    sleep_minutes: float | None = None  # total sleep time of the main sleep
    in_bed_minutes: float | None = None  # sleep_end - sleep_start
    deep_minutes: float | None = None
    rem_minutes: float | None = None
    light_minutes: float | None = None
    awake_minutes: float | None = None  # wake after sleep onset inside the main sleep
    awake_bouts: int | None = None  # awake stretches of 1+ minute inside the main sleep
    nap_minutes: float = 0.0
    sleep_intervals: tuple[SleepInterval, ...] = ()  # main sleep and naps, for regularity

    # Body
    vo2max: float | None = None  # latest watch estimate up to this day
    weight_kg: float | None = None
    body_fat_pct: float | None = None


@dataclass(frozen=True)
class Score:
    """A 0-100 (or otherwise scaled) score with the parts it was built from."""

    value: float | None
    components: dict[str, float | None] = field(default_factory=dict)
    # Why the value is missing or limited, e.g. "too little history" or "estimate".
    note: str | None = None


@dataclass(frozen=True)
class CardioLoad:
    """Polar-style load status over the last 7 and 28 days."""

    strain_7d: float | None  # mean daily TRIMP over 7 days
    tolerance_28d: float | None  # mean daily TRIMP over 28 days
    ratio: float | None
    # "detraining" | "recovering" | "maintaining" | "productive" | "overreaching"
    status: str | None


@dataclass(frozen=True)
class NightSignal:
    """Alavi et al. 2022: nightly heart rate against the median of all earlier nights."""

    level: str | None  # "green" | "yellow" | "red"
    night_hr: float | None
    baseline: float | None
    delta: float | None


@dataclass(frozen=True)
class DayScores:
    day: date

    # Load
    strain: float | None  # 0-21, the day's WHOOP-style strain
    cardio_load: CardioLoad

    # Sleep
    sleep_need_minutes: float | None  # need for the night that follows this day
    sleep_performance: Score  # last night (ending on `day`) against the need set the day before
    apple_sleep: Score  # last night, Apple-style 0-100
    sleep_regularity: float | None  # Sleep Regularity Index over the last 14 days, -100..100

    # Readiness, activity, overall
    readiness: Score  # Oura-style, without HRV and temperature
    activity: Score  # Oura-style
    night_signal: NightSignal
    day_score: float | None  # mean of readiness, sleep_performance and activity

    # Long term
    vo2max: float | None  # watch estimate
    vo2max_uth: float | None  # 15.3 * max HR / resting HR
    whoop_age: Score  # value = estimated "body age" in years; components per metric
