import math
from datetime import timedelta

import pytest

from owi.load import (
    STRENGTH_TYPES,
    YOGA_TYPES,
    cardio_load,
    hr_reserve,
    strain_from_load,
    strain_load,
    trimp,
)
from owi.score_models import FEMALE, MALE, CardioLoad
from tests.factories import utc, workout

START = utc(2026, 10, 12, 8)
REST = 50.0
MAX = 190.0


def hr_at(reserve: float) -> float:
    return REST + reserve * (MAX - REST)


def series(values: list[float], start=START) -> dict:
    return {start + timedelta(minutes=i): value for i, value in enumerate(values)}


def never_asleep(minute) -> bool:
    return False


def test_hr_reserve_is_the_share_of_the_reserve_in_use():
    assert hr_reserve(120.0, REST, MAX) == pytest.approx(0.5)


def test_hr_reserve_is_clamped_to_zero_and_one():
    assert hr_reserve(40.0, REST, MAX) == 0.0
    assert hr_reserve(200.0, REST, MAX) == 1.0


def test_hr_reserve_without_a_reserve_is_zero():
    assert hr_reserve(120.0, 60.0, 60.0) == 0.0
    assert hr_reserve(120.0, 70.0, 60.0) == 0.0


def test_trimp_for_a_male_hour_at_sixty_percent_is_about_73():
    minute_hr = series([hr_at(0.6)] * 60)

    value = trimp(minute_hr, REST, MAX, MALE)

    assert value == pytest.approx(60 * 0.6 * 0.64 * math.exp(1.92 * 0.6))
    assert value == pytest.approx(73, abs=0.5)


def test_trimp_uses_female_constants():
    minute_hr = series([hr_at(0.6)] * 60)

    assert trimp(minute_hr, REST, MAX, FEMALE) == pytest.approx(
        60 * 0.6 * 0.86 * math.exp(1.67 * 0.6)
    )


def test_trimp_without_sex_uses_male_constants():
    minute_hr = series([hr_at(0.7)] * 10)

    assert trimp(minute_hr, REST, MAX, None) == trimp(minute_hr, REST, MAX, MALE)


def test_trimp_skips_minutes_below_thirty_percent_of_reserve():
    assert trimp(series([hr_at(0.29)] * 60), REST, MAX, MALE) == 0.0
    assert trimp(series([hr_at(0.3)]), REST, MAX, MALE) == pytest.approx(
        0.3 * 0.64 * math.exp(1.92 * 0.3)
    )


def test_trimp_counts_only_the_given_minutes():
    minute_hr = series([hr_at(0.6)] * 10)
    first_three = set(list(minute_hr)[:3])

    assert trimp(minute_hr, REST, MAX, MALE, minutes=first_three) == pytest.approx(
        3 * 0.6 * 0.64 * math.exp(1.92 * 0.6)
    )


def test_strain_load_weights_awake_minutes_from_a_quarter_of_reserve():
    minute_hr = series([hr_at(0.24)] * 30 + [hr_at(0.5)] * 20)

    value = strain_load(minute_hr, REST, MAX, MALE, never_asleep, [])

    assert value == pytest.approx(20 * 0.5 * math.exp(1.92 * 0.5))


def test_strain_load_uses_the_female_exponent():
    minute_hr = series([hr_at(0.5)] * 20)

    value = strain_load(minute_hr, REST, MAX, FEMALE, never_asleep, [])

    assert value == pytest.approx(20 * 0.5 * math.exp(1.67 * 0.5))


def test_strain_load_skips_minutes_asleep():
    minute_hr = series([hr_at(0.5)] * 20)
    asleep_until = START + timedelta(minutes=15)

    value = strain_load(minute_hr, REST, MAX, MALE, lambda minute: minute < asleep_until, [])

    assert value == pytest.approx(5 * 0.5 * math.exp(1.92 * 0.5))


def test_strain_load_counts_only_minutes_inside_the_window():
    minute_hr = series([hr_at(0.5)] * 20)
    window = (START + timedelta(minutes=5), START + timedelta(minutes=15))

    value = strain_load(minute_hr, REST, MAX, MALE, never_asleep, [], window)

    assert value == pytest.approx(10 * 0.5 * math.exp(1.92 * 0.5))


