"""Turn one day's inputs and result into the DayFeatures the scores are built from.

Minutes are keyed by their start, as in heart.minute_series. A minute lies inside a
stretch of time (a workout, a sleep stage) when any part of it overlaps that stretch.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timedelta
from statistics import fmean, median, quantiles
from typing import Any

from owi import heart, load, sleep
from owi.estimates import REST_VO2
from owi.models import (
    ACTIVE_ENERGY,
    STEPS,
    DayInputs,
    DayResult,
    Sample,
    SleepInterval,
    SleepSession,
    SourceRef,
    Workout,
)
from owi.score_models import DayFeatures, Person

SLEEP_RHR_MINUTES = 5
NIGHT_HOURS = 7
MIN_NIGHT_MINUTES = 60
MIN_AWAKE_REST_MINUTES = 300
MEDIUM_MET = 3.0
HIGH_MET = 6.0
INACTIVE_MET = 1.5
LONG_INACTIVE_MINUTES = 50
# (A) Fitbit's hourly goal: an awake, worn hour under 250 steps is an inactive hour, and stands
# for one of Oura's 50-minute sitting bouts. Heart rate alone cannot tell light from moderate
# effort, so with hourly steps a minute counts as effort only in a workout or a 500-step hour.
INACTIVE_HOUR_STEPS = 250
EFFORT_HOUR_STEPS = 500
MIN_WORN_HOUR_MINUTES = 30
ZONE_LOW_RESERVE = 0.5
ZONE_HIGH_RESERVE = 0.8
MIN_AWAKE_BOUT = timedelta(minutes=1)
# Samsung's hourly records must reach 21:00 for its day sums to count as the whole day.
SAMSUNG_EVENING_BEFORE_END = timedelta(hours=3)

AWAKE = "awake"
ASLEEP = "asleep"

_ONE_MINUTE = timedelta(minutes=1)
_ONE_HOUR = timedelta(hours=1)
_LOAD_FIELDS = ("trimp", "strain_load", "strain")
_MET_FIELDS = (
    "met_minutes_medium",
    "met_minutes_high",
    "medium_minutes",
    "high_minutes",
    "inactive_hours",
    "long_inactive_bouts",
)
_ZONE_FIELDS = ("zone_low_minutes", "zone_high_minutes")
_SLEEP_FIELDS = (
    "sleep_start",
    "sleep_end",
    "sleep_minutes",
    "in_bed_minutes",
    "deep_minutes",
    "rem_minutes",
    "light_minutes",
    "awake_minutes",
    "awake_bouts",
)


def _length(start: datetime, end: datetime) -> float:
    return (end - start).total_seconds() / 60


def _covered(spans: Iterable[tuple[datetime, datetime]]) -> set[datetime]:
    """Start of every minute that overlaps any of the spans."""
    minutes: set[datetime] = set()
    for start, end in spans:
        current = start.replace(second=0, microsecond=0)
        while current < end:
            minutes.add(current)
            current += _ONE_MINUTE
    return minutes


def _workouts(inputs: DayInputs, result: DayResult) -> tuple[Workout, ...]:
    """The day's workouts; the stored results stand in when the raw list is empty."""
    if inputs.workouts:
        return inputs.workouts
    return tuple(
        Workout(id=w.id, type=w.type, start=w.start, end=w.end, source=SourceRef(w.source))
        for w in result.workouts
    )


def _choose_sleeps(inputs: DayInputs) -> tuple[SleepSession | None, list[SleepSession]]:
    """Main sleep: the longest non-nap ending on the day. Naps: those starting on it."""
    sessions = sleep.dedupe(inputs.sleeps)
    nights = [s for s in sessions if not s.is_nap and inputs.start <= s.end < inputs.end]
    naps = [s for s in sessions if s.is_nap and inputs.start <= s.start < inputs.end]
    return max(nights, key=sleep.minutes_asleep, default=None), naps


