"""Values the devices measured, picked from the best source of the day.

Several sources can report the same series (the watch, the phone, Health Connect). Their
records overlap, so they are never added together: the best-ranked source that has the series
that day is used on its own.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from statistics import fmean

from owi.models import (
    ACTIVE_ENERGY,
    DISTANCE,
    HRV_RMSSD,
    HRV_SDNN,
    RESTING_HR,
    TOTAL_ENERGY,
    Sample,
    SleepSession,
    SourceRef,
    source_order,
)

MEASURED = "measured"
ESTIMATED = "estimated"
DERIVED = "derived"
RMSSD = "rmssd"
SDNN = "sdnn"

# Series fetched for the measured values, besides the ones the estimates already need.
TYPES = (TOTAL_ENERGY, RESTING_HR, HRV_RMSSD, HRV_SDNN)


@dataclass(frozen=True)
class Measured:
    distance_m: float | None = None
    active_kcal: float | None = None
    total_kcal: float | None = None
    resting_hr: float | None = None
    hrv_ms: float | None = None
    hrv_kind: str | None = None


def best_source(samples: Iterable[Sample]) -> list[Sample]:
    """The samples of the best-ranked source among them: the lowest `source_order`, then the
    one with more records, then by name so the choice never flips between runs."""
    by_source: dict[SourceRef, list[Sample]] = defaultdict(list)
    for item in samples:
        by_source[item.source].append(item)
    if not by_source:
        return []

    def key(source: SourceRef) -> tuple[tuple[int, int], int, tuple[str, str, str]]:
        return (
            source_order(source),
            -len(by_source[source]),
            (source.provider, source.source or "", source.device or ""),
        )

    return by_source[min(by_source, key=key)]


def _of_type(samples: Sequence[Sample], type_: str) -> list[Sample]:
    return [s for s in samples if s.type == type_]


def _sum(samples: Sequence[Sample], type_: str) -> float | None:
    best = best_source(_of_type(samples, type_))
    return sum(s.value for s in best) if best else None


def _last(samples: Sequence[Sample], type_: str) -> float | None:
    best = best_source(_of_type(samples, type_))
    return max(best, key=lambda s: s.timestamp).value if best else None


def _hrv(
    samples: Sequence[Sample], window: tuple[datetime, datetime] | None
) -> tuple[float | None, str | None]:
    """Mean of the night's RMSSD (the main sleep; the whole day's without one, or when the
    sleep holds none), else the same for SDNN."""
    for type_, kind in ((HRV_RMSSD, RMSSD), (HRV_SDNN, SDNN)):
        found = _of_type(samples, type_)
        if window:
            night = [s for s in found if window[0] <= s.timestamp < window[1]]
            found = night or found
        best = best_source(found)
        if best:
            return fmean(s.value for s in best), kind
    return None, None


def measure(samples: Sequence[Sample], main_sleep: SleepSession | None) -> Measured:
    window = (main_sleep.start, main_sleep.end) if main_sleep else None
    hrv_ms, hrv_kind = _hrv(samples, window)
    return Measured(
        distance_m=_sum(samples, DISTANCE),
        active_kcal=_sum(samples, ACTIVE_ENERGY),
        total_kcal=_sum(samples, TOTAL_ENERGY),
        resting_hr=_last(samples, RESTING_HR),
        hrv_ms=hrv_ms,
        hrv_kind=hrv_kind,
    )


def pick(measured: float | None, estimate: float | None) -> tuple[float | None, str | None]:
    """The measured value if there is one, else the estimate; with where it came from."""
    if measured is not None:
        return measured, MEASURED
    if estimate is not None:
        return estimate, ESTIMATED
    return None, None
