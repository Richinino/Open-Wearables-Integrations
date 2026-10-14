import math
from dataclasses import replace
from datetime import date, datetime, timedelta

import pytest

from owi import load
from owi.features import extract
from owi.heart import minute_series
from owi.models import (
    HEART_RATE,
    DayInputs,
    DayResult,
    Profile,
    SleepInterval,
    SleepSession,
    WorkoutResult,
)
from owi.score_models import MALE, DayFeatures, Person
from tests.factories import HC_SHEALTH, SAMSUNG_WATCH, hr_minutes, sample, utc, workout

DAY = date(2026, 10, 12)
START = utc(2026, 10, 11, 22)  # local midnight, Europe/Bratislava
END = utc(2026, 10, 12, 22)
REST = 50.0
MAX = 190.0
PERSON = Person(sex=MALE)
# VO2max 38.5 makes MET = 1 + 10 * heart-rate reserve.
PROFILE = Profile(weight_kg=70.0, vo2max=38.5, max_hr=MAX)
LOAD_FIELDS = ("trimp", "strain_load", "strain")
MET_FIELDS = (
    "met_minutes_medium",
    "met_minutes_high",
    "medium_minutes",
    "high_minutes",
    "inactive_hours",
    "long_inactive_bouts",
)
ZONE_FIELDS = ("zone_low_minutes", "zone_high_minutes")


def local(hour: int, minute: int = 0, second: int = 0) -> datetime:
    """A time on DAY, given as local clock time."""
    return START + timedelta(hours=hour, minutes=minute, seconds=second)


def hr_at(reserve: float) -> float:
    return REST + reserve * (MAX - REST)


def strain_weight(reserve: float) -> float:
    return reserve * math.exp(1.92 * reserve)


def session(
    id_: str,
    start: datetime,
    end: datetime,
    intervals: tuple[tuple[datetime, datetime, str], ...] = (),
    *,
    is_nap: bool = False,
    source=HC_SHEALTH,
    **minutes: float,
) -> SleepSession:
    return SleepSession(
        id=id_,
        start=start,
        end=end,
        source=source,
        is_nap=is_nap,
        intervals=tuple(SleepInterval(*item) for item in intervals),
        **minutes,
    )


def make_result(**changes) -> DayResult:
    empty = DayResult(
        day=DAY,
        timezone="Europe/Bratislava",
        complete=True,
        steps=None,
        steps_source=None,
        distance_m_est=None,
        active_minutes_est=None,
        activity_kcal_est=None,
        basal_kcal=None,
        total_kcal_est=None,
        hr_resting=None,
        hr_avg=None,
        hr_max=None,
        hr_min=None,
        zone_light_min=None,
        zone_moderate_min=None,
        zone_vigorous_min=None,
        sleep_start=None,
        sleep_end=None,
        sleep_minutes=None,
        sleep_deep_min=None,
        sleep_rem_min=None,
        sleep_light_min=None,
        sleep_awake_min=None,
        nap_minutes=None,
    )
    return replace(empty, **changes)


def run(
    samples=(),
    workouts=(),
    sleeps=(),
    *,
    rest_hr: float | None = REST,
    person: Person = PERSON,
    profile: Profile = PROFILE,
    result: DayResult | None = None,
) -> DayFeatures:
    inputs = DayInputs(
        day=DAY,
        start=START,
        end=END,
        samples=tuple(samples),
        workouts=tuple(workouts),
        sleeps=tuple(sleeps),
        profile=profile,
    )
    return extract(inputs, result or make_result(), person, rest_hr)


# Day values