def _timeline(session: SleepSession) -> tuple[SleepInterval, ...]:
    """The stage timeline, or the whole session as one asleep stretch."""
    return session.intervals or (SleepInterval(session.start, session.end, ASLEEP),)


def _lowest_mean(minute_hr: Mapping[datetime, float], width: int) -> tuple[float, datetime] | None:
    """Lowest rolling mean over `width` consecutive minutes, and the minute it began."""
    minutes = sorted(minute_hr)
    best: tuple[float, datetime] | None = None
    run_start = 0
    for index, minute in enumerate(minutes):
        if index > 0 and minute - minutes[index - 1] != _ONE_MINUTE:
            run_start = index
        if index - run_start + 1 >= width:
            window = minutes[index - width + 1 : index + 1]
            mean = fmean(minute_hr[m] for m in window)
            if best is None or mean < best[0]:
                best = (mean, window[0])
    return best


def _night_hr(
    minute_hr: Mapping[datetime, float], start: datetime, main: SleepSession | None
) -> float | None:
    """Mean heart rate over the minutes asleep in the main sleep from 00:00 to 07:00.

    Alavi 2022 uses minutes without steps; without per-minute steps, time asleep is the
    closest stand-in, and it leaves out the awake minutes of a late bedtime.
    """
    if main is None:
        return None
    asleep = _covered((i.start, i.end) for i in _timeline(main) if i.stage != AWAKE)
    end = start + timedelta(hours=NIGHT_HOURS)
    values = [v for m, v in minute_hr.items() if start <= m < end and m in asleep]
    return fmean(values) if len(values) >= MIN_NIGHT_MINUTES else None


def _awake_hr_p10(awake_hr: Mapping[datetime, float], in_workout: set[datetime]) -> float | None:
    """10th percentile of the awake heart rate outside workouts: the day's awake rest."""
    values = [v for m, v in awake_hr.items() if m not in in_workout]
    if len(values) < MIN_AWAKE_REST_MINUTES:
        return None
    return quantiles(values, n=10, method="inclusive")[0]


def _max_held(minute_hr: Mapping[datetime, float]) -> float | None:
    """Highest heart rate held for two consecutive minutes (the lower of the pair)."""
    held = [
        min(minute_hr[minute - _ONE_MINUTE], value)
        for minute, value in minute_hr.items()
        if minute - _ONE_MINUTE in minute_hr
    ]
    return max(held, default=None)


def _load(
    minute_hr: Mapping[datetime, float],
    awake_hr: Mapping[datetime, float],
    rest_hr: float,
    max_hr: float,
    sex: str | None,
    asleep: set[datetime],
    workouts: Sequence[Workout],
    day: tuple[datetime, datetime],
) -> dict[str, Any]:
    def load_in(window: tuple[datetime, datetime]) -> float:
        return load.strain_load(
            minute_hr, rest_hr, max_hr, sex, lambda m: m in asleep, workouts, window
        )

    day_load = load_in(day)
    return {
        "trimp": load.trimp(awake_hr, rest_hr, max_hr, sex),
        "strain_load": day_load,
        "strain": load.strain_from_load(day_load, sex),
        "workout_strain": {
            w.id: load.strain_from_load(load_in((w.start, w.end)), sex) for w in workouts
        },
    }


def _zones(awake_hr: Mapping[datetime, float], rest_hr: float, max_hr: float) -> dict[str, Any]:
    low = high = 0
    for value in awake_hr.values():
        reserve = load.hr_reserve(value, rest_hr, max_hr)
        if reserve >= ZONE_HIGH_RESERVE:
            high += 1
        elif reserve >= ZONE_LOW_RESERVE:
            low += 1
    return {"zone_low_minutes": low, "zone_high_minutes": high}


def _hour(moment: datetime, start: datetime) -> datetime:
    """Start of the hour of the day that `moment` falls in, counted from the day's start."""
    return start + (moment - start) // _ONE_HOUR * _ONE_HOUR


