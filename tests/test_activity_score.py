from dataclasses import replace
from datetime import date, timedelta

import pytest

from owi.activity_score import (
    activity_score,
    daily_target_kcal,
    daily_targets_score,
    move_every_hour_score,
    recovery_time_score,
    stay_active_score,
    training_frequency_score,
    training_volume_score,
)
from owi.score_models import DayFeatures, Person

D = date(2026, 10, 14)
PERSON = Person(age=35, weight_kg=70.0)  # daily target 5.5 * 70 = 385 kcal
WEIGHTS = {
    "meet_daily_targets": 0.25,
    "stay_active": 0.20,
    "training_volume": 0.15,
    "training_frequency": 0.15,
    "move_every_hour": 0.10,
    "recovery_time": 0.15,
}


def days_before(last: date, count: int) -> list[date]:
    """`count` consecutive days ending on `last`, oldest first."""
    return [last - timedelta(days=count - 1 - i) for i in range(count)]


def make_day(day: date = D, **fields: object) -> DayFeatures:
    values: dict[str, object] = {
        "complete": True,
        "wear_minutes": 1440,
        "resting_hr": None,
        "sleep_rhr": None,
        "sleep_hr_low_at": None,
        "night_hr": None,
        "max_hr_seen": None,
        "trimp": None,
        "strain_load": None,
        "strain": None,
    }
    values.update(fields)
    return DayFeatures(day=day, **values)  # type: ignore[arg-type]


def active_day(day: date, **fields: object) -> DayFeatures:
    """Target met, a 30-minute run (over 100 MET-minutes) and an easy-day intensity profile."""
    values: dict[str, object] = {
        "active_kcal": 400.0,
        "inactive_hours": 5.0,
        "long_inactive_bouts": 0,
        "met_minutes_medium": 60.0,
        "met_minutes_high": 240.0,
        "medium_minutes": 15,
        "high_minutes": 30,
    }
    values.update(fields)
    return make_day(day, **values)


def week(count: int = 7, **fields: object) -> list[DayFeatures]:
    return [active_day(day, **fields) for day in days_before(D, count)]


def with_day(history: list[DayFeatures], day: date, **fields: object) -> list[DayFeatures]:
    return [replace(item, **fields) if item.day == day else item for item in history]


def expected_value(components: dict[str, float | None]) -> float:
    available = {k: v for k, v in components.items() if v is not None}
    total = sum(WEIGHTS[k] for k in available)
    return sum(WEIGHTS[k] * v for k, v in available.items()) / total


# Contributor curves (docs/skore.md section 2)


def test_stay_active_score_is_linear_between_the_anchor_hours():
    assert stay_active_score(3.0) == 100.0
    assert stay_active_score(5.0) == 100.0
    assert stay_active_score(6.5) == pytest.approx(92.5)
    assert stay_active_score(8.0) == pytest.approx(85.0)
    assert stay_active_score(12.0) == pytest.approx(59.0)
    assert stay_active_score(14.0) == pytest.approx(29.5)
    assert stay_active_score(16.0) == 0.0
    assert stay_active_score(20.0) == 0.0


def test_move_every_hour_loses_ten_points_per_long_inactive_bout():
    assert move_every_hour_score(0) == 100.0
    assert move_every_hour_score(3) == 70.0
    assert move_every_hour_score(12) == 0.0


@pytest.mark.parametrize(
    ("days", "expected"),
    [(7, 100), (6, 95), (5, 80), (4, 65), (3, 50), (2, 30), (1, 15), (0, 0)],
)
def test_daily_targets_score_by_days_met(days, expected):
    assert daily_targets_score(days) == expected


@pytest.mark.parametrize(
    ("days", "expected"), [(6, 100), (4, 100), (3, 90), (2, 70), (1, 50), (0, 30)]
)
def test_training_frequency_score_by_training_days(days, expected):
    assert training_frequency_score(days) == expected


def test_training_volume_score_by_weekly_met_minutes():
    assert training_volume_score(2500.0) == 100.0
    assert training_volume_score(2000.0) == pytest.approx(100.0)
    assert training_volume_score(1375.0) == pytest.approx(92.5)
    assert training_volume_score(750.0) == pytest.approx(85.0)
    assert training_volume_score(375.0) == pytest.approx(42.5)
    assert training_volume_score(0.0) == 0.0


def test_recovery_time_score_by_days_since_the_last_easy_day():
    assert recovery_time_score(0) == 100.0
    assert recovery_time_score(5) == 100.0
    assert recovery_time_score(6) == 95.0
    assert recovery_time_score(None) == 40.0


def test_daily_target_is_5_5_kcal_per_kg_adjusted_by_readiness():
    assert daily_target_kcal(70.0, None) == pytest.approx(385.0)
    assert daily_target_kcal(70.0, 75.0) == pytest.approx(385.0)
    assert daily_target_kcal(70.0, 70.0) == pytest.approx(385.0)
    assert daily_target_kcal(70.0, 85.0) == pytest.approx(385.0 * 1.15)
    assert daily_target_kcal(70.0, 69.9) == pytest.approx(385.0 * 0.85)
    assert daily_target_kcal(None, 90.0) is None


