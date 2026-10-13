from dataclasses import replace
from datetime import date

import pytest

from owi import estimates, heart
from owi.calibration import (
    Comparison,
    Truth,
    compare,
    fit,
    load_params,
    load_truth,
    save_params,
)
from owi.models import DayInputs, DayResult, Params, Profile
from tests.factories import hr_minutes, utc

DAY = date(2026, 10, 12)
START = utc(2026, 10, 11, 22)
END = utc(2026, 10, 12, 22)
PROFILE = Profile(weight_kg=70.0, vo2max=48.0, max_hr=190.0)


def make_inputs(values: list[float], day: date = DAY) -> DayInputs:
    return DayInputs(
        day=day,
        start=START,
        end=END,
        samples=tuple(hr_minutes(START, values)),
        workouts=(),
        sleeps=(),
        profile=PROFILE,
    )


# 120 resting minutes at 50 bpm, 40 minutes of easy movement, 30 minutes of exercise.
HR_VALUES = [50.0] * 120 + [75.0] * 40 + [110.0] * 30


def make_result(**changes) -> DayResult:
    empty = dict.fromkeys(
        (
            "steps_source",
            "distance_m_est",
            "active_minutes_est",
            "activity_kcal_est",
            "basal_kcal",
            "total_kcal_est",
            "hr_resting",
            "hr_avg",
            "hr_max",
            "hr_min",
            "zone_light_min",
            "zone_moderate_min",
            "zone_vigorous_min",
            "sleep_start",
            "sleep_end",
            "sleep_minutes",
            "sleep_deep_min",
            "sleep_rem_min",
            "sleep_light_min",
            "sleep_awake_min",
            "nap_minutes",
        )
    )
    result = DayResult(day=DAY, timezone="Europe/Bratislava", complete=True, steps=None, **empty)
    return replace(result, **changes)


def test_load_truth_reads_blank_fields_as_unknown(tmp_path):
    path = tmp_path / "truth.csv"
    path.write_text(
        "date,steps,active_minutes,activity_kcal,total_kcal,distance_km\n"
        "2026-10-12,20000,200,950,2400,15.5\n"
        "2026-10-11,13000,,,,\n",
        encoding="utf-8",
    )

    assert load_truth(path) == [
        Truth(
            DAY,
            steps=20000,
            active_minutes=200.0,
            activity_kcal=950.0,
            total_kcal=2400.0,
            distance_km=15.5,
        ),
        Truth(date(2026, 10, 11), steps=13000),
    ]


def test_params_round_trip_and_default_when_the_file_is_missing(tmp_path):
    path = tmp_path / "nested" / "params.json"

    assert load_params(path) == Params()

    save_params(path, Params(stride_m=0.77, active_hr_delta=26.0, kcal_scale=0.7))

    assert load_params(path) == Params(stride_m=0.77, active_hr_delta=26.0, kcal_scale=0.7)


def test_fit_without_usable_truth_keeps_the_base_params():
    base = Params(stride_m=0.8, active_hr_delta=22.0, kcal_scale=0.9)

    assert fit([], {}, base) == base
    assert fit([Truth(DAY, steps=1000)], {}, base) == base


def test_stride_is_total_distance_over_total_steps():
    truths = [
        Truth(DAY, steps=20000, distance_km=15.0),
        Truth(date(2026, 10, 11), steps=10000, distance_km=7.5),
        Truth(date(2026, 10, 10), steps=5000),
    ]

    assert fit(truths, {}, Params()).stride_m == pytest.approx(0.75)


def test_active_hr_delta_is_the_smallest_value_that_matches_the_active_time():
    # Resting is 50. Only the 30 minutes at 110 bpm are active once delta exceeds 25.
    truths = [Truth(DAY, active_minutes=30)]

    params = fit(truths, {DAY: make_inputs(HR_VALUES)}, Params())

    assert params.active_hr_delta == 26.0


def test_kcal_scale_matches_the_reference_activity_calories():
    inputs = make_inputs(HR_VALUES)
    minute_hr = heart.minute_series(inputs.samples)
    resting = heart.resting_hr(minute_hr)
    active = estimates.active_minutes(minute_hr, resting, [], START, END, 26.0)
    unscaled = estimates.activity_kcal(minute_hr, active, resting, PROFILE, 1.0)
    truths = [Truth(DAY, active_minutes=30, activity_kcal=2 * unscaled)]

    params = fit(truths, {DAY: inputs}, Params())

    assert params.kcal_scale == pytest.approx(2.0)


def test_days_without_inputs_are_skipped_for_heart_based_params():
    truths = [Truth(DAY, active_minutes=30), Truth(date(2026, 10, 1), active_minutes=500)]

    params = fit(truths, {DAY: make_inputs(HR_VALUES)}, Params())

    assert params.active_hr_delta == 26.0


def test_compare_reports_the_error_in_percent_for_known_reference_values():
    truths = [Truth(DAY, steps=20000, active_minutes=200, distance_km=10.0)]
    results = {DAY: make_result(steps=21000, active_minutes_est=150, distance_m_est=None)}

    assert compare(truths, results) == [
        Comparison(DAY, "steps", 21000.0, 20000.0, pytest.approx(5.0)),
        Comparison(DAY, "active_minutes", 150.0, 200.0, pytest.approx(-25.0)),
        Comparison(DAY, "distance_km", None, 10.0, None),
    ]


def test_compare_skips_days_without_a_result():
    assert compare([Truth(DAY, steps=1)], {}) == []
