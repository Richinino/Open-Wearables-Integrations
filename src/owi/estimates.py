"""Estimates Samsung Health computes itself and never shares: distance, active time, calories."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta

from owi.models import Params, Profile

REST_VO2 = 3.5  # ml/kg/min at rest
KCAL_PER_LITRE_O2 = 5.0
_ONE_MINUTE = timedelta(minutes=1)


def distance_m(steps: int | None, params: Params) -> float | None:
    return None if steps is None else steps * params.stride_m


def _interval_minutes(
    intervals: Iterable[tuple[datetime, datetime]], start: datetime, end: datetime
) -> set[datetime]:
    minutes: set[datetime] = set()
    for begin, finish in intervals:
        current = max(begin, start).replace(second=0, microsecond=0)
        stop = min(finish, end)
        while current < stop:
            minutes.add(current)
            current += _ONE_MINUTE
    return minutes


def active_minutes(
    minute_hr: Mapping[datetime, float],
    resting_hr: float | None,
    intervals: Iterable[tuple[datetime, datetime]],
    start: datetime,
    end: datetime,
    hr_delta: float,
) -> set[datetime]:
    """Minutes inside a workout, plus minutes with heart rate at least resting + delta."""
    active = _interval_minutes(intervals, start, end)
    if resting_hr is not None:
        threshold = resting_hr + hr_delta
        active.update(
            minute
            for minute, value in minute_hr.items()
            if start <= minute < end and value >= threshold
        )
    return active


def kcal_per_minute(hr: float, resting_hr: float | None, profile: Profile) -> float | None:
    """Net energy above rest, from the share of heart-rate reserve in use.

    VO2 scales linearly between rest and VO2max with heart-rate reserve; one litre of
    oxygen is worth about 5 kcal.
    """
    if resting_hr is None or profile.weight_kg is None or profile.vo2max is None:
        return None
    reserve = profile.max_hr - resting_hr
    if reserve <= 0:
        return None
    share = min(max((hr - resting_hr) / reserve, 0.0), 1.0)
    net_vo2 = share * (profile.vo2max - REST_VO2)
    return net_vo2 * profile.weight_kg / 1000 * KCAL_PER_LITRE_O2


def activity_kcal(
    minute_hr: Mapping[datetime, float],
    active: Iterable[datetime],
    resting_hr: float | None,
    profile: Profile,
    kcal_scale: float,
) -> float | None:
    """Scaled net calories over the active minutes that have a heart-rate reading."""
    if kcal_per_minute(profile.max_hr, resting_hr, profile) is None:
        return None
    total = 0.0
    for minute in active:
        value = minute_hr.get(minute)
        if value is not None:
            total += kcal_per_minute(value, resting_hr, profile) or 0.0
    return total * kcal_scale


def total_kcal(
    activity: float | None, profile: Profile, elapsed_fraction: float
) -> tuple[float | None, float | None]:
    """(basal, total). Basal is prorated for a day still in progress."""
    if profile.basal_kcal_per_day is None:
        return None, None
    basal = profile.basal_kcal_per_day * elapsed_fraction
    return basal, None if activity is None else basal + activity
