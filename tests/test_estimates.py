from datetime import timedelta

import pytest

from owi.estimates import (
    active_minutes,
    activity_kcal,
    distance_m,
    kcal_per_minute,
    total_kcal,
)
from owi.heart import minute_series
from owi.models import Params, Profile
from tests.factories import hr_minutes, utc

START = utc(2026, 10, 11, 22)
END = utc(2026, 10, 12, 22)
PROFILE = Profile(weight_kg=70.0, vo2max=48.0, basal_kcal_per_day=1600.0, max_hr=190.0)


def test_distance_is_steps_times_stride():
    assert distance_m(1000, Params(stride_m=0.74)) == pytest.approx(740.0)
    assert distance_m(None, Params()) is None


def test_minutes_at_or_above_resting_plus_delta_are_active():
    minute_hr = minute_series(hr_minutes(START, [50.0, 79.0, 80.0, 120.0]))

    active = active_minutes(minute_hr, 50.0, [], START, END, hr_delta=30.0)

    assert active == {START + timedelta(minutes=2), START + timedelta(minutes=3)}


def test_workout_minutes_are_active_even_without_heart_rate():
    interval = (utc(2026, 10, 12, 10, 0, 30), utc(2026, 10, 12, 10, 3))

    active = active_minutes({}, None, [interval], START, END, hr_delta=30.0)

    assert active == {
        utc(2026, 10, 12, 10, 0),
        utc(2026, 10, 12, 10, 1),
        utc(2026, 10, 12, 10, 2),
    }


def test_workout_minutes_are_clipped_to_the_day():
    interval = (utc(2026, 10, 12, 21, 58), utc(2026, 10, 12, 22, 5))

    active = active_minutes({}, None, [interval], START, END, hr_delta=30.0)

    assert active == {utc(2026, 10, 12, 21, 58), utc(2026, 10, 12, 21, 59)}


def test_without_resting_hr_only_workouts_count():
    minute_hr = minute_series(hr_minutes(START, [150.0, 150.0]))

    assert active_minutes(minute_hr, None, [], START, END, hr_delta=30.0) == set()


def test_kcal_per_minute_follows_heart_rate_reserve():
    assert kcal_per_minute(140.0, 50.0, PROFILE) == pytest.approx(10.0125, abs=0.001)


def test_kcal_per_minute_is_clamped_to_the_reserve_range():
    assert kcal_per_minute(40.0, 50.0, PROFILE) == 0.0
    assert kcal_per_minute(250.0, 50.0, PROFILE) == pytest.approx(15.575, abs=0.001)


@pytest.mark.parametrize(
    ("resting", "profile"),
    [
        (None, PROFILE),
        (45.0, Profile(weight_kg=None, vo2max=48.0)),
        (45.0, Profile(weight_kg=70.0, vo2max=None)),
        (200.0, PROFILE),
    ],
)
def test_kcal_per_minute_needs_resting_hr_weight_vo2max_and_a_positive_reserve(resting, profile):
    assert kcal_per_minute(120.0, resting, profile) is None


def test_activity_kcal_sums_active_minutes_that_have_heart_rate_and_applies_the_scale():
    minute_hr = minute_series(hr_minutes(START, [140.0, 140.0, 140.0]))
    active = {START, START + timedelta(minutes=1), START + timedelta(hours=5)}

    result = activity_kcal(minute_hr, active, 50.0, PROFILE, kcal_scale=0.5)

    assert result == pytest.approx(2 * 10.0125 * 0.5, abs=0.002)


def test_activity_kcal_is_none_when_it_cannot_be_estimated():
    minute_hr = minute_series(hr_minutes(START, [140.0]))

    assert activity_kcal(minute_hr, {START}, None, PROFILE, kcal_scale=1.0) is None


def test_total_kcal_adds_prorated_basal_to_activity():
    assert total_kcal(300.0, PROFILE, elapsed_fraction=0.5) == (800.0, 1100.0)


def test_total_kcal_handles_missing_parts():
    assert total_kcal(None, PROFILE, 1.0) == (1600.0, None)
    assert total_kcal(300.0, Profile(), 1.0) == (None, None)