def test_day_values_are_taken_from_the_result_profile_and_person():
    result = make_result(
        complete=False, steps=8000, activity_kcal_est=350.0, hr_resting=52.0, nap_minutes=25.0
    )

    features = run(
        hr_minutes(local(9), [70.0] * 90),
        person=Person(sex=MALE, body_fat_pct=18.0),
        result=result,
    )

    assert features.day == DAY
    assert features.complete is False
    assert features.wear_minutes == 90
    assert features.steps == 8000
    assert features.active_kcal == 350.0
    assert features.resting_hr == 52.0
    assert features.vo2max == 38.5
    assert features.weight_kg == 70.0
    assert features.body_fat_pct == 18.0
    assert features.nap_minutes == 25.0


def test_only_heart_rate_samples_count_as_worn_minutes():
    samples = [*hr_minutes(local(9), [70.0] * 3), sample(local(10), "steps", 500)]

    assert run(samples).wear_minutes == 3


# Reference heart rates


def test_reference_resting_hr_is_the_argument_before_the_day_value():
    samples = hr_minutes(local(9), [hr_at(0.6)] * 30)
    minute_hr = minute_series(samples)
    result = make_result(hr_resting=60.0)

    with_reference = run(samples, rest_hr=REST, result=result)
    without_reference = run(samples, rest_hr=None, result=result)

    assert with_reference.trimp == pytest.approx(load.trimp(minute_hr, REST, MAX, MALE))
    assert without_reference.trimp == pytest.approx(load.trimp(minute_hr, 60.0, MAX, MALE))


def test_without_any_resting_hr_load_met_and_zone_fields_are_missing():
    samples = hr_minutes(local(9), [hr_at(0.6)] * 30)
    workouts = [workout("lift", local(9), 30, type_="strength_training")]

    features = run(samples, workouts, rest_hr=None, result=make_result(hr_resting=None))

    for name in LOAD_FIELDS + MET_FIELDS + ZONE_FIELDS:
        assert getattr(features, name) is None, name
    assert features.workout_strain == {}
    assert features.wear_minutes == 30


def test_without_heart_rate_load_met_and_zone_fields_are_missing():
    workouts = [workout("lift", local(9), 30, type_="strength_training")]

    features = run((), workouts)

    for name in LOAD_FIELDS + MET_FIELDS + ZONE_FIELDS:
        assert getattr(features, name) is None, name
    assert features.workout_strain == {}
    assert features.wear_minutes == 0
    assert features.max_hr_seen is None


def test_max_hr_comes_from_the_person_before_the_profile():
    samples = hr_minutes(local(9), [150.0] * 30)
    minute_hr = minute_series(samples)

    from_person = run(samples, person=Person(sex=MALE, max_hr=170.0))
    from_profile = run(samples)

    assert from_person.trimp == pytest.approx(load.trimp(minute_hr, REST, 170.0, MALE))
    assert from_profile.trimp == pytest.approx(load.trimp(minute_hr, REST, MAX, MALE))


# Main sleep, naps and minutes asleep


def test_main_sleep_is_the_longest_non_nap_session_ending_on_the_day():
    night = session("night", local(-1), local(4))
    long_nap = session("nap", local(13), local(19), is_nap=True)
    tonight = session("tonight", local(23), local(31))

    features = run(sleeps=[long_nap, tonight, night])

    assert (features.sleep_start, features.sleep_end) == (local(-1), local(4))
    assert features.sleep_intervals == (
        SleepInterval(local(-1), local(4), "asleep"),
        SleepInterval(local(13), local(19), "asleep"),
    )


def test_main_sleep_comes_from_deduplicated_sessions():
    health_connect = session("hc", local(-1), local(6))
    samsung = session("samsung", local(-2), local(7), source=SAMSUNG_WATCH)

    features = run(sleeps=[samsung, health_connect])

    assert (features.sleep_start, features.sleep_end) == (local(-1), local(6))


