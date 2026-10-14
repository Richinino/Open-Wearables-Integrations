"""Training load from heart rate: Banister TRIMP, WHOOP-style strain, Polar-style status.

Formulas and the origin of every constant: docs/skore.md, sections 1 and 2.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Container, Mapping, Sequence
from datetime import datetime, timedelta
from statistics import fmean

from owi.models import Workout
from owi.score_models import FEMALE, MALE, CardioLoad

# Banister TRIMP, per minute r * k * exp(c * r).
TRIMP_K = {MALE: 0.64, FEMALE: 0.86}
TRIMP_C = {MALE: 1.92, FEMALE: 1.67}
# Fitbit's Cardio Load floor; keeps ordinary sitting and walking about from adding up.
TRIMP_MIN_RESERVE = 0.30

STRAIN_MIN_RESERVE = 0.25
STRAIN_A = {MALE: 4.05, FEMALE: 4.45}
STRAIN_L0 = {MALE: 10.3, FEMALE: 11.4}
MAX_STRAIN = 21.0

# Open Wearables workout types (WorkoutType). Providers already fold weightlifting,
# CrossFit and calisthenics into strength_training, and HIIT, boot camp and functional
# training into cardio_training.
STRENGTH_TYPES = frozenset({"strength_training", "cardio_training"})
YOGA_TYPES = frozenset({"yoga", "pilates", "stretching"})
STRENGTH_LOAD_PER_MINUTE = 0.6
YOGA_LOAD_PER_MINUTE = 0.3

CARDIO_ACUTE_DAYS = 7
CARDIO_CHRONIC_DAYS = 28
CARDIO_MIN_LOADED_DAYS = 3

_ONE_MINUTE = timedelta(minutes=1)


def _sex(sex: str | None) -> str:
    """Male constants unless the person is known to be female."""
    return FEMALE if sex == FEMALE else MALE


def hr_reserve(hr: float, rest_hr: float, max_hr: float) -> float:
    """Share of heart-rate reserve in use (Karvonen), between 0 and 1."""
    if max_hr <= rest_hr:
        return 0.0
    return min(max((hr - rest_hr) / (max_hr - rest_hr), 0.0), 1.0)


def trimp(
    minute_hr: Mapping[datetime, float],
    rest_hr: float,
    max_hr: float,
    sex: str | None,
    minutes: Container[datetime] | None = None,
) -> float:
    """Banister TRIMP over the minutes at 30 % of reserve or more, optionally only `minutes`."""
    k = TRIMP_K[_sex(sex)]
    c = TRIMP_C[_sex(sex)]
    total = 0.0
    for minute, value in minute_hr.items():
        if minutes is not None and minute not in minutes:
            continue
        reserve = hr_reserve(value, rest_hr, max_hr)
        if reserve >= TRIMP_MIN_RESERVE:
            total += reserve * k * math.exp(c * reserve)
    return total


def _muscular_minutes(workout: Workout, window: tuple[datetime, datetime] | None) -> float:
    start, end = workout.start, workout.end
    if window is not None:
        start, end = max(start, window[0]), min(end, window[1])
    return max((end - start).total_seconds() / 60, 0.0)


def strain_load(
    minute_hr: Mapping[datetime, float],
    rest_hr: float,
    max_hr: float,
    sex: str | None,
    asleep: Callable[[datetime], bool],
    workouts: Sequence[Workout],
    window: tuple[datetime, datetime] | None = None,
) -> float:
    """WHOOP-style load: weighted awake minutes plus muscular load of strength and yoga.

    A minute belongs to the window when any part of it overlaps the window; workouts
    count only for the part that lies inside it.
    """
    b = TRIMP_C[_sex(sex)]
    total = 0.0
    for minute, value in minute_hr.items():
        if window is not None and not window[0] - _ONE_MINUTE < minute < window[1]:
            continue
        if asleep(minute):
            continue
        reserve = hr_reserve(value, rest_hr, max_hr)
        if reserve >= STRAIN_MIN_RESERVE:
            total += reserve * math.exp(b * reserve)
    for workout in workouts:
        if workout.type in STRENGTH_TYPES:
            total += STRENGTH_LOAD_PER_MINUTE * _muscular_minutes(workout, window)
        elif workout.type in YOGA_TYPES:
            total += YOGA_LOAD_PER_MINUTE * _muscular_minutes(workout, window)
    return total


def strain_from_load(load: float, sex: str | None) -> float:
    """Map a load onto WHOOP's 0-21 strain scale."""
    if load <= 0:
        return 0.0
    key = _sex(sex)
    return min(MAX_STRAIN, STRAIN_A[key] * math.log(1 + load / STRAIN_L0[key]))


def _status(ratio: float, overreached_recently: bool) -> str:
    if ratio < 0.8:
        return "recovering" if overreached_recently else "detraining"
    if ratio < 1.0:
        return "maintaining"
    if ratio <= 1.3:
        return "productive"
    return "overreaching"


def cardio_load(daily_trimp: Sequence[float | None], overreached_recently: bool) -> CardioLoad:
    """Polar Cardio Load status from daily TRIMP, oldest first, the last value being today.

    Days without data count as no load. Polar needs three sessions in 28 days.
    """
    loads = [0.0 if value is None else value for value in daily_trimp]
    chronic = loads[-CARDIO_CHRONIC_DAYS:]
    if (
        len(loads) < CARDIO_CHRONIC_DAYS
        or sum(1 for value in chronic if value > 0) < CARDIO_MIN_LOADED_DAYS
    ):
        return CardioLoad(strain_7d=None, tolerance_28d=None, ratio=None, status=None)

    strain = fmean(loads[-CARDIO_ACUTE_DAYS:])
    tolerance = fmean(chronic)
    ratio = strain / tolerance if tolerance else None
    return CardioLoad(
        strain_7d=strain,
        tolerance_28d=tolerance,
        ratio=ratio,
        status=None if ratio is None else _status(ratio, overreached_recently),
    )
