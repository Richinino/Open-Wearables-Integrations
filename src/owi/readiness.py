"""Oura-style Readiness without HRV and temperature, and the NightSignal warning.

Contributor curves come from Oura patent US10842429B2 as listed in docs/skore.md §4.
Every comparison is against the person's own nights and days before the scored day D.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from datetime import date, timedelta
from statistics import fmean, median, pstdev

from owi.score_models import DayFeatures, NightSignal, Person, Score

AWAKE = "awake"
ESTIMATE = "estimate"
TOO_LITTLE_HISTORY = "too little history"
NO_SLEEP = "no sleep recorded"

WEIGHTS = {
    "sleep": 0.25,
    "resting_hr": 0.20,
    "activity_balance": 0.15,
    "sleep_balance": 0.11,
    "previous_day_activity": 0.11,
    "recovery_index": 0.10,
    "sleep_regularity": 0.05,
}

BASELINE_DAYS = 60
RECENT_DAYS = 14
RECENT_DECAY = 0.9  # weight of a night or day i days back is 0.9^i
MIN_BASELINE_DAYS = 7  # comparisons with an average start after 7 days (docs/skore.md §6)
MIN_RHR_NIGHTS = 14  # the overall score is shown after 14 nights
MIN_WEAR_MINUTES = 1000  # less worn days skew activity baselines (Radin 2020, docs/skore.md §6)

RHR_SD_FLOOR = 2.0
# SD floors for activity z-scores, so a nearly constant baseline does not blow them up (A).
ACTIVITY_SD_FLOORS = {"active_kcal": 50.0, "met_minutes_high": 10.0, "inactive_hours": 0.5}

ADULT_NEED = (420.0, 540.0)  # 7-9 h
TEEN_NEED = (480.0, 600.0)  # 8-10 h for 13-18 year olds (NSF, AASM)
SLEEP_BALANCE_SD = (25.0, 45.0)

NIGHT_MIN_EARLIER = 7
NIGHT_YELLOW_DELTA = 3.0
NIGHT_RED_DELTA = 4.0


def clamp_score(value: float) -> float:
    return min(100.0, max(0.0, value))


def weighted_score(
    components: Mapping[str, float | None], weights: Mapping[str, float]
) -> float | None:
    """Weighted mean of the components that exist, with their weights renormalised."""
    available = {k: v for k, v in components.items() if v is not None}
    if not available:
        return None
    total = sum(weights[k] for k in available)
    return sum(weights[k] * v for k, v in available.items()) / total


# Contributor curves


def sleep_score(total_minutes: float) -> float:
    z = (100 * total_minutes / 540 - 85) / 7.5
    return clamp_score(85 + 12.5 * z)


def resting_hr_score(z: float) -> float:
    return clamp_score(87.5 - 30 * z if z > -1 else 116 + 16 * z)


def activity_balance_score(z: float) -> float:
    return clamp_score(100 - 60 * abs(0.25 + z))


def sleep_balance_score(balance_minutes: float, sd_minutes: float) -> float:
    return clamp_score(85 + 30 * balance_minutes / sd_minutes)


def previous_day_activity_score(z_sum: float) -> float:
    return clamp_score(85 - 6 * z_sum)


def recovery_index_score(hours: float) -> float:
    return clamp_score(85 + 15 * (hours - 5))


def sleep_regularity_score(sri: float) -> float:
    return 100.0 if sri >= 85 else clamp_score(100 - 2 * (85 - sri))


# Readiness


def readiness(
    history: Sequence[DayFeatures], person: Person, sleep_regularity: float | None
) -> Score:
    """Readiness for the last day of `history`, from last night and the days before it."""
    if not history:
        return Score(None, note=TOO_LITTLE_HISTORY)
    today = history[-1]
    total_sleep = _total_sleep(today)
    components = {
        "sleep": None if total_sleep is None else sleep_score(total_sleep),
        "resting_hr": _resting_hr(history, today),
        "activity_balance": _activity_balance(history, today.day),
        "sleep_balance": _sleep_balance(history, today.day, person),
        "previous_day_activity": _previous_day_activity(history, today.day),
        "recovery_index": _recovery_index(today),
        "sleep_regularity": (
            None if sleep_regularity is None else sleep_regularity_score(sleep_regularity)
        ),
    }
    nights = _before(history, today.day, BASELINE_DAYS)
    if sum(1 for d in nights if d.sleep_rhr is not None) < MIN_RHR_NIGHTS:
        return Score(None, components, TOO_LITTLE_HISTORY)
    # Oura scores readiness once the night is in; without it only day contributors remain.
    if today.sleep_minutes is None:
        return Score(None, components, NO_SLEEP)
    value = weighted_score(components, WEIGHTS)
    if value is None:
        return Score(None, components, "no data")
    return Score(round(value, 1), components, ESTIMATE)


def _before(history: Sequence[DayFeatures], day: date, days: int) -> list[DayFeatures]:
    """Entries of the `days` calendar days before `day`, oldest first."""
    start = day - timedelta(days=days)
    return [d for d in history if start <= d.day < day]


def _total_sleep(day: DayFeatures) -> float | None:
    return None if day.sleep_minutes is None else day.sleep_minutes + day.nap_minutes


def _worn(day: DayFeatures) -> bool:
    return day.wear_minutes >= MIN_WEAR_MINUTES


def _recent_mean(
    days: Sequence[DayFeatures], latest: date, value: Callable[[DayFeatures], float | None]
) -> float | None:
    """Mean weighted by 0.9 per day back from `latest`; days without a value are skipped."""
    pairs = [
        (RECENT_DECAY ** (latest - d.day).days, v) for d in days if (v := value(d)) is not None
    ]
    if not pairs:
        return None
    return sum(w * v for w, v in pairs) / sum(w for w, _ in pairs)


def _resting_hr(history: Sequence[DayFeatures], today: DayFeatures) -> float | None:
    baseline = [d.sleep_rhr for d in _before(history, today.day, BASELINE_DAYS)]
    values = [v for v in baseline if v is not None]
    if today.sleep_rhr is None or len(values) < MIN_BASELINE_DAYS:
        return None
    z = (today.sleep_rhr - fmean(values)) / max(pstdev(values), RHR_SD_FLOOR)
    return resting_hr_score(z)


def _activity_balance(history: Sequence[DayFeatures], day: date) -> float | None:
    """Last 14 days of active kcal, weighted towards yesterday, against the last 60."""
    long_term = [d for d in _before(history, day, BASELINE_DAYS) if _worn(d)]
    values = [d.active_kcal for d in long_term if d.active_kcal is not None]
    if len(values) < MIN_BASELINE_DAYS:
        return None
    recent_days = [d for d in _before(history, day, RECENT_DAYS) if _worn(d)]
    recent = _recent_mean(recent_days, day - timedelta(days=1), lambda d: d.active_kcal)
    if recent is None:
        return None
    sd = max(pstdev(values), ACTIVITY_SD_FLOORS["active_kcal"])
    return activity_balance_score((recent - fmean(values)) / sd)


def _sleep_balance(history: Sequence[DayFeatures], day: date, person: Person) -> float | None:
    """Weighted sleep surplus or deficit of the last 14 nights against the person's need."""
    nights = _before(history, day, BASELINE_DAYS)
    baseline = [t for d in nights if (t := _total_sleep(d)) is not None]
    if len(baseline) < MIN_BASELINE_DAYS:
        return None
    low, high = TEEN_NEED if person.age is not None and person.age < 18 else ADULT_NEED
    need = min(high, max(low, fmean(baseline)))
    sd = min(SLEEP_BALANCE_SD[1], max(SLEEP_BALANCE_SD[0], pstdev(baseline)))
    recent = _before(history, day + timedelta(days=1), RECENT_DAYS)  # D and the 13 before
    balance = _recent_mean(recent, day, _total_sleep)
    return None if balance is None else sleep_balance_score(balance - need, sd)