def test_minutes_asleep_do_not_count_towards_load():
    night = session("night", local(-1), local(2))
    nap = session("nap", local(14), local(14, 30), is_nap=True)
    samples = [
        *hr_minutes(local(0), [hr_at(0.6)] * 120),
        *hr_minutes(local(10), [hr_at(0.6)] * 30),
        *hr_minutes(local(14), [hr_at(0.6)] * 30),
    ]
    awake_hr = minute_series(hr_minutes(local(10), [hr_at(0.6)] * 30))

    features = run(samples, sleeps=[night, nap])

    assert features.trimp == pytest.approx(load.trimp(awake_hr, REST, MAX, MALE))
    assert features.strain_load == pytest.approx(30 * strain_weight(0.6))


def test_awake_intervals_inside_the_main_sleep_count_as_awake():
    night = session(
        "night",
        local(0),
        local(3),
        (
            (local(0), local(1), "deep"),
            (local(1), local(1, 30), "awake"),
            (local(1, 30), local(3), "light"),
        ),
    )
    samples = hr_minutes(local(0), [hr_at(0.6)] * 180)

    features = run(samples, sleeps=[night])

    assert features.strain_load == pytest.approx(30 * strain_weight(0.6))


# Heart


def test_sleep_rhr_is_the_lowest_five_minute_mean_during_the_main_sleep():
    night = session("night", local(-1), local(5))
    samples = [
        *hr_minutes(local(0), [55.0] * 120 + [45.0] * 5 + [55.0] * 175),
        *hr_minutes(local(10), [40.0] * 10),
    ]

    features = run(samples, sleeps=[night])

    assert features.sleep_rhr == pytest.approx(45.0)
    assert features.sleep_hr_low_at == local(2)


def test_sleep_rhr_needs_five_consecutive_minutes():
    night = session("night", local(-1), local(5))
    samples = [sample(local(0, 2 * i), HEART_RATE, 55.0) for i in range(100)]

    features = run(samples, sleeps=[night])

    assert features.sleep_rhr is None
    assert features.sleep_hr_low_at is None


def test_sleep_rhr_needs_a_main_sleep():
    features = run(hr_minutes(local(0), [55.0] * 60))

    assert features.sleep_rhr is None
    assert features.sleep_hr_low_at is None


def test_night_hr_is_the_mean_until_seven_without_workouts():
    samples = [
        *hr_minutes(local(0), [60.0] * 60),
        *hr_minutes(local(1), [150.0] * 30),
        *hr_minutes(local(7), [100.0] * 60),
    ]
    workouts = [workout("night-run", local(1), 30)]

    assert run(samples, workouts).night_hr == pytest.approx(60.0)


def test_night_hr_needs_an_hour_of_readings():
    assert run(hr_minutes(local(0), [60.0] * 59)).night_hr is None


def test_max_hr_seen_ignores_single_minute_spikes():
    samples = [
        *hr_minutes(local(9), [100.0, 180.0, 110.0, 150.0, 152.0, 120.0]),
        *hr_minutes(local(12), [175.0]),
        *hr_minutes(local(12, 2), [175.0]),
    ]

    assert run(samples).max_hr_seen == 150.0


def test_max_hr_seen_needs_two_consecutive_minutes():
    assert run(hr_minutes(local(9), [150.0])).max_hr_seen is None


# Load


def test_strain_covers_the_whole_day_with_muscular_load_clipped_to_it():
    samples = hr_minutes(local(9), [hr_at(0.6)] * 30)
    workouts = [
        workout("lift", local(9), 40, type_="strength_training"),
        workout("late-lift", local(23, 30), 60, type_="strength_training"),
    ]

    features = run(samples, workouts)

    expected = 30 * strain_weight(0.6) + 0.6 * 40 + 0.6 * 30
    assert features.strain_load == pytest.approx(expected)
    assert features.strain == pytest.approx(load.strain_from_load(expected, MALE))


