"""Heart-rate series, resting heart rate, statistics and zones."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import fmean

from owi.models import HEART_RATE, Sample

RESTING_WINDOW_MINUTES = 30
MIN_MINUTES_FOR_RESTING = 60
LIGHT_SHARE = 0.50
MODERATE_SHARE = 0.70
VIGOROUS_SHARE = 0.85
_ONE_MINUTE = timedelta(minutes=1)


@dataclass(frozen=True)
class HeartStats:
    avg: float | None
    minimum: float | None
    maximum: float | None


@dataclass(frozen=True)
class ZoneMinutes:
    light: int
    moderate: int
    vigorous: int


def minute_series(samples: Iterable[Sample]) -> dict[datetime, float]:
    """Mean heart rate per minute, keyed by the minute's start, in time order."""
    buckets: dict[datetime, list[float]] = defaultdict(list)
    for item in samples:
        if item.type == HEART_RATE:
            buckets[item.timestamp.replace(second=0, microsecond=0)].append(item.value)
    return {minute: fmean(buckets[minute]) for minute in sorted(buckets)}


def resting_hr(minute_hr: Mapping[datetime, float]) -> float | None:
    """Lowest 30-minute rolling mean over consecutive minutes.

    Without any 30-minute run the 5th percentile stands in; under an hour of data
    there is no estimate at all.
    """
    if len(minute_hr) < MIN_MINUTES_FOR_RESTING:
        return None

    minutes = sorted(minute_hr)
    best: float | None = None
    run_start = 0
    for index, minute in enumerate(minutes):
        if index > 0 and minute - minutes[index - 1] != _ONE_MINUTE:
            run_start = index
        if index - run_start + 1 >= RESTING_WINDOW_MINUTES:
            window = minutes[index - RESTING_WINDOW_MINUTES + 1 : index + 1]
            mean = fmean(minute_hr[m] for m in window)
            if best is None or mean < best:
                best = mean
    if best is not None:
        return best

    values = sorted(minute_hr.values())
    return values[int(0.05 * (len(values) - 1))]


def stats(samples: Iterable[Sample], minute_hr: Mapping[datetime, float]) -> HeartStats:
    raw = [item.value for item in samples if item.type == HEART_RATE]
    if not raw or not minute_hr:
        return HeartStats(avg=None, minimum=None, maximum=None)
    values = list(minute_hr.values())
    return HeartStats(avg=fmean(values), minimum=min(values), maximum=max(raw))


def zone_minutes(minute_hr: Mapping[datetime, float], max_hr: float) -> ZoneMinutes:
    light = moderate = vigorous = 0
    for value in minute_hr.values():
        share = value / max_hr
        if share >= VIGOROUS_SHARE:
            vigorous += 1
        elif share >= MODERATE_SHARE:
            moderate += 1
        elif share >= LIGHT_SHARE:
            light += 1
    return ZoneMinutes(light=light, moderate=moderate, vigorous=vigorous)
