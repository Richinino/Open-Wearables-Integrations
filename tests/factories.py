"""Builders for synthetic test data. No real health data lives in this repo."""

from datetime import UTC, datetime, timedelta

from owi.models import HEART_RATE, SHEALTH_SOURCE, Sample, SleepSession, SourceRef, Workout

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