def test_workout_strain_is_the_strain_inside_each_workout():
    samples = [
        *hr_minutes(local(9), [hr_at(0.6)] * 30),
        *hr_minutes(local(15), [hr_at(0.6)] * 30),
    ]
    workouts = [
        workout("run", local(9), 30),
        workout("lift", local(18), 40, type_="strength_training"),
    ]

    features = run(samples, workouts)

    assert features.workout_strain == pytest.approx(
        {
            "run": load.strain_from_load(30 * strain_weight(0.6), MALE),
            "lift": load.strain_from_load(0.6 * 40, MALE),
        }
    )
    assert features.strain > features.workout_strain["run"]


def test_workouts_fall_back_to_the_result_when_inputs_have_none():
    samples = hr_minutes(local(9), [hr_at(0.6)] * 30)
    stored = WorkoutResult(
        id="run",
        day=DAY,
        type="running",
        start=local(9),
        end=local(9, 30),
        duration_s=1800,
        source="google",
        hr_avg=None,
        hr_max=None,
        hr_min=None,
        zone_light_min=0,
        zone_moderate_min=0,
        zone_vigorous_min=0,
        distance_m=None,
        kcal_est=None,
    )

    features = run(samples, result=make_result(workouts=(stored,)))

    assert features.workout_strain == pytest.approx(
        {"run": load.strain_from_load(30 * strain_weight(0.6), MALE)}
    )


def test_strength_minutes_count_strength_type_workouts():
    workouts = [
        workout("lift", local(8), 45, type_="strength_training"),
        workout("circuit", local(10), 15, type_="cardio_training"),
        workout("run", local(12), 30, type_="running"),
        workout("yoga", local(18), 20, type_="yoga"),
    ]

    assert run(workouts=workouts).strength_minutes == 60.0


# Activity


def test_met_minutes_come_from_awake_heart_rate_and_vo2max():
    night = session("night", local(0), local(1))
    samples = [
        *hr_minutes(local(0), [134.0] * 60),  # asleep
        *hr_minutes(local(9), [85.0] * 10),  # 3.5 MET
        *hr_minutes(local(10), [134.0] * 5),  # 7 MET
        *hr_minutes(local(11), [60.0] * 20),  # about 1.7 MET
    ]

    features = run(samples, sleeps=[night])

    assert features.medium_minutes == 10
    assert features.met_minutes_medium == pytest.approx(35.0)
    assert features.high_minutes == 5
    assert features.met_minutes_high == pytest.approx(35.0)
    assert features.inactive_hours == 0.0
    assert features.long_inactive_bouts == 0


def test_without_vo2max_met_fields_are_missing():
    features = run(hr_minutes(local(9), [120.0] * 10), profile=Profile(max_hr=MAX))

    for name in MET_FIELDS:
        assert getattr(features, name) is None, name
    assert features.zone_low_minutes == 10


def test_inactive_time_and_long_inactive_bouts():
    night = session("night", local(0), local(2))
    samples = [
        *hr_minutes(local(0), [52.0] * 120),  # asleep
        *hr_minutes(local(8), [52.0] * 60),  # one long bout
        *hr_minutes(local(9, 1), [52.0] * 49),  # a missing minute ends the bout before
        *hr_minutes(local(10), [52.0] * 60),  # first half is a workout
        *hr_minutes(local(14), [52.0] * 30 + [85.0] + [52.0] * 30),  # one active minute
    ]
    workouts = [workout("walk", local(10), 30, type_="walking")]

    features = run(samples, workouts, sleeps=[night])

    assert features.inactive_hours == pytest.approx((60 + 49 + 30 + 60) / 60)
    assert features.long_inactive_bouts == 1


def test_zone_minutes_use_awake_heart_rate_reserve():
    night = session("night", local(0), local(1))
    samples = [
        *hr_minutes(local(0), [170.0] * 60),  # asleep
        *hr_minutes(local(9), [120.0] * 10 + [160.0] * 5 + [170.0] * 7 + [118.0] * 3),
    ]

    features = run(samples, sleeps=[night])

    assert features.zone_low_minutes == 15
    assert features.zone_high_minutes == 7


# Sleep


