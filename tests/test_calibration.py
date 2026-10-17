from dataclasses import replace
from datetime import date, timedelta

import pytest

from owi import estimates, heart
from owi.calibration import (
    Comparison,
    Quality,
    RefDay,
    Truth,
    WorkoutStride,
    compare,
    day_weight,
    fit,
    load_params,
    load_truth,
    save_params,
    shrink,
    stride_samples,
)
from owi.entries import Entry
from owi.models import DayInputs, DayResult, Params, Profile
from tests.factories import hr_minutes, utc
from tests.test_store import make_workout

DAY = date(2026, 10, 12)
START = utc(2026, 10, 11, 22)
END = utc(2026, 10, 12, 22)
PROFILE = Profile(weight_kg=70.0, vo2max=48.0, max_hr=190.0)
DEFAULTS = Params()


def make_inputs(values: list[float], day: date = DAY, profile: Profile = PROFILE) -> DayInputs:
    return DayInputs(
        day=day,
        start=START,
        end=END,
        samples=tuple(hr_minutes(START, values)),
        workouts=(),
        sleeps=(),
        profile=profile,
    )


# 120 resting minutes at 50 bpm, 40 minutes of easy movement, 30 minutes of exercise.
HR_VALUES = [50.0] * 120 + [75.0] * 40 + [110.0] * 30


def ref(values: list[float] = HR_VALUES, profile: Profile = PROFILE) -> RefDay:
    return RefDay.of(make_inputs(values, profile=profile))


def days_back(count: int, last: date = DAY) -> list[date]:
    """`count` consecutive days ending on `last`, oldest first."""
    return [last - timedelta(days=count - 1 - i) for i in range(count)]


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


# files


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

    params = Params(stride_m=0.77, active_hr_delta=26.0, kcal_scale=0.7, basal_kcal=1700.0)
    save_params(path, params)

    assert load_params(path) == params


def test_params_from_an_older_or_newer_file_load(tmp_path):
    path = tmp_path / "params.json"
    path.write_text('{"stride_m": 0.8, "kcal_scale": 0.9, "later": 1}', encoding="utf-8")

    assert load_params(path) == Params(stride_m=0.8, kcal_scale=0.9)


# the pieces of the tuning


def test_a_days_weight_halves_every_60_days():
    assert day_weight(DAY, DAY) == 1.0
    assert day_weight(DAY - timedelta(days=60), DAY) == pytest.approx(0.5)
    assert day_weight(DAY - timedelta(days=120), DAY) == pytest.approx(0.25)


def test_shrinking_goes_half_way_after_seven_days_of_weight():
    assert shrink(1.0, 0.0, 0.0) == 0.0
    assert shrink(1.0, 0.0, 7.0) == pytest.approx(0.5)
    assert shrink(1.0, 0.0, 21.0) == pytest.approx(0.75)


# fit


def test_without_entries_every_parameter_keeps_its_current_value():
    # No day says anything new, so an earlier calibration is not thrown away (A).
    current = Params(stride_m=0.8, active_hr_delta=22.0, kcal_scale=0.9, max_hr=185.0)

    result = fit([], {}, [], current, DAY)

    assert result.params == current
    assert result.quality == {}


def test_with_fewer_than_six_days_a_value_that_misses_them_more_is_not_used():
    # The current stride fits both days exactly; the shrunk fit would miss them.
    entries = [Entry(day, steps=10000, distance_km=8.0) for day in days_back(2)]
    current = Params(stride_m=0.80)

    result = fit(entries, {}, [], current, DAY)

    assert result.params.stride_m == 0.80
    assert result.quality["distance_km"] == Quality(2, 0.0, 0.0, "%")


def test_stride_is_total_distance_over_total_steps_shrunk_by_the_days_behind_it():
    entries = [
        Entry(DAY, steps=20000, distance_km=15.0),
        Entry(DAY, steps=10000, distance_km=7.5),
        Entry(DAY, steps=5000),
    ]

    params = fit(entries, {}, [], DEFAULTS, DAY).params

    assert params.stride_m == pytest.approx(0.74 + 2 / 9 * (0.75 - 0.74))