def _hourly_steps(
    samples: Iterable[Sample], start: datetime, end: datetime
) -> dict[datetime, float] | None:
    """Steps in each hour of the day; None when the day has no hourly step source.

    Samsung's hourly counts win where they cover an hour, else the phone counter's records,
    each counted in the hour it starts (OW gives no end; the records are short). Samsung
    Health's daily total says nothing about hours and is left out.
    """
    samsung: dict[datetime, float] = {}
    phone: dict[datetime, float] = {}
    for item in samples:
        if item.type != STEPS or not start <= item.timestamp < end:
            continue
        if item.source.is_samsung_direct:
            counts = samsung
        elif item.source.is_health_connect and not item.source.is_samsung_health_app:
            counts = phone
        else:
            continue
        hour = _hour(item.timestamp, start)
        counts[hour] = counts.get(hour, 0.0) + item.value
    if not samsung and not phone:
        return None
    hours = [start + i * _ONE_HOUR for i in range(int((end - start) / _ONE_HOUR))]
    return {hour: samsung.get(hour, phone.get(hour, 0.0)) for hour in hours}


def _inactive_hours(
    steps: Mapping[datetime, float],
    awake_hr: Mapping[datetime, float],
    in_workout: set[datetime],
    start: datetime,
) -> dict[str, Any]:
    """Awake, worn hours under 250 steps without workout minutes."""
    worn = Counter(_hour(minute, start) for minute in awake_hr)
    in_workouts = {_hour(minute, start) for minute in in_workout}
    hours = sum(
        1
        for hour, count in steps.items()
        if count < INACTIVE_HOUR_STEPS
        and worn[hour] >= MIN_WORN_HOUR_MINUTES
        and hour not in in_workouts
    )
    return {"inactive_hours": float(hours), "long_inactive_bouts": hours}


def _mets(
    awake_hr: Mapping[datetime, float],
    rest_hr: float,
    max_hr: float,
    vo2max: float,
    in_workout: set[datetime],
    effort: set[datetime] | None = None,
) -> dict[str, Any]:
    """MET = 1 + r * (VO2max / 3.5 - 1): heart-rate reserve tracks VO2 reserve (Swain).

    With `effort`, only those minutes can count as medium or high.
    """
    scale = vo2max / REST_VO2 - 1
    medium = high = inactive = bouts = run = 0
    medium_met = high_met = 0.0
    last_inactive: datetime | None = None
    for minute in sorted(awake_hr):
        met = 1 + load.hr_reserve(awake_hr[minute], rest_hr, max_hr) * scale
        counts = effort is None or minute in effort
        if met >= HIGH_MET and counts:
            high += 1
            high_met += met
        elif met >= MEDIUM_MET and counts:
            medium += 1
            medium_met += met
        elif met < INACTIVE_MET and minute not in in_workout:
            inactive += 1
            run = run + 1 if last_inactive == minute - _ONE_MINUTE else 1
            last_inactive = minute
            if run == LONG_INACTIVE_MINUTES:
                bouts += 1
    return {
        "met_minutes_medium": medium_met,
        "met_minutes_high": high_met,
        "medium_minutes": medium,
        "high_minutes": high,
        "inactive_hours": inactive / 60,
        "long_inactive_bouts": bouts,
    }


def _wake_after_onset(intervals: Sequence[SleepInterval]) -> tuple[float | None, int | None]:
    """Minutes awake, and awake bouts of a minute or more, between first and last sleep."""
    asleep = [i for i in intervals if i.stage != AWAKE]
    if not asleep:
        return None, None
    onset = min(i.start for i in asleep)
    final = max(i.end for i in asleep)
    clipped = sorted(
        (max(i.start, onset), min(i.end, final)) for i in intervals if i.stage == AWAKE
    )
    # Touching or overlapping awake stretches are one bout.
    merged: list[tuple[datetime, datetime]] = []
    for start, end in clipped:
        if start >= end:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    minutes = sum(_length(start, end) for start, end in merged)
    bouts = sum(1 for start, end in merged if end - start >= MIN_AWAKE_BOUT)
    return minutes, bouts