STAGED_NIGHT = (
    (local(-1), local(-1, 5), "awake"),
    (local(-1, 5), local(1), "light"),
    (local(1), local(1, 5), "awake"),
    (local(1, 5), local(1, 10), "awake"),
    (local(1, 10), local(3), "deep"),
    (local(3), local(5), "rem"),
    (local(5), local(5, 0, 30), "awake"),
    (local(5, 0, 30), local(6, 50), "light"),
    (local(6, 50), local(7), "awake"),
)


def test_sleep_values_come_from_the_stage_timeline():
    features = run(sleeps=[session("night", local(-1), local(7), STAGED_NIGHT)])

    assert (features.sleep_start, features.sleep_end) == (local(-1), local(7))
    assert features.in_bed_minutes == pytest.approx(480.0)
    assert features.sleep_minutes == pytest.approx(115 + 110 + 120 + 109.5)
    assert features.light_minutes == pytest.approx(115 + 109.5)
    assert features.deep_minutes == pytest.approx(110.0)
    assert features.rem_minutes == pytest.approx(120.0)
    # Only wake after sleep onset: the first and last five or ten minutes are left out.
    assert features.awake_minutes == pytest.approx(10.5)
    # The two touching awake intervals are one bout; the 30-second one is too short.
    assert features.awake_bouts == 1


def test_session_totals_win_over_the_timeline_except_for_wake_after_onset():
    night = session(
        "night",
        local(-1),
        local(7),
        STAGED_NIGHT,
        sleep_minutes=400.0,
        deep_minutes=90.0,
        rem_minutes=70.0,
        light_minutes=220.0,
        awake_minutes=20.0,
    )

    features = run(sleeps=[night])

    assert features.sleep_minutes == 400.0
    assert (features.deep_minutes, features.rem_minutes, features.light_minutes) == (
        90.0,
        70.0,
        220.0,
    )
    assert features.awake_minutes == pytest.approx(10.5)


def test_timeline_without_stages_gives_no_stage_minutes():
    night = session(
        "night",
        local(0),
        local(6),
        (
            (local(0), local(3), "asleep"),
            (local(3), local(3, 20), "awake"),
            (local(3, 20), local(6), "asleep"),
        ),
    )

    features = run(sleeps=[night])

    assert features.sleep_minutes == pytest.approx(340.0)
    assert (features.deep_minutes, features.rem_minutes, features.light_minutes) == (
        None,
        None,
        None,
    )
    assert features.awake_minutes == pytest.approx(20.0)
    assert features.awake_bouts == 1


def test_sleep_without_a_timeline_uses_the_session_values():
    night = session("night", local(-1), local(6), awake_minutes=15.0)

    features = run(sleeps=[night])

    assert features.sleep_minutes == pytest.approx(420.0)
    assert features.deep_minutes is None
    assert features.awake_minutes == 15.0
    assert features.awake_bouts is None


def test_sleep_intervals_join_the_main_sleep_and_naps_in_order():
    night = session(
        "night",
        local(-1),
        local(6),
        ((local(-1), local(3), "light"), (local(3), local(6), "deep")),
    )
    nap = session("nap", local(14), local(14, 40), is_nap=True)

    features = run(sleeps=[nap, night])

    assert features.sleep_intervals == (
        SleepInterval(local(-1), local(3), "light"),
        SleepInterval(local(3), local(6), "deep"),
        SleepInterval(local(14), local(14, 40), "asleep"),
    )


def test_without_a_main_sleep_sleep_values_are_missing():
    features = run(hr_minutes(local(9), [70.0] * 10))

    for name in (
        "sleep_start",
        "sleep_end",
        "sleep_minutes",
        "in_bed_minutes",
        "deep_minutes",
        "rem_minutes",
        "light_minutes",
        "awake_minutes",
        "awake_bouts",
    ):
        assert getattr(features, name) is None, name
    assert features.nap_minutes == 0.0
    assert features.sleep_intervals == ()
