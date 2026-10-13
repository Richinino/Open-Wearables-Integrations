"""Pick the day's step count from the most complete source."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from owi.days import local_date
from owi.models import STEPS, Sample

SAMSUNG_HEALTH_TOTAL = "samsung_health_total"
SAMSUNG_HOURLY = "samsung_hourly"
PHONE = "phone"
# Preference order when candidates tie.
_ORDER = (SAMSUNG_HEALTH_TOTAL, SAMSUNG_HOURLY, PHONE)


@dataclass(frozen=True)
class StepsChoice:
    value: int
    source: str


def select_steps(
    samples: Iterable[Sample], day: date, tz: ZoneInfo, start: datetime, end: datetime
) -> StepsChoice | None:
    """Highest of: Samsung Health's daily total, Samsung hourly sum, phone counter sum.

    Samsung Health writes one running total per day to Health Connect, stamped at the
    local midnight that starts the day, so it is matched by local date and never summed.
    Taking the highest candidate guards against a total that was synced part-way through.
    """
    candidates: dict[str, float] = {}
    for item in samples:
        if item.type != STEPS:
            continue
        if item.source.is_samsung_health_app:
            if local_date(item.timestamp, tz) == day:
                previous = candidates.get(SAMSUNG_HEALTH_TOTAL, 0.0)
                candidates[SAMSUNG_HEALTH_TOTAL] = max(previous, item.value)
            continue
        if not start <= item.timestamp < end:
            continue
        if item.source.is_samsung_direct:
            key = SAMSUNG_HOURLY
        elif item.source.is_health_connect:
            key = PHONE
        else:
            continue
        candidates[key] = candidates.get(key, 0.0) + item.value

    if not candidates:
        return None
    best = max(candidates, key=lambda key: (candidates[key], -_ORDER.index(key)))
    return StepsChoice(round(candidates[best]), best)