def test_newer_days_weigh_more():
    entries = [
        Entry(DAY - timedelta(days=60), steps=10000, distance_km=10.0),
        Entry(DAY, steps=10000, distance_km=8.0),
    ]

    params = fit(entries, {}, [], DEFAULTS, DAY).params

    raw = (0.5 * 10.0 + 1.0 * 8.0) * 1000 / (1.5 * 10000)
    assert params.stride_m == pytest.approx(0.74 + 1.5 / 8.5 * (raw - 0.74))


def test_a_fitted_value_is_clamped_to_its_bounds_before_shrinking():
    entries = [Entry(DAY, steps=10000, distance_km=20.0)]

    params = fit(entries, {}, [], DEFAULTS, DAY).params

    assert params.stride_m == pytest.approx(0.74 + 1 / 8 * (1.10 - 0.74))


def test_workouts_with_distance_and_phone_steps_teach_the_stride():
    strides = [WorkoutStride(DAY, steps=8000, distance_m=6400.0)]

    params = fit([], {}, strides, DEFAULTS, DAY).params

    assert params.stride_m == pytest.approx(0.74 + 1 / 8 * (0.80 - 0.74))


def test_only_walks_and_runs_with_distance_phone_steps_and_a_plausible_stride_count():
    run = replace(make_workout("run"), distance_m=8000.0, phone_steps=10000)
    walk = replace(make_workout("walk"), type="walking", distance_m=1400.0, phone_steps=2000)
    ride = replace(make_workout("ride"), type="cycling", distance_m=20000.0, phone_steps=500)
    no_steps = replace(make_workout("no-steps"), distance_m=5000.0, phone_steps=None)
    no_distance = replace(make_workout("no-distance"), distance_m=None, phone_steps=5000)
    # The phone stayed home for part of the run: 2.5 m per step is no stride.
    partial = replace(make_workout("partial"), distance_m=5000.0, phone_steps=2000)

    found = stride_samples([run, walk, ride, no_steps, no_distance, partial])

    assert found == [WorkoutStride(DAY, 10000, 8000.0), WorkoutStride(DAY, 2000, 1400.0)]


def test_active_hr_delta_moves_toward_the_value_that_matches_the_active_time():
    # Resting is 50. Only the 30 minutes at 110 bpm are active once delta exceeds 25.
    entries = [Entry(DAY, active_minutes=30)]

    params = fit(entries, {DAY: ref()}, [], DEFAULTS, DAY).params

    assert params.active_hr_delta == pytest.approx(30 + 1 / 8 * (26 - 30))


def test_kcal_scale_moves_toward_the_reference_activity_calories():
    day = ref()
    minute_hr = heart.minute_series(make_inputs(HR_VALUES).samples)
    resting = heart.resting_hr(minute_hr)
    active = estimates.active_minutes(minute_hr, resting, [], START, END, 29.5)
    unscaled = estimates.activity_kcal(minute_hr, active, resting, PROFILE, 1.0)
    entries = [Entry(DAY, active_minutes=30, active_kcal=1.2 * unscaled)]

    params = fit(entries, {DAY: day}, [], DEFAULTS, DAY).params

    assert params.kcal_scale == pytest.approx(1 + 1 / 8 * 0.2)


def test_days_without_inputs_are_skipped_for_heart_based_params():
    entries = [Entry(DAY, active_minutes=30), Entry(date(2026, 10, 1), active_minutes=500)]

    params = fit(entries, {DAY: ref()}, [], DEFAULTS, DAY).params

    assert params.active_hr_delta == pytest.approx(30 + 1 / 8 * (26 - 30))


