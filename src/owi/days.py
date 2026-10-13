"""Local calendar days expressed as UTC windows."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def day_window(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """UTC start (inclusive) and end (exclusive) of a local day; 23 or 25 h on DST changes."""
    start = datetime.combine(day, time.min, tzinfo=tz)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def local_date(timestamp: datetime, tz: ZoneInfo) -> date:
    return timestamp.astimezone(tz).date()


def today(tz: ZoneInfo, now: datetime | None = None) -> date:
    return local_date(now or datetime.now(UTC), tz)


def elapsed_fraction(day: date, tz: ZoneInfo, now: datetime) -> float:
    """Share of the local day that has passed at `now`, between 0 and 1."""
    start, end = day_window(day, tz)
    if now <= start:
        return 0.0
    if now >= end:
        return 1.0
    return (now - start) / (end - start)
