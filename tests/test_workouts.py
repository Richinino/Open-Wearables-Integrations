from datetime import date, timedelta

import pytest

from owi.estimates import kcal_per_minute
from owi.models import DISTANCE, STEPS, Params, Profile
from owi.workouts import dedupe, enrich
from tests.factories import (
    HC_PHONE,
    HC_SHEALTH,
    SAMSUNG_WATCH,
    hr_minutes,
    sample,
    utc,
    workout,
)

DAY = date(2026, 10, 12)
START = utc(2026, 10, 12, 16)
PROFILE = Profile(weight_kg=70.0, vo2max=48.0, max_hr=200.0)


def test_same_type_starting_within_two_minutes_is_one_workout_and_health_connect_wins():
    samsung = workout("samsung", START + timedelta(seconds=90), 60, source=SAMSUNG_WATCH)
    health_connect = workout("hc", START, 60, source=HC_SHEALTH)

    assert dedupe([samsung, health_connect]) == [health_connect]


def test_different_type_or_later_start_stays_separate():
    run = workout("run", START, 60, type_="running")
    walk = workout("walk", START, 60, type_="walking", source=SAMSUNG_WATCH)
    second_run = workout("run2", START + timedelta(minutes=3), 30, source=SAMSUNG_WATCH)

    assert dedupe([second_run, walk, run]) == [run, walk, second_run]


def test_enrich_computes_heart_rate_zones_duration_and_kcal():
    item = workout("w1", START, 3)
    samples = [
        *hr_minutes(START - timedelta(minutes=2), [60.0, 60.0]),
        *hr_minutes(START, [100.0, 140.0, 180.0]),
        *hr_minutes(START + timedelta(minutes=10), [190.0]),
    ]

    result = enrich(item, samples, DAY, 50.0, PROFILE, Params(kcal_scale=2.0))

    expected_kcal = 2.0 * sum(kcal_per_minute(hr, 50.0, PROFILE) for hr in (100.0, 140.0, 180.0))
    assert result.id == "w1"
    assert result.day == DAY
    assert result.type == "running"
    assert (result.start, result.end) == (item.start, item.end)
    assert result.duration_s == 180
    assert result.source == "google"
    assert result.hr_avg == pytest.approx(140.0)
    assert (result.hr_min, result.hr_max) == (100.0, 180.0)
    assert (result.zone_light_min, result.zone_moderate_min, result.zone_vigorous_min) == (1, 1, 1)
    assert result.kcal_est == pytest.approx(expected_kcal)


def test_enrich_without_heart_rate_leaves_heart_fields_empty():
    result = enrich(workout("w1", START, 30), [], DAY, 50.0, PROFILE, Params())

    assert (result.hr_avg, result.hr_min, result.hr_max) == (None, None, None)
    assert (result.zone_light_min, result.zone_moderate_min, result.zone_vigorous_min) == (0, 0, 0)
    assert result.kcal_est is None


def test_distance_reported_by_the_api_is_kept():
    item = workout("w1", START, 30, distance_m=5000.0)
    samples = [sample(START, DISTANCE, 7500.0, HC_SHEALTH)]

    assert enrich(item, samples, DAY, 50.0, PROFILE, Params()).distance_m == 5000.0


def test_missing_distance_is_taken_from_the_samsung_health_sample_at_the_workout_start():
    item = workout("w1", START + timedelta(seconds=31), 30)
    samples = [
        sample(START - timedelta(minutes=5), DISTANCE, 111.0, HC_SHEALTH),
        sample(START + timedelta(seconds=20), DISTANCE, 222.0, HC_PHONE),
        sample(START, DISTANCE, 7500.0, HC_SHEALTH),
    ]

    assert enrich(item, samples, DAY, 50.0, PROFILE, Params()).distance_m == 7500.0


def test_distance_stays_empty_without_a_matching_sample():
    item = workout("w1", START, 30)
    samples = [sample(START + timedelta(minutes=5), DISTANCE, 900.0, HC_SHEALTH)]

    assert enrich(item, samples, DAY, 50.0, PROFILE, Params()).distance_m is None


def test_phone_steps_are_the_phone_counters_records_inside_the_workout():
    item = workout("w1", START, 30, distance_m=4000.0)
    samples = [
        sample(START - timedelta(minutes=1), STEPS, 999, HC_PHONE),
        sample(START, STEPS, 2000, HC_PHONE),
        sample(START + timedelta(minutes=15), STEPS, 2500, HC_PHONE),
        sample(START + timedelta(minutes=30), STEPS, 999, HC_PHONE),
        # Samsung's own counts are not the phone's pedometer.
        sample(START + timedelta(minutes=5), STEPS, 777, HC_SHEALTH),
        sample(START + timedelta(minutes=5), STEPS, 777, SAMSUNG_WATCH),
    ]

    assert enrich(item, samples, DAY, 50.0, PROFILE, Params()).phone_steps == 4500


def test_phone_steps_stay_empty_without_phone_records():
    item = workout("w1", START, 30)
    samples = [sample(START + timedelta(minutes=5), STEPS, 777, HC_SHEALTH)]

    assert enrich(item, samples, DAY, 50.0, PROFILE, Params()).phone_steps is None