def test_strain_load_adds_muscular_load_by_workout_type():
    workouts = [
        workout("lift", START, 40, type_="strength_training"),
        workout("yoga", START + timedelta(hours=1), 30, type_="yoga"),
        workout("run", START + timedelta(hours=2), 30, type_="running"),
    ]

    value = strain_load({}, REST, MAX, MALE, never_asleep, workouts)

    assert value == pytest.approx(0.6 * 40 + 0.3 * 30)


def test_strain_load_clips_workouts_to_the_window():
    workouts = [
        workout("lift", START - timedelta(minutes=30), 60, type_="strength_training"),
        workout("later", START + timedelta(hours=3), 60, type_="strength_training"),
    ]
    window = (START, START + timedelta(hours=1))

    value = strain_load({}, REST, MAX, MALE, never_asleep, workouts, window)

    assert value == pytest.approx(0.6 * 30)


def test_workout_type_sets_use_open_wearables_names():
    assert STRENGTH_TYPES == frozenset({"strength_training", "cardio_training"})
    assert YOGA_TYPES == frozenset({"yoga", "pilates", "stretching"})


def test_strain_from_load_is_logarithmic():
    assert strain_from_load(50.0, MALE) == pytest.approx(4.05 * math.log(1 + 50.0 / 10.3))
    assert strain_from_load(50.0, FEMALE) == pytest.approx(4.45 * math.log(1 + 50.0 / 11.4))
    assert strain_from_load(50.0, None) == strain_from_load(50.0, MALE)


def test_strain_from_load_is_capped_at_21():
    assert strain_from_load(1e9, MALE) == 21.0


@pytest.mark.parametrize("value", [0.0, -5.0])
def test_strain_from_load_without_load_is_zero(value):
    assert strain_from_load(value, MALE) == 0.0


def test_cardio_load_needs_28_days():
    assert cardio_load([100.0] * 27, False) == CardioLoad(None, None, None, None)


def test_cardio_load_needs_three_days_with_load_in_the_last_28():
    assert cardio_load([0.0] * 26 + [100.0] * 2, False) == CardioLoad(None, None, None, None)
    assert cardio_load([0.0] * 25 + [100.0] * 3, False).status is not None


def test_cardio_load_leaves_unmeasured_days_out_of_the_means():
    daily = [None] * 7 + [50.0] * 14 + [100.0] * 3 + [None] * 2 + [100.0] * 2

    result = cardio_load(daily, False)

    assert result.strain_7d == pytest.approx(100.0)
    assert result.tolerance_28d == pytest.approx((14 * 50.0 + 5 * 100.0) / 19)
    assert result.status == "overreaching"


def test_cardio_load_needs_half_of_each_window_measured():
    empty = CardioLoad(None, None, None, None)

    assert cardio_load([100.0] * 21 + [None] * 4 + [100.0] * 3, False) == empty
    assert cardio_load([None] * 15 + [100.0] * 13, False) == empty
    assert cardio_load([None] * 14 + [100.0] * 14, False).status == "productive"


def test_measured_days_without_load_still_count():
    result = cardio_load([0.0] * 14 + [100.0] * 14, False)

    assert result.tolerance_28d == pytest.approx(50.0)
    assert result.status == "overreaching"


def test_cardio_load_uses_only_the_last_28_days():
    assert cardio_load([1000.0] * 10 + [100.0] * 28, False) == cardio_load([100.0] * 28, False)


@pytest.mark.parametrize(
    ("base", "recent", "status"),
    [
        (100.0, 50.0, "detraining"),
        (100.0, 75.0, "maintaining"),  # ratio exactly 0.8
        (100.0, 90.0, "maintaining"),
        (100.0, 100.0, "productive"),  # ratio exactly 1.0
        (90.0, 130.0, "productive"),  # ratio exactly 1.3
        (90.0, 131.0, "overreaching"),
    ],
)
def test_cardio_load_status_follows_the_ratio(base, recent, status):
    result = cardio_load([base] * 21 + [recent] * 7, False)

    assert result.strain_7d == pytest.approx(recent)
    assert result.tolerance_28d == pytest.approx((21 * base + 7 * recent) / 28)
    assert result.ratio == pytest.approx(result.strain_7d / result.tolerance_28d)
    assert result.status == status


def test_low_ratio_after_overreaching_is_recovering():
    assert cardio_load([100.0] * 21 + [50.0] * 7, True).status == "recovering"
