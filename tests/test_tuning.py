from datetime import date, timedelta

import pytest

from owi import samsung_scores, tuning
from owi.calibration import Quality
from owi.entries import Entry
from owi.models import Params
from owi.samsung_scores import SamsungModels, ScoreModel
from owi.score_models import MALE, Person
from owi.store import FitRecord
from tests.factories import make_features, utc

TIMEZONE = "Europe/Bratislava"
D = date(2026, 10, 14)
NOW = utc(2026, 10, 16, 9, 30)
TEEN = Person(age=17, sex=MALE)
DEFAULTS = {"stride_m": 0.74, "active_hr_delta": 30.0, "kcal_scale": 1.0, "basal_kcal": None}


def record(**changes) -> FitRecord:
    values = {
        "fitted_at": NOW - timedelta(hours=1),
        "entries": 3,
        "entries_saved_at": "2026-10-16T08:00:00+00:00",
        "params": {},
        "quality": {},
    }
    values.update(changes)
    return FitRecord(**values)


# When


def test_a_fit_is_due_the_first_time_after_any_change_and_once_a_day():
    signature = (3, "2026-10-16T08:00:00+00:00")

    assert tuning.fit_due(None, signature, NOW)
    assert not tuning.fit_due(record(), signature, NOW)
    assert tuning.fit_due(record(), (4, "2026-10-16T09:00:00+00:00"), NOW)
    assert tuning.fit_due(record(), (3, "2026-10-16T09:00:00+00:00"), NOW)
    assert tuning.fit_due(record(fitted_at=NOW - timedelta(hours=24)), signature, NOW)


def test_a_recompute_is_due_when_the_days_were_computed_with_other_values():
    params = Params(stride_m=0.76)
    computed_with = tuning.estimate_params(params)
    stale = tuning.estimate_params(Params())

    assert not tuning.recompute_due(None, params, NOW)
    assert not tuning.recompute_due((computed_with, NOW - timedelta(days=3)), params, NOW)
    assert tuning.recompute_due((stale, None), params, NOW)
    assert tuning.recompute_due((stale, NOW - timedelta(hours=24)), params, NOW)
    # At most once in 24 hours; until then only the next syncs use the new values.
    assert not tuning.recompute_due((stale, NOW - timedelta(hours=23)), params, NOW)
    assert tuning.recompute_due((stale, NOW - timedelta(hours=23)), params, NOW, force=True)


def test_the_max_hr_is_not_an_estimate_parameter():
    assert tuning.estimate_params(Params(max_hr=190.0, basal_kcal=1700.0)) == {
        **DEFAULTS,
        "basal_kcal": 1700.0,
    }


# What the API says


def test_summary_without_entries():
    params = Params(stride_m=0.76, max_hr=190.0)

    assert tuning.summary(None, params) == {
        "fitted_at": None,
        "entries": 0,
        "params": {**DEFAULTS, "stride_m": 0.76},
        "defaults": DEFAULTS,
        "quality": {},
    }
    assert tuning.summary(record(entries=0), params)["fitted_at"] is None


def test_summary_after_a_fit():
    quality = {"distance_km": {"n": 3, "error": 4.1, "previous_error": 6.0, "unit": "%"}}

    summary = tuning.summary(record(quality=quality), Params(kcal_scale=0.9))

    assert summary == {
        "fitted_at": "2026-10-16T08:30:00+00:00",
        "entries": 3,
        "params": {**DEFAULTS, "kcal_scale": 0.9},
        "defaults": DEFAULTS,
        "quality": quality,
    }


def test_a_record_keeps_the_values_and_the_quality_as_json():
    result = tuning.Tuning(
        params=Params(stride_m=0.76, max_hr=190.0),
        models=SamsungModels(sleep=ScoreModel(10, {"duration": 1.0})),
        quality={"distance_km": Quality(3, 4.0, 6.0, "%")},
    )

    saved = tuning.record(result, (3, "2026-10-16T08:00:00+00:00"), NOW)

    assert saved.fitted_at == NOW
    assert (saved.entries, saved.entries_saved_at) == (3, "2026-10-16T08:00:00+00:00")
    assert saved.params["stride_m"] == 0.76
    assert saved.params["max_hr"] == 190.0
    assert saved.params["score_weights"]["samsung_sleep"] == {
        "entries": 10,
        "weights": {"duration": 1.0},
    }
    assert saved.quality == {
        "distance_km": {"n": 3, "error": 4.0, "previous_error": 6.0, "unit": "%"}
    }


# How


def features(count: int = 60, last: date = D):
    return [make_features(last - timedelta(days=count - 1 - i)) for i in range(count)]


def test_score_observations_are_the_entries_with_a_score_and_features_that_day():
    entries = [
        Entry(D, sleep_score=80.0, energy_score=70.0),
        Entry(D - timedelta(days=1), sleep_score=75.0),
        Entry(D - timedelta(days=100), sleep_score=60.0),  # no features stored that day
        Entry(D - timedelta(days=2), steps=1000),
    ]

    sleep, energy = tuning.score_observations(entries, features(), TEEN, TIMEZONE, D)

    assert [(o.day, o.truth) for o in sleep] == [(D - timedelta(days=1), 75.0), (D, 80.0)]
    assert [(o.day, o.truth) for o in energy] == [(D, 70.0)]
    history = features()
    expected_sleep, expected_energy = samsung_scores.day_parts(history, TEEN, TIMEZONE)
    assert sleep[1].parts == expected_sleep
    assert energy[0].parts == expected_energy
    assert sleep[1].weight == 1.0
    assert sleep[0].weight == pytest.approx(0.5 ** (1 / 60))


def test_run_tunes_the_estimates_and_both_scores():
    entries = [
        Entry(day.day, steps=10000, distance_km=8.0, sleep_score=80.0) for day in features(12)
    ]

    result = tuning.run(
        entries, {}, [], features(), TEEN, TIMEZONE, Params(max_hr=190.0), SamsungModels(), D
    )

    assert result.params.stride_m > 0.74
    assert result.params.max_hr == 190.0
    assert result.models.sleep.entries == 12
    assert result.models.energy == ScoreModel(0, None)
    assert set(result.quality) == {"distance_km", "sleep_score"}
    assert result.quality["sleep_score"].unit == "body"
