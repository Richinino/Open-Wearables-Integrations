"""Shared data types. Every other owi module talks through these."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

HC_PROVIDERS = frozenset({"google", "health_connect"})
SAMSUNG_PROVIDER = "samsung"
SHEALTH_SOURCE = "com.sec.android.app.shealth"

STEPS = "steps"
HEART_RATE = "heart_rate"
DISTANCE = "distance_walking_running"
WEIGHT = "weight"
VO2_MAX = "vo2_max"
BASAL_ENERGY = "basal_energy"
BODY_FAT = "body_fat_percentage"

DEFAULT_MAX_HR = 190.0


@dataclass(frozen=True)
class SourceRef:
    """Where a record came from. `provider` is lower-case."""

    provider: str
    source: str | None = None
    device: str | None = None

    @property
    def is_health_connect(self) -> bool:
        return self.provider in HC_PROVIDERS

    @property
    def is_samsung_direct(self) -> bool:
        return self.provider == SAMSUNG_PROVIDER

    @property
    def is_samsung_health_app(self) -> bool:
        """Written to Health Connect by the Samsung Health app."""
        return self.is_health_connect and self.source == SHEALTH_SOURCE


@dataclass(frozen=True)
class Sample:
    timestamp: datetime  # timezone-aware, UTC
    type: str
    value: float
    source: SourceRef


@dataclass(frozen=True)
class Workout:
    id: str
    type: str
    start: datetime
    end: datetime
    source: SourceRef
    distance_m: float | None = None


@dataclass(frozen=True)
class SleepInterval:
    """One stretch of a sleep stage timeline. `stage` is deep, rem, light, awake or asleep."""

    start: datetime
    end: datetime
    stage: str


@dataclass(frozen=True)
class SleepSession:
    id: str
    start: datetime
    end: datetime
    source: SourceRef
    sleep_minutes: float | None = None
    deep_minutes: float | None = None
    rem_minutes: float | None = None
    light_minutes: float | None = None
    awake_minutes: float | None = None
    is_nap: bool = False
    intervals: tuple[SleepInterval, ...] = ()


@dataclass(frozen=True)
class Params:
    """Tunable estimate parameters; calibration replaces the defaults.

    `max_hr` is the maximum heart rate the other values were fitted with. Estimates
    depend on it, so later runs reuse it instead of deriving their own. `basal_kcal` stands
    in for the basal expenditure only on days without Samsung's record or a configured one.
    """

    stride_m: float = 0.74
    active_hr_delta: float = 30.0
    kcal_scale: float = 1.0
    max_hr: float | None = None
    basal_kcal: float | None = None


@dataclass(frozen=True)
class Profile:
    weight_kg: float | None = None
    vo2max: float | None = None
    basal_kcal_per_day: float | None = None
    max_hr: float = DEFAULT_MAX_HR
    body_fat_pct: float | None = None


@dataclass(frozen=True)
class DayInputs:
    """Everything fetched for one local day, already clipped to its window.

    The last two fields reach outside the window. Only the score features read them, so the
    DayResult stays a pure function of the day itself.
    """

    day: date
    start: datetime  # window start, UTC
    end: datetime  # window end, UTC (exclusive)
    samples: tuple[Sample, ...]
    workouts: tuple[Workout, ...]
    sleeps: tuple[SleepSession, ...]
    profile: Profile
    complete: bool = True
    elapsed_fraction: float = 1.0
    # Heart rate before `start`, back to the start of the night's sleep.
    lead_in_samples: tuple[Sample, ...] = ()
    # Sleeps that start in the window and end after it: tonight's.
    tonight_sleeps: tuple[SleepSession, ...] = ()


@dataclass(frozen=True)
class WorkoutResult:
    id: str
    day: date
    type: str
    start: datetime
    end: datetime
    duration_s: int
    source: str
    hr_avg: float | None
    hr_max: float | None
    hr_min: float | None
    zone_light_min: int
    zone_moderate_min: int
    zone_vigorous_min: int
    distance_m: float | None
    kcal_est: float | None
    phone_steps: int | None = None  # the phone pedometer's steps inside the workout


@dataclass(frozen=True)
class DayResult:
    day: date
    timezone: str
    complete: bool
    steps: int | None
    steps_source: str | None
    distance_m_est: float | None
    active_minutes_est: int | None
    activity_kcal_est: float | None
    basal_kcal: float | None
    total_kcal_est: float | None
    hr_resting: float | None
    hr_avg: float | None
    hr_max: float | None
    hr_min: float | None
    zone_light_min: int | None
    zone_moderate_min: int | None
    zone_vigorous_min: int | None
    sleep_start: datetime | None
    sleep_end: datetime | None
    sleep_minutes: float | None
    sleep_deep_min: float | None
    sleep_rem_min: float | None
    sleep_light_min: float | None
    sleep_awake_min: float | None
    nap_minutes: float | None
    workouts: tuple[WorkoutResult, ...] = ()