def _samsung_sums(samples: Iterable[Sample], start: datetime, end: datetime) -> dict[str, Any]:
    """Samsung's own steps and active calories of the day.

    None without any of its records, and None when they stop before the evening: the phone
    then stopped uploading part way through, and part of a day must not pass as the day (A).
    """
    sums: dict[str, float] = {}
    latest: datetime | None = None
    for item in samples:
        if item.source.is_samsung_direct and start <= item.timestamp < end:
            if item.type in (STEPS, ACTIVE_ENERGY):
                sums[item.type] = sums.get(item.type, 0.0) + item.value
                latest = item.timestamp if latest is None else max(latest, item.timestamp)
    if latest is None or latest < end - SAMSUNG_EVENING_BEFORE_END:
        sums = {}
    steps, kcal = sums.get(STEPS), sums.get(ACTIVE_ENERGY)
    return {
        "samsung_steps": None if steps is None else round(steps),
        "samsung_active_kcal": None if kcal is None else round(kcal, 1),
    }


def _samsung_sleep_score(inputs: DayInputs, main: SleepSession | None) -> float | None:
    """Samsung's Sleep Score of the day's night (fetch_day keeps only those).

    Scores of a nap are left out. Of the rest, a score of the main sleep wins, also when it
    names a copy of it from another source that dedupe dropped; else the latest one.
    """
    sessions = {s.id: s for s in inputs.sleeps}
    main_scores, other_scores = [], []
    for score in inputs.samsung_sleep_scores:
        session = sessions.get(score.event_record_id) if score.event_record_id else None
        if session is not None and session.is_nap:
            continue
        of_main = (
            session is not None
            and main is not None
            and session.start < main.end
            and main.start < session.end
        )
        (main_scores if of_main else other_scores).append(score)
    chosen = main_scores or other_scores
    return max(chosen, key=lambda s: s.recorded_at).value if chosen else None


def _sleep(main: SleepSession | None) -> dict[str, Any]:
    if main is None:
        return dict.fromkeys(_SLEEP_FIELDS)
    intervals = main.intervals
    if main.sleep_minutes is not None:
        total = main.sleep_minutes
    elif intervals:
        total = sum(_length(i.start, i.end) for i in intervals if i.stage != AWAKE)
    else:
        total = _length(main.start, main.end)
    awake, bouts = _wake_after_onset(intervals)
    return {
        "sleep_start": main.start,
        "sleep_end": main.end,
        "sleep_minutes": total,
        "in_bed_minutes": _length(main.start, main.end),
        "deep_minutes": sleep.stage_minutes(main, "deep"),
        "rem_minutes": sleep.stage_minutes(main, "rem"),
        "light_minutes": sleep.stage_minutes(main, "light"),
        "awake_minutes": main.awake_minutes if awake is None else awake,
        "awake_bouts": bouts,
    }


