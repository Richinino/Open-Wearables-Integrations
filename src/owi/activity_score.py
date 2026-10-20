"""Oura-style Activity score (0-100) for one day and the six days before it.

Thresholds are Oura's; the contributor curves and weights are our reconstruction
(docs/skore.md §2).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from itertools import pairwise

from owi.readiness import clamp_score, weighted_score
from owi.score_models import DayFeatures, Person, Score

WEIGHTS = {
    "meet_daily_targets": 0.25,
    "stay_active": 0.20,
    "training_volume": 0.15,
    "training_frequency": 0.15,
    "move_every_hour": 0.10,
    "recovery_time": 0.15,
}

WEEK_DAYS = 7
KCAL_PER_KG = 5.5
HIGH_READINESS, HIGH_READINESS_FACTOR = 85.0, 1.15
LOW_READINESS, LOW_READINESS_FACTOR = 70.0, 0.85
STAY_ACTIVE_POINTS = ((5.0, 100.0), (8.0, 85.0), (12.0, 59.0), (16.0, 0.0))
TARGET_DAYS_SCORES = {7: 100.0, 6: 95.0, 5: 80.0, 4: 65.0, 3: 50.0}
FREQUENCY_SCORES = {3: 90.0, 2: 70.0, 1: 50.0, 0: 30.0}
TRAINING_DAY_MET_MINUTES = 100.0
EASY_DAY_HIGH_MINUTES = 15
EASY_DAY_MEDIUM_HIGH_MINUTES = 85


# Contributor curves


def stay_active_score(inactive_hours: float) -> float:
    points = STAY_ACTIVE_POINTS
    if inactive_hours <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in pairwise(points):
        if inactive_hours <= x1:
            return y0 + (y1 - y0) * (inactive_hours - x0) / (x1 - x0)
    return points[-1][1]


def move_every_hour_score(long_inactive_bouts: int) -> float:
    return clamp_score(100 - 10 * long_inactive_bouts)


def daily_targets_score(days_met: int) -> float:
    return TARGET_DAYS_SCORES.get(days_met, 15.0 * days_met)


def training_frequency_score(training_days: int) -> float:
    return 100.0 if training_days >= 4 else FREQUENCY_SCORES[training_days]


def training_volume_score(met_minutes: float) -> float:
    if met_minutes >= 2000:
        return 100.0
    if met_minutes >= 750:
        return 85 + 15 * (met_minutes - 750) / 1250
    return 85 * met_minutes / 750


def recovery_time_score(days_since_easy_day: int | None) -> float:
    """None means no easy day in the last seven."""
    if days_since_easy_day is None:
        return 40.0
    return clamp_score(100 - 5 * max(0, days_since_easy_day - 5))


def daily_target_kcal(weight_kg: float | None, readiness: float | None) -> float | None:
    """Active kcal to aim for: 5.5 per kg, raised on high-readiness days, lowered on low ones."""
    if weight_kg is None:
        return None
    target = KCAL_PER_KG * weight_kg
    if readiness is not None and readiness >= HIGH_READINESS:
        return target * HIGH_READINESS_FACTOR
    if readiness is not None and readiness < LOW_READINESS:
        return target * LOW_READINESS_FACTOR
    return target


# Activity score


def activity_score(
    history: Sequence[DayFeatures], person: Person, readiness: float | None
) -> Score:
    """Activity for the last day of `history`; `readiness` is that day's Readiness."""
    if not history:
        return Score(None, note="no data")
    today = history[-1]
    if today.wear_minutes == 0:
        return Score(None, dict.fromkeys(WEIGHTS), "no heart rate recorded")
    start = today.day - timedelta(days=WEEK_DAYS - 1)
    week = [d for d in history if start <= d.day <= today.day]
    components = {
        "meet_daily_targets": _meet_daily_targets(week, today, person, readiness),
        "stay_active": (
            None if today.inactive_hours is None else stay_active_score(today.inactive_hours)
        ),
        "training_volume": _training_volume(week),
        "training_frequency": _training_frequency(week),
        "move_every_hour": (
            None
            if today.long_inactive_bouts is None
            else move_every_hour_score(today.long_inactive_bouts)
        ),
        "recovery_time": _recovery_time(week, today),
    }
    value = weighted_score(components, WEIGHTS)
    if value is None:
        return Score(None, components, "no data")
    missing = [k for k, v in components.items() if v is None]
    return Score(round(value, 1), components, f"without {', '.join(missing)}" if missing else None)


def _meet_daily_targets(
    week: Sequence[DayFeatures], today: DayFeatures, person: Person, readiness: float | None
) -> float | None:
    """Days of the last seven that reached their target; missing days count as not reached.

    Only today's Readiness is known, so only today's target is adjusted by it.
    """
    weight = person.weight_kg if person.weight_kg is not None else today.weight_kg
    target = daily_target_kcal(weight, None)
    today_target = daily_target_kcal(weight, readiness)
    if target is None or today_target is None or all(d.active_kcal is None for d in week):
        return None
    met = sum(
        1
        for d in week
        if d.active_kcal is not None
        and d.active_kcal >= (today_target if d.day == today.day else target)
    )
    return daily_targets_score(met)


def _medium_high_met_minutes(day: DayFeatures) -> float | None:
    if day.met_minutes_medium is None and day.met_minutes_high is None:
        return None
    return (day.met_minutes_medium or 0.0) + (day.met_minutes_high or 0.0)


def _training_volume(week: Sequence[DayFeatures]) -> float | None:
    values = [v for d in week if (v := _medium_high_met_minutes(d)) is not None]
    return training_volume_score(sum(values)) if values else None


def _training_frequency(week: Sequence[DayFeatures]) -> float | None:
    values = [v for d in week if (v := _medium_high_met_minutes(d)) is not None]
    if not values:
        return None
    return training_frequency_score(sum(1 for v in values if v >= TRAINING_DAY_MET_MINUTES))


def _is_easy(day: DayFeatures) -> bool | None:
    """At most 15 minutes at 6+ MET and 85 at 3+ MET; None without intensity minutes."""
    if day.medium_minutes is None or day.high_minutes is None:
        return None
    return (
        day.high_minutes <= EASY_DAY_HIGH_MINUTES
        and day.medium_minutes + day.high_minutes <= EASY_DAY_MEDIUM_HIGH_MINUTES
    )


def _recovery_time(week: Sequence[DayFeatures], today: DayFeatures) -> float | None:
    easy = {d.day: e for d in week if (e := _is_easy(d)) is not None}
    if not easy:
        return None
    easy_days = [day for day, is_easy in easy.items() if is_easy]
    return recovery_time_score((today.day - max(easy_days)).days if easy_days else None)