# activity_score()


def test_a_full_active_week_scores_every_contributor():
    score = activity_score(week(), PERSON, readiness=75.0)

    assert score.components == {
        "meet_daily_targets": 100.0,
        "stay_active": 100.0,
        "training_volume": 100.0,
        "training_frequency": 100.0,
        "move_every_hour": 100.0,
        "recovery_time": 40.0,
    }
    assert score.value == pytest.approx(expected_value(score.components), abs=0.05)
    assert score.note is None


def test_high_readiness_raises_todays_target():
    # 400 kcal meets 385 but not 385 * 1.15; earlier days keep the plain target.
    assert activity_score(week(), PERSON, 84.9).components["meet_daily_targets"] == 100.0
    assert activity_score(week(), PERSON, 85.0).components["meet_daily_targets"] == 95.0


def test_low_readiness_lowers_todays_target():
    history = with_day(week(), D, active_kcal=330.0)

    assert activity_score(history, PERSON, 75.0).components["meet_daily_targets"] == 95.0
    assert activity_score(history, PERSON, 65.0).components["meet_daily_targets"] == 100.0


def test_days_missing_from_the_last_week_count_as_targets_not_met():
    score = activity_score(week(count=5), PERSON, 75.0)

    assert score.components["meet_daily_targets"] == 80.0


def test_days_before_the_last_week_do_not_count():
    old = [active_day(day) for day in days_before(D - timedelta(days=7), 10)]
    history = [*old, *week(count=3)]

    assert activity_score(history, PERSON, 75.0).components["meet_daily_targets"] == 50.0


def test_target_weight_falls_back_to_the_days_weight():
    light = with_day(week(), D, weight_kg=72.0)  # 396 kcal: 400 meets it every day
    heavy = with_day(week(), D, weight_kg=80.0)  # 440 kcal: 400 never does

    assert activity_score(light, Person(age=35), 75.0).components["meet_daily_targets"] == 100
    assert activity_score(heavy, Person(age=35), 75.0).components["meet_daily_targets"] == 0


def test_without_any_weight_targets_are_left_out_and_the_rest_renormalised():
    score = activity_score(week(), Person(age=35), 75.0)

    assert score.components["meet_daily_targets"] is None
    assert score.value == pytest.approx(expected_value(score.components), abs=0.05)
    assert score.note == "without meet_daily_targets"


def test_stay_active_and_move_every_hour_come_from_today():
    history = with_day(week(), D, inactive_hours=12.0, long_inactive_bouts=4)

    score = activity_score(history, PERSON, 75.0)

    assert score.components["stay_active"] == pytest.approx(59.0)
    assert score.components["move_every_hour"] == 60.0


def test_training_frequency_counts_days_with_100_medium_and_high_met_minutes():
    light = {"met_minutes_medium": 60.0, "met_minutes_high": 39.0}
    history = week()
    for offset in (1, 2, 3, 4):
        history = with_day(history, D - timedelta(days=offset), **light)

    assert activity_score(history, PERSON, 75.0).components["training_frequency"] == 90.0


def test_training_volume_sums_the_last_seven_days():
    history = week(met_minutes_medium=100.0, met_minutes_high=100.0)  # 1400 a week

    score = activity_score(history, PERSON, 75.0)

    assert score.components["training_volume"] == pytest.approx(85 + 15 * (1400 - 750) / 1250)


def test_recovery_time_is_full_with_a_recent_easy_day():
    easy = {"medium_minutes": 60, "high_minutes": 15}
    history = with_day(week(), D - timedelta(days=2), **easy)

    assert activity_score(history, PERSON, 75.0).components["recovery_time"] == 100.0


def test_recovery_time_drops_when_the_only_easy_day_was_six_days_ago():
    history = with_day(week(), D - timedelta(days=6), medium_minutes=0, high_minutes=0)

    assert activity_score(history, PERSON, 75.0).components["recovery_time"] == 95.0


def test_an_easy_day_allows_at_most_85_medium_and_high_minutes():
    history = with_day(week(), D, medium_minutes=71, high_minutes=15)

    assert activity_score(history, PERSON, 75.0).components["recovery_time"] == 40.0


def test_missing_today_values_are_left_out_and_the_rest_renormalised():
    history = with_day(week(), D, inactive_hours=None, long_inactive_bouts=None)

    score = activity_score(history, PERSON, 75.0)

    assert score.components["stay_active"] is None
    assert score.components["move_every_hour"] is None
    assert score.value == pytest.approx(expected_value(score.components), abs=0.05)
    assert score.note == "without stay_active, move_every_hour"


def test_no_activity_data_gives_no_score():
    score = activity_score([make_day(D)], PERSON, 75.0)

    assert score.value is None
    assert score.note == "no data"
    assert all(value is None for value in score.components.values())


def test_empty_history_gives_no_score():
    assert activity_score([], PERSON, 75.0).value is None
