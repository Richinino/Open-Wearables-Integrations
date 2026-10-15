"""Fetch one local day from Open Wearables and turn it into a DayResult and DayFeatures."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime, timedelta
from statistics import fmean
from typing import Protocol
from zoneinfo import ZoneInfo

from owi import estimates, features, heart, sleep, steps, workouts
from owi.days import day_window, elapsed_fraction, today
from owi.models import (
    BASAL_ENERGY,
    BODY_FAT,
    DISTANCE,
    HEART_RATE,
    STEPS,
    VO2_MAX,
    WEIGHT,
    DayInputs,
    DayResult,
    Params,
    Profile,
    Sample,
    SleepSession,
    Workout,
)
from owi.score_models import DayFeatures, Person
from owi.store import Store

DAY_TYPES = (STEPS, HEART_RATE, DISTANCE)
PROFILE_TYPES = (WEIGHT, VO2_MAX, BASAL_ENERGY, BODY_FAT)
PROFILE_LOOKBACK = timedelta(days=400)
# A night's sleep starts on the previous local day.
SLEEP_LOOKBACK = timedelta(days=1)
REST_HR_DAYS = 14


class Client(Protocol):
    def timeseries(
        self, user_id: str, types: Sequence[str], start: datetime, end: datetime
    ) -> list[Sample]: ...

    def workouts(self, user_id: str, start: datetime, end: datetime) -> list[Workout]: ...

    def sleeps(self, user_id: str, start: datetime, end: datetime) -> list[SleepSession]: ...


def load_profile_samples(client: Client, user_id: str, until: datetime) -> list[Sample]:
    """Weight, VO2max, basal energy and body fat change rarely; one wide fetch serves a sync."""
    return client.timeseries(user_id, PROFILE_TYPES, until - PROFILE_LOOKBACK, until)


def profile_for(samples: Sequence[Sample], until: datetime, defaults: Profile) -> Profile:
    def latest(type_: str, fallback: float | None) -> float | None:
        known = [s for s in samples if s.type == type_ and s.timestamp < until]
        return max(known, key=lambda s: s.timestamp).value if known else fallback

    return Profile(
        weight_kg=latest(WEIGHT, defaults.weight_kg),
        vo2max=latest(VO2_MAX, defaults.vo2max),
        basal_kcal_per_day=latest(BASAL_ENERGY, defaults.basal_kcal_per_day),
        max_hr=defaults.max_hr,
        body_fat_pct=latest(BODY_FAT, defaults.body_fat_pct),
    )


def fetch_day(
    client: Client, user_id: str, day: date, tz: ZoneInfo, profile: Profile, now: datetime
) -> DayInputs:
    start, end = day_window(day, tz)
    found_sleeps = client.sleeps(user_id, start - SLEEP_LOOKBACK, end)
    sleeps = tuple(s for s in found_sleeps if start <= s.end < end)
    # One fetch also covers the part of the night before midnight.
    lead_in = min([start, *(s.start for s in sleeps if not s.is_nap)])
    samples = client.timeseries(user_id, DAY_TYPES, lead_in, end)
    found_workouts = client.workouts(user_id, start, end)
    return DayInputs(
        day=day,
        start=start,
        end=end,
        samples=tuple(s for s in samples if start <= s.timestamp < end),
        workouts=tuple(workouts.dedupe(w for w in found_workouts if start <= w.start < end)),
        sleeps=sleeps,
        profile=profile,
        complete=day < today(tz, now),
        elapsed_fraction=elapsed_fraction(day, tz, now),
        lead_in_samples=tuple(
            s for s in samples if s.type == HEART_RATE and lead_in <= s.timestamp < start
        ),
        tonight_sleeps=tuple(s for s in found_sleeps if start <= s.start < end <= s.end),
    )


def has_data(inputs: DayInputs) -> bool:
    return bool(inputs.samples or inputs.workouts or inputs.sleeps)


def compute(inputs: DayInputs, params: Params, timezone: str) -> DayResult:
    tz = ZoneInfo(timezone)
    hr_samples = [s for s in inputs.samples if s.type == HEART_RATE]
    minute_hr = heart.minute_series(hr_samples)
    resting = heart.resting_hr(minute_hr)
    hr_stats = heart.stats(hr_samples, minute_hr)
    zones = heart.zone_minutes(minute_hr, inputs.profile.max_hr) if minute_hr else None

    choice = steps.select_steps(inputs.samples, inputs.day, tz, inputs.start, inputs.end)
    step_count = choice.value if choice else None

    intervals = [(w.start, w.end) for w in inputs.workouts]
    active = estimates.active_minutes(
        minute_hr, resting, intervals, inputs.start, inputs.end, params.active_hr_delta
    )
    activity = estimates.activity_kcal(
        minute_hr, active, resting, inputs.profile, params.kcal_scale
    )
    basal, total = estimates.total_kcal(activity, inputs.profile, inputs.elapsed_fraction)

    summary = sleep.summarize(inputs.sleeps)
    main = summary.main if summary else None

    return DayResult(
        day=inputs.day,
        timezone=timezone,
        complete=inputs.complete,
        steps=step_count,
        steps_source=choice.source if choice else None,
        distance_m_est=estimates.distance_m(step_count, params),
        active_minutes_est=len(active) if (minute_hr or intervals) else None,
        activity_kcal_est=activity if minute_hr else None,
        basal_kcal=basal,
        total_kcal_est=total if minute_hr else None,
        hr_resting=resting,
        hr_avg=hr_stats.avg,
        hr_max=hr_stats.maximum,
        hr_min=hr_stats.minimum,
        zone_light_min=zones.light if zones else None,
        zone_moderate_min=zones.moderate if zones else None,
        zone_vigorous_min=zones.vigorous if zones else None,
        sleep_start=main.start if main else None,
        sleep_end=main.end if main else None,
        sleep_minutes=sleep.minutes_asleep(main) if main else None,
        sleep_deep_min=main.deep_minutes if main else None,
        sleep_rem_min=main.rem_minutes if main else None,
        sleep_light_min=main.light_minutes if main else None,
        sleep_awake_min=main.awake_minutes if main else None,
        nap_minutes=float(summary.nap_minutes) if summary else None,
        workouts=tuple(
            workouts.enrich(w, inputs.samples, inputs.day, resting, inputs.profile, params)
            for w in inputs.workouts
        ),
    )


def day_features(store: Store, inputs: DayInputs, result: DayResult, person: Person) -> DayFeatures:
    """Features of one day, with references from the stored days in the 14 before it.

    The resting heart rate for load is their mean sleep_rhr (without any, extract() uses the
    day's own); their awake_hr_p10 values feed the awake reference for METs.
    """
    earlier = store.features(
        inputs.day - timedelta(days=REST_HR_DAYS), inputs.day - timedelta(days=1)
    )
    sleep_rhr = [f.sleep_rhr for f in earlier if f.sleep_rhr is not None]
    awake = [f.awake_hr_p10 for f in earlier if f.awake_hr_p10 is not None]
    rest = fmean(sleep_rhr) if sleep_rhr else None
    return features.extract(inputs, result, person, rest, awake)
