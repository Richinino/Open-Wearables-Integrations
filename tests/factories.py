"""Builders for synthetic test data. No real health data lives in this repo."""

from datetime import UTC, date, datetime, time, timedelta

from owi.models import (
    HEART_RATE,
    SHEALTH_SOURCE,
    HealthScore,
    Sample,
    SleepInterval,
    SleepSession,
    SourceRef,
    Workout,
)
from owi.score_models import CardioLoad, DayFeatures, DayScores, NightSignal, Score

HC_SHEALTH = SourceRef("google", SHEALTH_SOURCE)
HC_PHONE = SourceRef("google", "com.android.healthconnect.phone.abc", "SM-A000")
SAMSUNG_PHONE = SourceRef("samsung", "phone", "SM-A000")
SAMSUNG_WATCH = SourceRef("samsung", "Galaxy Watch", "SM-R000")


def utc(
    year: int, month: int, day: int, hour: int = 0, minute: int = 0, second: int = 0
) -> datetime:
    return datetime(year, month, day, hour, minute, second, tzinfo=UTC)


def sample(timestamp: datetime, type_: str, value: float, source: SourceRef = HC_SHEALTH) -> Sample:
    return Sample(timestamp=timestamp, type=type_, value=float(value), source=source)


def hr_minutes(
    start: datetime, values: list[float], source: SourceRef = HC_SHEALTH
) -> list[Sample]:
    """One heart-rate sample per consecutive minute, starting at `start`."""
    return [
        sample(start + timedelta(minutes=i), HEART_RATE, value, source)
        for i, value in enumerate(values)
    ]


def workout(
    id_: str,
    start: datetime,
    minutes: int,
    type_: str = "running",
    source: SourceRef = HC_SHEALTH,
    distance_m: float | None = None,
) -> Workout:
    return Workout(
        id=id_,
        type=type_,
        start=start,
        end=start + timedelta(minutes=minutes),
        source=source,
        distance_m=distance_m,
    )


def sleep_session(
    id_: str,
    start: datetime,
    end: datetime,
    source: SourceRef = HC_SHEALTH,
    sleep_minutes: float | None = None,
    is_nap: bool = False,
) -> SleepSession:
    return SleepSession(
        id=id_, start=start, end=end, source=source, sleep_minutes=sleep_minutes, is_nap=is_nap
    )


def sleep_score(
    id_: str, value: float, recorded_at: datetime, event_record_id: str | None = None
) -> HealthScore:
    """Samsung's Sleep Score as Open Wearables serves it; `recorded_at` is the sleep start."""
    return HealthScore(
        id=id_,
        category="sleep",
        value=float(value),
        recorded_at=recorded_at,
        provider="samsung",
        event_record_id=event_record_id,
    )


def make_features(day: date, **fields: object) -> DayFeatures:
    """DayFeatures with every value filled in; override any of them by keyword."""
    night_start = datetime.combine(day, time(), tzinfo=UTC) - timedelta(hours=2)
    values: dict[str, object] = {
        "complete": True,
        "wear_minutes": 1400,
        "resting_hr": 50.5,
        "sleep_rhr": 48.25,
        "sleep_hr_low_at": night_start + timedelta(hours=4),
        "night_hr": 52.0,
        "max_hr_seen": 181.0,
        "trimp": 85.5,
        "strain_load": 70.0,
        "strain": 11.2,
        "workout_strain": {"w1": 9.5},
        "awake_hr_p10": 62.0,
        "awake_rest_hr": 61.5,
        "met_minutes_medium": 300.0,
        "met_minutes_high": 120.0,
        "medium_minutes": 80,
        "high_minutes": 15,
        "inactive_hours": 9.5,
        "long_inactive_bouts": 2,
        "active_kcal": 500.0,
        "steps": 9000,
        "zone_low_minutes": 40,
        "zone_high_minutes": 5,
        "strength_minutes": 30.0,
        "sleep_start": night_start,
        "sleep_end": night_start + timedelta(hours=9),
        "sleep_minutes": 500.0,
        "in_bed_minutes": 540.0,
        "deep_minutes": 90.0,
        "rem_minutes": 110.0,
        "light_minutes": 300.0,
        "awake_minutes": 40.0,
        "awake_bouts": 3,
        "nap_minutes": 0.0,
        "sleep_intervals": (
            SleepInterval(night_start, night_start + timedelta(hours=4), "light"),
            SleepInterval(
                night_start + timedelta(hours=4), night_start + timedelta(hours=9), "deep"
            ),
        ),
        "vo2max": 48.0,
        "weight_kg": 70.0,
        "body_fat_pct": 15.0,
    }
    values.update(fields)
    return DayFeatures(day=day, **values)  # type: ignore[arg-type]


def make_scores(day: date, **fields: object) -> DayScores:
    """DayScores with every value filled in; override any of them by keyword."""
    values: dict[str, object] = {
        "strain": 11.2,
        "cardio_load": CardioLoad(80.0, 70.0, 80.0 / 70.0, "productive"),
        "sleep_need_minutes": 512.5,
        "sleep_performance": Score(91.0, {"hours_vs_needed": 95.0, "consistency": None}, None),
        "apple_sleep": Score(88.5, {"duration": 50.0, "bedtime": 25.0}, "estimate"),
        "sleep_regularity": 80.5,
        "readiness": Score(None, {"sleep": 90.0}, "too little history"),
        "activity": Score(75.0, {}, None),
        "night_signal": NightSignal("green", 52.0, 51.0, 1.0),
        "day_score": 83.0,
        "vo2max": 48.0,
        "vo2max_uth": 61.2,
        "whoop_age": Score(15.2, {"steps": -0.5, "vo2max": None}, "estimate"),
    }
    values.update(fields)
    return DayScores(day=day, **values)  # type: ignore[arg-type]
