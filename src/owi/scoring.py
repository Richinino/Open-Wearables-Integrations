"""Stage two of the scores: stored DayFeatures in, DayScores out.

score_day() scores one day from the features before it and the scores of earlier days;
rescore() runs it over stored days in date order, because some scores chain from one day to
the next (sleep need, the overreaching memory of the load status). Formulas: docs/skore.md.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Sequence
from dataclasses import replace
from datetime import date, timedelta
from statistics import fmean

from owi import activity_score, load, longterm, readiness, sleep_scores
from owi.models import DEFAULT_MAX_HR
from owi.score_models import DayFeatures, DayScores, NightSignal, Person, Score
from owi.store import Store

# The longest look back of any score: WHOOP Age's 180 days. NightSignal's "all earlier
# nights" and the sleep need baseline therefore cover at most this much.
HISTORY_DAYS = 180
OVERREACHED_DAYS = 14  # Polar: "recovering" after overreaching in the last 14 days
# Sleep scores look at most 14 days back (SRI), and each day's noon-to-noon window reaches
# into the day before, so 15 days hold everything they read.
SLEEP_WINDOW_DAYS = 15
NIGHT_RED_CAP = 50.0
TOO_LITTLE_WEAR = "too little wear"
RED = "red"
OVERREACHING = "overreaching"
CHUNK_DAYS = 14


def score_day(
    history: Sequence[DayFeatures],
    previous: Sequence[DayScores],
    person: Person,
    timezone: str,
) -> DayScores:
    """Scores of the last day of `history` (oldest first).

    `previous` are the stored scores of earlier days, oldest first; the day before gives the
    sleep need the night is measured against.
    """
    today = history[-1]
    by_day = {scores.day: scores for scores in previous}
    yesterday = by_day.get(today.day - timedelta(days=1))
    previous_need = yesterday.sleep_need_minutes if yesterday else None
    overreached = any(
        scores.cardio_load.status == OVERREACHING
        for scores in previous
        if today.day - timedelta(days=OVERREACHED_DAYS) <= scores.day < today.day
    )
    recent = [f for f in history if f.day > today.day - timedelta(days=SLEEP_WINDOW_DAYS)]
    # A finished day worn too little to count (docs/skore.md §6) has no strain or activity:
    # its near-empty heart rate would read as a lazy day. Today still fills up.
    measured = not today.complete or today.wear_minutes >= readiness.MIN_WEAR_MINUTES

    regularity = sleep_scores.sleep_regularity_index(recent, timezone)
    performance = sleep_scores.sleep_performance(recent, previous_need, timezone)
    ready = readiness.readiness(history, person, regularity)
    activity = (
        activity_score.activity_score(history, person, ready.value)
        if measured
        else Score(None, note=TOO_LITTLE_WEAR)
    )
    night = readiness.night_signal(history)
    return DayScores(
        day=today.day,
        strain=today.strain if measured else None,
        cardio_load=load.cardio_load(_daily_trimp(history), overreached),
        sleep_need_minutes=sleep_scores.sleep_need_minutes(history, person, previous_need),
        sleep_performance=performance,
        apple_sleep=sleep_scores.apple_sleep_score(recent, timezone),
        sleep_regularity=regularity,
        readiness=ready,
        activity=activity,
        night_signal=night,
        day_score=_day_score((ready, performance, activity), night),
        vo2max=today.vo2max,
        vo2max_uth=longterm.vo2max_uth(person.max_hr, today.resting_hr),
        whoop_age=longterm.whoop_age(history, person),
    )


def _daily_trimp(history: Sequence[DayFeatures]) -> list[float | None]:
    """TRIMP per calendar day up to the last, 28 days at most.

    Days not stored, or worn too little to count (docs/skore.md §6), are None.
    """
    by_day = {f.day: f.trimp for f in history if f.wear_minutes >= readiness.MIN_WEAR_MINUTES}
    last = history[-1].day
    first = max(history[0].day, last - timedelta(days=load.CARDIO_CHRONIC_DAYS - 1))
    return [by_day.get(first + timedelta(days=i)) for i in range((last - first).days + 1)]


def _day_score(parts: Sequence[Score], night: NightSignal) -> float | None:
    values = [part.value for part in parts if part.value is not None]
    if not values:
        return None
    value = fmean(values)
    if night.level == RED:
        value = min(value, NIGHT_RED_CAP)
    return round(value, 1)


def person_for(base: Person, history: Sequence[DayFeatures], max_hr: float) -> Person:
    """`base` (age, sex) with the latest weight and body fat in `history` and `max_hr`."""

    def latest(values: list[float | None], fallback: float | None) -> float | None:
        return next((v for v in reversed(values) if v is not None), fallback)

    return replace(
        base,
        weight_kg=latest([f.weight_kg for f in history], base.weight_kg),
        body_fat_pct=latest([f.body_fat_pct for f in history], base.body_fat_pct),
        max_hr=max_hr,
    )


def rescore(store: Store, first: date, last: date, base: Person, timezone: str) -> int:
    """Score every day with stored features from `first` to `last`, in date order.

    `base.max_hr` is the configured or calibrated maximum heart rate; without it each day
    uses the highest stored one. Features are read in chunks and only the last 180 days
    are kept, so memory stays bounded. Returns how many days were scored.
    """
    window = deque(
        store.features(first - timedelta(days=HISTORY_DAYS - 1), first - timedelta(days=1))
    )
    previous = deque(
        store.scores(first - timedelta(days=OVERREACHED_DAYS), first - timedelta(days=1))
    )
    count = 0
    chunk = first
    while chunk <= last:
        chunk_end = min(last, chunk + timedelta(days=CHUNK_DAYS - 1))
        for features in store.features(chunk, chunk_end):
            window.append(features)
            while window[0].day <= features.day - timedelta(days=HISTORY_DAYS):
                window.popleft()
            while previous and previous[0].day < features.day - timedelta(days=OVERREACHED_DAYS):
                previous.popleft()
            max_hr = base.max_hr or store.max_hr_recent(features.day) or DEFAULT_MAX_HR
            person = person_for(base, window, max_hr)
            scores = score_day(list(window), list(previous), person, timezone)
            store.save_scores(scores)
            previous.append(scores)
            count += 1
        chunk = chunk_end + timedelta(days=1)
    return count