def _previous_day_activity(history: Sequence[DayFeatures], day: date) -> float | None:
    """Yesterday's kcal, high-intensity MET-minutes and inactive hours as z-scores."""
    yesterday = day - timedelta(days=1)
    previous = next((d for d in history if d.day == yesterday), None)
    if previous is None or not _worn(previous):
        return None
    baseline = [d for d in _before(history, yesterday, BASELINE_DAYS) if _worn(d)]
    z_sum = 0.0
    for name, floor in ACTIVITY_SD_FLOORS.items():
        value = getattr(previous, name)
        values = [v for d in baseline if (v := getattr(d, name)) is not None]
        if value is None or len(values) < MIN_BASELINE_DAYS:
            return None
        z_sum += (value - fmean(values)) / max(pstdev(values), floor)
    return previous_day_activity_score(z_sum)


def _recovery_index(today: DayFeatures) -> float | None:
    """Hours asleep between the night's heart-rate low and waking up."""
    start, end = today.sleep_hr_low_at, today.sleep_end
    if start is None or end is None:
        return None
    if end <= start:
        return recovery_index_score(0.0)
    awake = sum(
        max(0.0, (min(end, item.end) - max(start, item.start)).total_seconds())
        for item in today.sleep_intervals
        if item.stage == AWAKE
    )
    return recovery_index_score(((end - start).total_seconds() - awake) / 3600)


# NightSignal


def night_signal(history: Sequence[DayFeatures]) -> NightSignal:
    """Alavi et al. 2022: last night's heart rate against the median of all earlier nights.

    Red needs two nights in a row at least 4 bpm over. The night before D is judged as it
    would have been that morning: against the median of the nights before it, and only
    when it had 7 earlier nights of its own.
    """
    empty = NightSignal(level=None, night_hr=None, baseline=None, delta=None)
    if not history:
        return empty
    today = history[-1]
    baseline = _night_baseline(history, today.day)
    if today.night_hr is None or baseline is None:
        return empty
    delta = today.night_hr - baseline
    if delta < NIGHT_YELLOW_DELTA:
        level = "green"
    elif delta >= NIGHT_RED_DELTA and _previous_night_elevated(history, today.day):
        level = "red"
    else:
        level = "yellow"
    return NightSignal(level=level, night_hr=today.night_hr, baseline=baseline, delta=delta)


def _night_baseline(history: Sequence[DayFeatures], day: date) -> float | None:
    earlier = [d.night_hr for d in history if d.day < day and d.night_hr is not None]
    return median(earlier) if len(earlier) >= NIGHT_MIN_EARLIER else None


def _previous_night_elevated(history: Sequence[DayFeatures], day: date) -> bool:
    yesterday = day - timedelta(days=1)
    previous = next((d for d in history if d.day == yesterday), None)
    if previous is None or previous.night_hr is None:
        return False
    baseline = _night_baseline(history, yesterday)
    return baseline is not None and previous.night_hr - baseline >= NIGHT_RED_DELTA
