from datetime import timedelta

import pytest

from owi.heart import HeartStats, ZoneMinutes, minute_series, resting_hr, stats, zone_minutes
from owi.models import HEART_RATE, STEPS
from tests.factories import hr_minutes, sample, utc

START = utc(2026, 10, 12, 0)


def test_minute_series_averages_samples_within_a_minute():
    samples = [
        sample(utc(2026, 10, 12, 0, 0, 5), HEART_RATE, 60),
        sample(utc(2026, 10, 12, 0, 0, 45), HEART_RATE, 80),
        sample(utc(2026, 10, 12, 0, 1, 10), HEART_RATE, 90),
        sample(utc(2026, 10, 12, 0, 1, 20), STEPS, 500),
    ]

    assert minute_series(samples) == {START: 70.0, utc(2026, 10, 12, 0, 1): 90.0}


def test_resting_hr_needs_an_hour_of_data():
    assert resting_hr(minute_series(hr_minutes(START, [50.0] * 59))) is None


def test_resting_hr_is_the_lowest_30_minute_rolling_mean():
    values = [80.0] * 60 + [50.0] * 30 + [70.0] * 30

    assert resting_hr(minute_series(hr_minutes(START, values))) == pytest.approx(50.0)


def test_resting_hr_window_does_not_span_gaps():
    # Two 20-minute blocks of 40 bpm separated by a gap never form a 30-minute run.
    low_a = hr_minutes(START, [40.0] * 20)
    low_b = hr_minutes(START + timedelta(hours=2), [40.0] * 20)
    steady = hr_minutes(START + timedelta(hours=4), [60.0] * 60)

    assert resting_hr(minute_series(low_a + low_b + steady)) == pytest.approx(60.0)


def test_resting_hr_falls_back_to_the_fifth_percentile_without_a_30_minute_run():
    samples = [sample(START + timedelta(minutes=2 * i), HEART_RATE, 60 + i) for i in range(100)]

    assert resting_hr(minute_series(samples)) == pytest.approx(64.0)


def test_stats_use_minute_means_for_average_and_minimum_and_raw_samples_for_maximum():
    samples = [
        sample(utc(2026, 10, 12, 0, 0, 5), HEART_RATE, 100),
        sample(utc(2026, 10, 12, 0, 0, 45), HEART_RATE, 180),
        sample(utc(2026, 10, 12, 0, 1), HEART_RATE, 60),
    ]

    assert stats(samples, minute_series(samples)) == HeartStats(
        avg=100.0, minimum=60.0, maximum=180.0
    )


def test_stats_without_heart_rate_are_empty():
    assert stats([], {}) == HeartStats(avg=None, minimum=None, maximum=None)


def test_zone_minutes_split_by_share_of_max_hr():
    values = [99.0, 100.0, 139.0, 140.0, 169.0, 170.0, 200.0]

    zones = zone_minutes(minute_series(hr_minutes(START, values)), max_hr=200.0)

    assert zones == ZoneMinutes(light=2, moderate=2, vigorous=2)