def test_basal_is_the_weighted_median_of_total_minus_active_without_a_record_to_lean_on():
    entries = [
        Entry(DAY, active_kcal=500, total_kcal=2200),
        Entry(DAY, active_kcal=600, total_kcal=2400),
        Entry(DAY, active_kcal=400, total_kcal=3400),
        Entry(DAY, total_kcal=2000),
    ]

    params = fit(entries, {}, [], DEFAULTS, DAY).params

    assert params.basal_kcal == pytest.approx(1800.0)


def test_basal_leans_toward_samsungs_record_and_stays_in_bounds():
    record = replace(PROFILE, basal_kcal_per_day=1600.0)
    entries = [Entry(DAY, active_kcal=100, total_kcal=3500)]

    params = fit(entries, {DAY: ref(profile=record)}, [], DEFAULTS, DAY).params

    assert params.basal_kcal == pytest.approx(1600 + 1 / 8 * (2500 - 1600))


def test_holdout_keeps_the_current_value_when_the_newest_days_say_it_is_better():
    older = [Entry(day, steps=10000, distance_km=8.0) for day in days_back(8)[:6]]
    newest = [Entry(day, steps=10000, distance_km=7.0) for day in days_back(8)[6:]]
    current = Params(stride_m=0.70)

    result = fit([*older, *newest], {}, [], current, DAY)

    assert result.params.stride_m == 0.70
    assert result.quality["distance_km"] == Quality(8, 0.0, 0.0, "%")


def test_holdout_accepts_a_better_value_and_then_fits_it_on_every_day():
    entries = [Entry(day, steps=10000, distance_km=8.0) for day in days_back(8)]
    current = Params(stride_m=0.60)

    result = fit(entries, {}, [], current, DAY)

    n_all = sum(day_weight(day, DAY) for day in days_back(8))
    n_older = sum(day_weight(day, DAY) for day in days_back(8)[:6])
    candidate = 0.74 + n_older / (n_older + 7) * (0.80 - 0.74)
    assert result.params.stride_m == pytest.approx(0.74 + n_all / (n_all + 7) * 0.06)
    quality = result.quality["distance_km"]
    assert quality.n == 8
    assert quality.error == pytest.approx(abs(candidate - 0.80) / 0.80 * 100)
    assert quality.previous_error == pytest.approx(25.0)


def test_with_fewer_than_six_days_quality_is_measured_on_all_of_them():
    entries = [Entry(DAY, steps=10000, distance_km=8.0, active_kcal=500, total_kcal=2300)]

    result = fit(entries, {}, [], DEFAULTS, DAY)

    stride = 0.74 + 1 / 8 * 0.06
    assert result.quality["distance_km"] == Quality(
        1, pytest.approx(abs(stride - 0.8) / 0.8 * 100), pytest.approx(7.5), "%"
    )
    total = result.quality["total_kcal"]
    assert (total.n, total.error, total.previous_error) == (1, 0.0, None)
    assert "active_minutes" not in result.quality


# compare


def test_compare_reports_the_error_in_percent_for_known_reference_values():
    entries = [Entry(DAY, steps=20000, active_minutes=200, distance_km=10.0)]
    results = {DAY: make_result(steps=21000, active_minutes_est=150, distance_m_est=None)}

    assert compare(entries, results) == [
        Comparison(DAY, "steps", 21000.0, 20000.0, pytest.approx(5.0)),
        Comparison(DAY, "active_minutes", 150.0, 200.0, pytest.approx(-25.0)),
        Comparison(DAY, "distance_km", None, 10.0, None),
    ]


def test_compare_skips_days_without_a_result():
    assert compare([Entry(DAY, steps=1)], {}) == []


def test_saving_params_leaves_no_temporary_file(tmp_path):
    save_params(tmp_path / "params.json", Params(stride_m=0.8))
    save_params(tmp_path / "params.json", Params(stride_m=0.9))

    assert [p.name for p in tmp_path.iterdir()] == ["params.json"]
    assert load_params(tmp_path / "params.json").stride_m == 0.9
