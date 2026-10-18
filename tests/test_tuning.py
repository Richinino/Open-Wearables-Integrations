from dataclasses import replace
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
        "signature": "d1",
    }
    values.update(changes)
    return FitRecord(**values)


def signature(entries: int = 3, digest: str = "d1") -> tuning.Signature:
    return tuning.Signature(entries, digest, "2026-10-16T08:00:00+00:00")


# When


def test_a_fit_is_due_the_first_time_after_any_change_and_once_a_day():
    assert tuning.fit_due(None, signature(), NOW)
    assert not tuning.fit_due(record(), signature(), NOW)
    assert tuning.fit_due(record(), signature(entries=4), NOW)
    assert tuning.fit_due(record(), signature(digest="d2"), NOW)
    # A fit from before the signatures.
    assert tuning.fit_due(record(signature=None), signature(), NOW)
    assert tuning.fit_due(record(fitted_at=NOW - timedelta(hours=24)), signature(), NOW)


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

    saved = tuning.record(result, signature(digest="d7"), NOW)

    assert saved.fitted_at == NOW
    assert (saved.entries, saved.entries_saved_at) == (3, "2026-10-16T08:00:00+00:00")
    assert saved.signature == "d7"
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


# Auto entries: what Samsung sends by itself


def days_back(count: int) -> date:
    return D - timedelta(days=count)


def test_auto_values_are_samsungs_numbers_within_the_entry_ranges():
    sent = make_features(
        D, samsung_steps=18230, samsung_active_kcal=960.0, samsung_sleep_score=84.0
    )
    # An early sync stored a distance as calories: out of range, so no value.
    broken = make_features(D, samsung_active_kcal=15000.0)

    assert tuning.auto_values(sent) == {"steps": 18230, "active_kcal": 960.0, "sleep_score": 84.0}
    assert tuning.auto_values(broken) == {"steps": None, "active_kcal": None, "sleep_score": None}


def test_the_api_shows_the_auto_values_or_null():
    assert tuning.auto_json(None) is None
    assert tuning.auto_json(make_features(D)) is None
    assert tuning.auto_json(make_features(D, samsung_sleep_score=81.0)) == {
        "steps": None,
        "active_kcal": None,
        "sleep_score": 81.0,
    }


def test_merge_lets_the_users_fields_win_and_fills_the_rest_from_samsung():
    saved = utc(2026, 10, 15, 8)
    manual = [
        Entry(days_back(2), steps=12000, distance_km=9.0, saved_at=saved),
        Entry(days_back(1), total_kcal=2600.0, saved_at=saved),
        Entry(days_back(30), energy_score=70.0, saved_at=saved),  # no features that day
    ]
    stored = [
        make_features(days_back(4)),  # nothing from Samsung
        make_features(days_back(3), samsung_steps=7000),
        make_features(
            days_back(2), samsung_steps=12500, samsung_active_kcal=900.0, samsung_sleep_score=85.0
        ),
        make_features(days_back(1), samsung_steps=8000, samsung_active_kcal=600.0),
        make_features(
            D,
            complete=False,
            samsung_steps=3000,
            samsung_active_kcal=200.0,
            samsung_sleep_score=78.0,
        ),
    ]

    merged = tuning.merge(manual, stored)

    assert merged == [
        Entry(days_back(30), energy_score=70.0, saved_at=saved),
        Entry(days_back(3), steps=7000),
        Entry(
            days_back(2),
            steps=12000,
            distance_km=9.0,
            active_kcal=900.0,
            sleep_score=85.0,
            saved_at=saved,
        ),
        Entry(days_back(1), steps=8000, active_kcal=600.0, total_kcal=2600.0, saved_at=saved),
        # A day still running gives only its Sleep Score: the night is over, the steps are not.
        Entry(D, sleep_score=78.0),
    ]


def test_the_signature_changes_with_every_value_the_fit_sees():
    merged = [
        Entry(days_back(1), steps=8000, saved_at=utc(2026, 10, 15, 8)),
        Entry(D, sleep_score=78.0),
    ]

    first = tuning.signature(merged)

    assert (first.entries, first.saved_at) == (2, "2026-10-15T08:00:00+00:00")
    assert tuning.signature(list(merged)) == first
    assert tuning.signature([merged[0], Entry(D, sleep_score=79.0)]).digest != first.digest
    assert tuning.signature(merged[:1]).entries == 1
    assert tuning.signature([]) == tuning.Signature(0, tuning.signature([]).digest, None)
    # Saving the same numbers again asks for no new fit.
    resaved = replace(merged[0], saved_at=utc(2026, 10, 16, 8))
    assert tuning.signature([resaved, merged[1]]).digest == first.digest


def test_reference_days_are_the_users_heart_entries_and_four_weeks_of_samsung_calories():
    manual = [
        Entry(days_back(100), active_minutes=200.0),
        Entry(days_back(90), total_kcal=2500.0),
        Entry(days_back(80), steps=9000),
        Entry(days_back(70), active_kcal=900.0),
    ]
    merged = [
        *manual,
        Entry(days_back(40), active_kcal=700.0),
        Entry(days_back(27), active_kcal=650.0),
        Entry(days_back(2), sleep_score=80.0),
        Entry(days_back(1), active_kcal=600.0),
    ]

    assert tuning.reference_days(manual, merged, D) == [
        days_back(100),
        days_back(90),
        days_back(70),
        days_back(27),
        days_back(1),
    ]


def test_the_samsung_sleep_estimate_learns_from_samsungs_own_scores():
    history = [
        replace(f, samsung_sleep_score=78.0 + index % 7) for index, f in enumerate(features(60))
    ]

    result = tuning.run(
        tuning.merge([], history),
        {},
        [],
        history,
        TEEN,
        TIMEZONE,
        Params(max_hr=190.0),
        SamsungModels(),
        D,
    )

    assert result.models.sleep.entries == 60
    assert result.quality["sleep_score"].n == 60
