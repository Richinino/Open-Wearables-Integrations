from dataclasses import replace
from datetime import date, timedelta
from statistics import fmean

import pytest

from owi import samsung_scores
from owi.calibration import Quality
from owi.models import SleepInterval
from owi.samsung_scores import (
    ENERGY_PARTS,
    SLEEP_PARTS,
    SamsungModels,
    ScoreModel,
    ScoreObs,
    energy_parts,
    estimate,
    load_models,
    ridge_weights,
    save_models,
    sleep_parts,
    tune_model,
)
from owi.score_models import MALE, NightSignal, Person, Score
from tests.factories import make_features

TIMEZONE = "Europe/Bratislava"
D = date(2026, 10, 14)
TEEN = Person(age=17, sex=MALE)
ADULT = Person(age=30, sex=MALE)
NO_NIGHT = NightSignal(None, None, None, None)


def history(count: int = 40, last: date = D, **fields: object):
    return [make_features(last - timedelta(days=count - 1 - i), **fields) for i in range(count)]


def with_day(days, day: date, **fields: object):
    return [replace(item, **fields) if item.day == day else item for item in days]


# Sleep Score parts


def test_sleep_parts_of_an_ordinary_night():
    # 500 min asleep of 540 in bed, 90 deep, 110 REM, 40 awake, asleep from the first minute.
    parts = sleep_parts(make_features(D), TEEN)

    assert parts == {
        "duration": 100.0,
        "deep": pytest.approx(90 / 500 / 0.20 * 100),
        "rem": pytest.approx(110 / 500 / 0.25 * 100),
        "efficiency": pytest.approx(500 / 540 * 100),
        "interruptions": pytest.approx(50.0),
        "latency": 100.0,
    }


def test_duration_is_measured_against_eight_hours_for_a_teenager_and_seven_and_a_half_after():
    night = make_features(D, sleep_minutes=400.0)

    assert sleep_parts(night, TEEN)["duration"] == pytest.approx(400 / 480 * 100)
    assert sleep_parts(night, ADULT)["duration"] == pytest.approx(400 / 450 * 100)


def test_latency_is_the_time_awake_before_the_first_sleep_stage():
    night = make_features(D)
    start = night.sleep_start
    intervals = (
        SleepInterval(start, start + timedelta(minutes=30), "awake"),
        SleepInterval(start + timedelta(minutes=30), night.sleep_end, "light"),
    )

    parts = sleep_parts(replace(night, sleep_intervals=intervals), TEEN)

    assert parts["latency"] == pytest.approx(50.0)


def test_short_wake_and_quick_sleep_score_full_points():
    parts = sleep_parts(make_features(D, awake_minutes=15.0), TEEN)

    assert parts["interruptions"] == 100.0


def test_a_day_without_a_night_has_no_sleep_parts():
    night = make_features(D, sleep_minutes=None, sleep_intervals=())

    assert sleep_parts(night, TEEN) == dict.fromkeys(SLEEP_PARTS)


def test_missing_stages_leave_only_their_parts_empty():
    night = make_features(D, deep_minutes=None, rem_minutes=None, sleep_intervals=())

    parts = sleep_parts(night, TEEN)

    assert (parts["deep"], parts["rem"], parts["latency"]) == (None, None, None)
    assert parts["duration"] == 100.0


# Energy Score parts


def test_energy_parts_of_steady_days():
    days = history()

    parts = energy_parts(days, TEEN, TIMEZONE, 90.0, NightSignal("green", 52.0, 51.0, 1.0))

    assert parts == {
        "sleep": 100.0,
        "regularity": 100.0,
        "timing": 100.0,
        "load": 100.0,
        "night_hr": pytest.approx(87.5),
    }


def test_energy_sleep_is_the_seven_day_average_against_the_need():
    days = history(sleep_minutes=420.0, nap_minutes=0.0)
    days = with_day(days, D - timedelta(days=7), sleep_minutes=100.0)  # outside the 7 days

    parts = energy_parts(days, TEEN, TIMEZONE, None, NO_NIGHT)

    assert parts["sleep"] == pytest.approx(420 / 480 * 100)
    assert parts["regularity"] is None
    assert parts["night_hr"] is None


def test_energy_regularity_follows_the_readiness_curve():
    parts = energy_parts(history(), TEEN, TIMEZONE, 75.0, NO_NIGHT)

    assert parts["regularity"] == pytest.approx(80.0)


def test_energy_timing_compares_the_nights_midpoint_with_the_two_weeks_before():
    days = history()
    late = days[-1]
    shift = timedelta(minutes=90)
    days[-1] = replace(late, sleep_start=late.sleep_start + shift, sleep_end=late.sleep_end + shift)

    parts = energy_parts(days, TEEN, TIMEZONE, None, NO_NIGHT)

    assert parts["timing"] == pytest.approx(100 - 90 / 180 * 100)


def test_energy_load_compares_yesterdays_trimp_with_the_28_days_up_to_it():
    days = with_day(history(), D - timedelta(days=1), trimp=171.0)

    parts = energy_parts(days, TEEN, TIMEZONE, None, NO_NIGHT)

    ratio = 171.0 / fmean([171.0] + [85.5] * 27)
    assert parts["load"] == pytest.approx(100 - 50 * (ratio - 1))