def extract(
    inputs: DayInputs,
    result: DayResult,
    person: Person,
    rest_hr: float | None,
    awake_history: Sequence[float] = (),
) -> DayFeatures:
    """Features of one local day.

    `rest_hr` is the reference resting heart rate for load and zones (the 14-day mean of
    sleep_rhr); without it the day's own resting heart rate is used. METs need an awake
    resting heart rate instead: the median of `awake_history` (awake_hr_p10 of the 14 days
    before) and the day's own awake_hr_p10, else `rest_hr`. Without a reference, or without
    any heart-rate reading, load, MET and zone values are None.
    """
    minute_hr = heart.minute_series(inputs.samples)
    rest = rest_hr if rest_hr is not None else result.hr_resting
    max_hr = person.max_hr if person.max_hr is not None else inputs.profile.max_hr
    vo2max = inputs.profile.vo2max
    workouts = _workouts(inputs, result)
    in_workout = _covered((w.start, w.end) for w in workouts)

    main, naps = _choose_sleeps(inputs)
    sessions = [main, *naps] if main else naps
    timeline = sorted((i for s in sessions for i in _timeline(s)), key=lambda i: i.start)
    # Tonight's sleep belongs to tomorrow, but its minutes before midnight are not awake ones.
    tonight = [i for s in sleep.dedupe(inputs.tonight_sleeps) for i in _timeline(s)]
    asleep = _covered((i.start, i.end) for i in (*timeline, *tonight) if i.stage != AWAKE)
    awake_hr = {m: v for m, v in minute_hr.items() if m not in asleep}

    awake_p10 = _awake_hr_p10(awake_hr, in_workout)
    # (A) Heart-rate reserve tracks VO2 reserve only from an awake resting heart rate; the
    # sleeping minimum turned ordinary sitting into moderate activity.
    awake_refs = [*awake_history, *([] if awake_p10 is None else [awake_p10])]
    awake_rest = median(awake_refs) if awake_refs else rest

    in_main = _covered([(main.start, main.end)]) if main else set()
    night = heart.minute_series(inputs.lead_in_samples) | minute_hr if main else {}
    low = _lowest_mean({m: v for m, v in night.items() if m in in_main}, SLEEP_RHR_MINUTES)

    if rest is None or not minute_hr:
        load_values = {**dict.fromkeys(_LOAD_FIELDS), "workout_strain": {}}
        zones = dict.fromkeys(_ZONE_FIELDS)
    else:
        day = (inputs.start, inputs.end)
        load_values = _load(minute_hr, awake_hr, rest, max_hr, person.sex, asleep, workouts, day)
        zones = _zones(awake_hr, rest, max_hr)
    steps = _hourly_steps(inputs.samples, inputs.start, inputs.end)
    if awake_rest is None or vo2max is None or not minute_hr:
        mets = dict.fromkeys(_MET_FIELDS)
    elif steps is None:
        mets = _mets(awake_hr, awake_rest, max_hr, vo2max, in_workout)
    else:
        effort = {
            m
            for m in awake_hr
            if m in in_workout or steps[_hour(m, inputs.start)] >= EFFORT_HOUR_STEPS
        }
        mets = {
            **_mets(awake_hr, awake_rest, max_hr, vo2max, in_workout, effort),
            **_inactive_hours(steps, awake_hr, in_workout, inputs.start),
        }

    return DayFeatures(
        day=inputs.day,
        complete=result.complete,
        wear_minutes=len(minute_hr),
        resting_hr=result.hr_resting,
        sleep_rhr=low[0] if low else None,
        sleep_hr_low_at=low[1] if low else None,
        night_hr=_night_hr(minute_hr, inputs.start, main),
        max_hr_seen=_max_held(minute_hr),
        **load_values,
        awake_hr_p10=awake_p10,
        awake_rest_hr=awake_rest,
        **mets,
        **zones,
        active_kcal=result.activity_kcal_est,
        steps=result.steps,
        strength_minutes=sum(
            _length(w.start, w.end) for w in workouts if w.type in load.STRENGTH_TYPES
        ),
        **_sleep(main),
        nap_minutes=float(result.nap_minutes or 0.0),
        sleep_intervals=tuple(timeline),
        vo2max=vo2max,
        weight_kg=inputs.profile.weight_kg,
        body_fat_pct=person.body_fat_pct,
        hrv_ms=result.hrv_ms,
        hrv_kind=result.hrv_kind,
        hrv_ms_source=result.hrv_ms_source,
        samsung_sleep_score=_samsung_sleep_score(inputs, main),
        **_samsung_sums(inputs.samples, inputs.start, inputs.end),
    )