def test_energy_load_needs_a_worn_yesterday_and_two_measured_weeks():
    unworn = with_day(history(), D - timedelta(days=1), wear_minutes=500)
    short = history(13)

    assert energy_parts(unworn, TEEN, TIMEZONE, None, NO_NIGHT)["load"] is None
    assert energy_parts(short, TEEN, TIMEZONE, None, NO_NIGHT)["load"] is None


def test_energy_night_heart_rate_loses_points_above_normal_only():
    low = energy_parts(history(), TEEN, TIMEZONE, None, NightSignal("green", 49.0, 51.0, -2.0))
    high = energy_parts(history(), TEEN, TIMEZONE, None, NightSignal("red", 59.0, 51.0, 8.0))

    assert low["night_hr"] == 100.0
    assert high["night_hr"] == 0.0


# The estimate


def test_the_estimate_waits_for_ten_entries():
    parts = sleep_parts(make_features(D), TEEN)

    assert estimate(parts, ScoreModel(entries=9)) == Score(
        None, {"entries": 9, "needed": 10}, "learning"
    )


def test_the_estimate_is_the_weighted_parts_renormalised_over_the_known_ones():
    parts = {"duration": 80.0, "deep": 60.0, "rem": None}
    model = ScoreModel(entries=10, weights={"duration": 0.5, "deep": 0.25, "rem": 0.25})

    score = estimate(parts, model)

    assert score == Score(round((0.5 * 80 + 0.25 * 60) / 0.75, 1), parts, "estimate")


def test_without_learned_weights_every_part_counts_the_same():
    parts = {"sleep": 90.0, "load": 70.0, "timing": None}

    assert estimate(parts, ScoreModel(entries=12)).value == 80.0


def test_the_estimate_without_any_part_is_empty():
    parts = dict.fromkeys(ENERGY_PARTS)

    assert estimate(parts, ScoreModel(entries=12)) == Score(None, parts, "no data")


# Learning the weights


def rows(count: int, truth_part: str = "a"):
    """Days where the truth is exactly part `truth_part`; the other part is noise."""
    found = []
    for i in range(count):
        a, b = 40.0 + 5 * (i % 7), 90.0 - 7 * (i % 5)
        parts = {"a": a, "b": b}
        found.append((1.0, parts, parts[truth_part]))
    return found


def test_without_rows_the_weights_are_equal():
    assert ridge_weights([], ("a", "b")) == {"a": 0.5, "b": 0.5}


def test_weights_move_from_equal_toward_the_part_that_explains_the_truth():
    few = ridge_weights(rows(3), ("a", "b"))
    many = ridge_weights(rows(60), ("a", "b"))

    assert 0.5 < few["a"] < many["a"]
    assert many["a"] > 0.9
    for weights in (few, many):
        assert sum(weights.values()) == pytest.approx(1.0)
        assert min(weights.values()) >= 0.0


def test_a_missing_part_is_filled_with_the_mean_of_the_known_ones():
    weights = ridge_weights([(1.0, {"a": 80.0, "b": None}, 80.0)] * 40, ("a", "b"))

    assert sum(weights.values()) == pytest.approx(1.0)


def obs(count: int, last: date = D, offset: float = 0.0) -> list[ScoreObs]:
    days = [last - timedelta(days=count - 1 - i) for i in range(count)]
    return [
        ScoreObs(day, 1.0, {"a": a, "b": 100.0 - a}, a + offset)
        for day, a in zip(days, [50.0 + 3 * (i % 9) for i in range(count)], strict=True)
    ]


def test_tuning_counts_the_entries_and_reports_quality_only_from_ten():
    learning, quality = tune_model(obs(5), ScoreModel(), entries=5)
    shown, shown_quality = tune_model(obs(12), ScoreModel(), entries=12)

    assert learning.entries == 5
    assert quality is None
    assert shown.entries == 12
    assert set(shown.weights) == {"a", "b"}
    assert shown_quality.n == 12
    assert shown_quality.unit == "body"
    # Before ten entries there was no estimate to compare with.
    assert shown_quality.previous_error is None


def test_tuning_compares_with_the_previous_weights_once_they_were_shown():
    previous = ScoreModel(entries=10, weights={"a": 0.5, "b": 0.5})

    _, quality = tune_model(obs(12), previous, entries=12)

    assert quality.previous_error == pytest.approx(fmean(abs(50.0 - o.truth) for o in obs(12)[-3:]))


def test_tuning_keeps_the_previous_weights_when_they_did_better_on_the_newest_days():
    perfect = ScoreModel(entries=10, weights={"a": 1.0, "b": 0.0})

    model, quality = tune_model(obs(12), perfect, entries=12)

    assert model.weights == {"a": 1.0, "b": 0.0}
    assert quality == Quality(12, 0.0, 0.0, "body")


# The weights file


def test_models_round_trip_and_default_when_the_file_is_missing(tmp_path):
    path = tmp_path / "score_weights.json"
    models = SamsungModels(
        sleep=ScoreModel(entries=12, weights={"duration": 0.6, "deep": 0.4}),
        energy=ScoreModel(entries=3),
    )

    assert load_models(path) == SamsungModels()
    save_models(path, models)

    assert load_models(path) == models
    assert samsung_scores.MIN_ENTRIES == 10
