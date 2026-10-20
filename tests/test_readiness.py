from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta

import pytest

from owi.models import SleepInterval
from owi.readiness import (
    activity_balance_score,
    night_signal,
    previous_day_activity_score,
    readiness,
    recovery_index_score,
    resting_hr_score,
    sleep_balance_score,
    sleep_regularity_score,
    sleep_score,
)
from owi.score_models import DayFeatures, Person

D = date(2026, 10, 14)
ADULT = Person(age=35)
WEIGHTS = {
    "sleep": 0.25,
    "resting_hr": 0.20,
    "activity_balance": 0.15,
    "sleep_balance": 0.11,
    "previous_day_activity": 0.11,
    "recovery_index": 0.10,
    "sleep_regularity": 0.05,
}


def at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=UTC)


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


def steady_day(day: date, **fields: object) -> DayFeatures:
    """A typical day: 8 h sleep ending 07:00, heart-rate low at 02:00, ordinary activity."""
    values: dict[str, object] = {
        "sleep_rhr": 52.0,
        "sleep_minutes": 480.0,
        "sleep_start": at(day - timedelta(days=1), 23),
        "sleep_end": at(day, 7),
        "sleep_hr_low_at": at(day, 2),
        "active_kcal": 400.0,
        "met_minutes_high": 50.0,
        "inactive_hours": 10.0,
    }
    values.update(fields)
    return make_day(day, **values)


def steady_history(count: int = 31, **fields: object) -> list[DayFeatures]:
    return [steady_day(day, **fields) for day in days_before(D, count)]


def with_day(history: list[DayFeatures], day: date, **fields: object) -> list[DayFeatures]:
    return [replace(item, **fields) if item.day == day else item for item in history]


def expected_value(components: dict[str, float | None]) -> float:
    available = {k: v for k, v in components.items() if v is not None}
    total = sum(WEIGHTS[k] for k in available)
    return sum(WEIGHTS[k] * v for k, v in available.items()) / total


# Contributor curves (Oura patent US10842429B2, docs/skore.md section 4)


def test_sleep_score_is_85_at_85_percent_of_nine_hours():
    assert sleep_score(459.0) == pytest.approx(85.0)
    assert sleep_score(420.0) == pytest.approx(85 + 12.5 * (100 * 420 / 540 - 85) / 7.5)
    assert sleep_score(540.0) == 100.0
    assert sleep_score(0.0) == 0.0


def test_resting_hr_score_follows_the_two_part_curve():
    assert resting_hr_score(0.0) == pytest.approx(87.5)
    assert resting_hr_score(1.0) == pytest.approx(57.5)
    assert resting_hr_score(-3.5) == pytest.approx(60.0)
    assert resting_hr_score(-1.0) == pytest.approx(100.0)
    assert resting_hr_score(-0.5) == 100.0
    assert resting_hr_score(-6.0) == pytest.approx(20.0)
    assert resting_hr_score(3.0) == 0.0


def test_activity_balance_score_peaks_a_quarter_sd_below_the_long_term_mean():
    assert activity_balance_score(-0.25) == pytest.approx(100.0)
    assert activity_balance_score(0.0) == pytest.approx(85.0)
    assert activity_balance_score(1.0) == pytest.approx(25.0)
    assert activity_balance_score(-1.25) == pytest.approx(40.0)
    assert activity_balance_score(2.0) == 0.0


def test_sleep_balance_score_scales_with_balance_over_sd():
    assert sleep_balance_score(0.0, 30.0) == pytest.approx(85.0)
    assert sleep_balance_score(-30.0, 30.0) == pytest.approx(55.0)
    assert sleep_balance_score(15.0, 30.0) == 100.0


def test_previous_day_activity_score_falls_with_the_summed_z_scores():
    assert previous_day_activity_score(0.0) == pytest.approx(85.0)
    assert previous_day_activity_score(2.5) == pytest.approx(70.0)
    assert previous_day_activity_score(-5.0) == 100.0
    assert previous_day_activity_score(20.0) == 0.0


def test_recovery_index_score_is_85_at_five_hours_after_the_low():
    assert recovery_index_score(5.0) == pytest.approx(85.0)
    assert recovery_index_score(6.0) == pytest.approx(100.0)
    assert recovery_index_score(4.0) == pytest.approx(70.0)
    assert recovery_index_score(0.0) == pytest.approx(10.0)
    assert recovery_index_score(8.0) == 100.0


def test_sleep_regularity_score_is_full_from_sri_85():
    assert sleep_regularity_score(90.0) == 100.0
    assert sleep_regularity_score(85.0) == 100.0
    assert sleep_regularity_score(75.0) == pytest.approx(80.0)
    assert sleep_regularity_score(30.0) == 0.0


# readiness()


def test_steady_history_scores_every_contributor_and_is_marked_estimate():
    score = readiness(steady_history(), ADULT, sleep_regularity=90.0)

    assert score.note == "estimate"
    assert set(score.components) == set(WEIGHTS)
    assert score.components["sleep"] == pytest.approx(sleep_score(480.0))
    assert score.components["resting_hr"] == pytest.approx(87.5)
    assert score.components["activity_balance"] == pytest.approx(85.0)
    assert score.components["sleep_balance"] == pytest.approx(85.0)
    assert score.components["previous_day_activity"] == pytest.approx(85.0)
    assert score.components["recovery_index"] == pytest.approx(85.0)
    assert score.components["sleep_regularity"] == 100.0
    assert score.value == pytest.approx(expected_value(score.components), abs=0.05)


def test_missing_contributors_are_left_out_and_the_weights_renormalised():
    history = with_day(steady_history(), D, sleep_rhr=None, sleep_hr_low_at=None)

    score = readiness(history, ADULT, sleep_regularity=None)

    assert score.components["resting_hr"] is None
    assert score.components["recovery_index"] is None
    assert score.components["sleep_regularity"] is None
    assert score.value == pytest.approx(expected_value(score.components), abs=0.05)
    assert score.note == "estimate"


def test_under_14_earlier_nights_with_sleep_rhr_gives_no_score_but_keeps_components():
    short = readiness(steady_history(count=14), ADULT, sleep_regularity=90.0)
    enough = readiness(steady_history(count=15), ADULT, sleep_regularity=90.0)

    assert short.value is None
    assert short.note == "too little history"
    assert short.components["sleep"] == pytest.approx(sleep_score(480.0))
    assert short.components["resting_hr"] == pytest.approx(87.5)
    assert enough.value is not None


def test_empty_history_has_no_score():
    score = readiness([], ADULT, sleep_regularity=None)

    assert score.value is None
    assert score.note == "too little history"


def test_no_main_sleep_last_night_gives_no_score_but_keeps_components():
    # Oura computes readiness after the night; the day-only contributors alone are no score.
    history = with_day(
        steady_history(),
        D,
        sleep_rhr=None,
        sleep_minutes=None,
        sleep_start=None,
        sleep_end=None,
        sleep_hr_low_at=None,
        nap_minutes=40.0,
    )

    score = readiness(history, ADULT, sleep_regularity=90.0)

    assert score.value is None
    assert score.note == "no sleep recorded"
    assert score.components["sleep"] is None
    assert score.components["previous_day_activity"] == pytest.approx(85.0)


def test_resting_hr_z_uses_the_60_nights_before_d():
    # 30 earlier nights alternating 48 and 56 bpm: mean 52, SD 4.
    history = [
        steady_day(day, sleep_rhr=48.0 if i % 2 else 56.0)
        for i, day in enumerate(days_before(D - timedelta(days=1), 30))
    ]

    one_sd_up = readiness([*history, steady_day(D, sleep_rhr=56.0)], ADULT, None)
    far_below = readiness([*history, steady_day(D, sleep_rhr=38.0)], ADULT, None)

    assert one_sd_up.components["resting_hr"] == pytest.approx(57.5)
    assert far_below.components["resting_hr"] == pytest.approx(60.0)


def test_resting_hr_sd_has_a_2_bpm_floor():
    history = with_day(steady_history(), D, sleep_rhr=54.0)

    assert readiness(history, ADULT, None).components["resting_hr"] == pytest.approx(57.5)


def test_nights_older_than_60_days_are_not_in_the_resting_hr_baseline():
    old = [steady_day(day, sleep_rhr=80.0) for day in days_before(D - timedelta(days=61), 30)]
    history = [*old, *with_day(steady_history(), D, sleep_rhr=54.0)]

    assert readiness(history, ADULT, None).components["resting_hr"] == pytest.approx(57.5)


def test_sleep_contributor_counts_naps():
    history = with_day(steady_history(), D, sleep_minutes=420.0, nap_minutes=39.0)

    assert readiness(history, ADULT, None).components["sleep"] == pytest.approx(85.0)


def test_sleep_balance_need_is_at_least_seven_hours_and_sd_at_least_25_minutes():
    # Everyone sleeps 400 min: need clamps to 420, SD of 0 clamps to 25.
    score = readiness(steady_history(sleep_minutes=400.0), ADULT, None)

    assert score.components["sleep_balance"] == pytest.approx(85 + 30 * -20 / 25)


def test_teen_sleep_need_is_at_least_eight_hours():
    history = steady_history(sleep_minutes=450.0)

    adult = readiness(history, ADULT, None)
    teen = readiness(history, Person(age=16), None)

    assert adult.components["sleep_balance"] == pytest.approx(85.0)
    assert teen.components["sleep_balance"] == pytest.approx(85 + 30 * -30 / 25)


def test_sleep_balance_weights_recent_nights_by_0_9_per_night():
    history = with_day(steady_history(), D, sleep_minutes=380.0)
    weight_sum = sum(0.9**i for i in range(14))

    score = readiness(history, ADULT, None)

    assert score.components["sleep_balance"] == pytest.approx(85 + 30 * (-100 / weight_sum) / 25)


def test_a_recent_sleep_deficit_weighs_more_than_an_older_one():
    recent = with_day(steady_history(), D - timedelta(days=1), sleep_minutes=300.0)
    older = with_day(steady_history(), D - timedelta(days=12), sleep_minutes=300.0)

    recent_score = readiness(recent, ADULT, None).components["sleep_balance"]
    older_score = readiness(older, ADULT, None).components["sleep_balance"]

    assert recent_score < older_score < 85.0


def test_previous_day_activity_uses_z_scores_of_yesterday():
    # Baseline kcal is flat, so the SD floor of 50 kcal applies: +100 kcal is z = 2.
    history = with_day(steady_history(), D - timedelta(days=1), active_kcal=500.0)

    assert readiness(history, ADULT, None).components["previous_day_activity"] == pytest.approx(73)


def test_previous_day_activity_counts_inactive_hours_against_readiness():
    history = with_day(steady_history(), D - timedelta(days=1), inactive_hours=11.0)

    assert readiness(history, ADULT, None).components["previous_day_activity"] == pytest.approx(73)


def test_previous_day_activity_needs_yesterday():
    history = [item for item in steady_history() if item.day != D - timedelta(days=1)]

    assert readiness(history, ADULT, None).components["previous_day_activity"] is None


def test_days_worn_under_1000_minutes_are_left_out_of_activity_comparisons():
    low_wear = {D - timedelta(days=n) for n in range(31, 41)}
    history = [
        replace(item, wear_minutes=600, active_kcal=50.0) if item.day in low_wear else item
        for item in steady_history(count=61)
    ]

    score = readiness(history, ADULT, None)

    assert score.components["previous_day_activity"] == pytest.approx(85.0)
    assert score.components["activity_balance"] == pytest.approx(85.0)


def test_activity_balance_drops_when_the_last_two_weeks_were_harder():
    recent = {D - timedelta(days=n) for n in range(1, 15)}
    harder = [
        replace(item, active_kcal=600.0) if item.day in recent else item
        for item in steady_history(count=61)
    ]
    easier = [
        replace(item, active_kcal=380.0) if item.day in recent else item
        for item in steady_history(count=61)
    ]

    assert readiness(harder, ADULT, None).components["activity_balance"] < 85.0
    assert readiness(easier, ADULT, None).components["activity_balance"] > 85.0


def test_recovery_index_counts_hours_from_the_heart_rate_low_to_waking():
    early_low = with_day(steady_history(), D, sleep_hr_low_at=at(D, 1))
    late_low = with_day(steady_history(), D, sleep_hr_low_at=at(D, 3))

    assert readiness(early_low, ADULT, None).components["recovery_index"] == pytest.approx(100.0)
    assert readiness(late_low, ADULT, None).components["recovery_index"] == pytest.approx(70.0)


def test_recovery_index_leaves_out_time_awake_after_the_low():
    awake = SleepInterval(at(D, 4), at(D, 4, 30), "awake")
    history = with_day(steady_history(), D, sleep_intervals=(awake,))

    assert readiness(history, ADULT, None).components["recovery_index"] == pytest.approx(77.5)


def test_sleep_regularity_contributor_comes_from_the_given_sri():
    score = readiness(steady_history(), ADULT, sleep_regularity=75.0)

    assert score.components["sleep_regularity"] == pytest.approx(80.0)


@pytest.mark.parametrize("kind", ["rmssd", "sdnn"])
def test_hrv_uses_same_metric_previous_60_days_and_exact_twelve_percent_weight(kind):
    # Last 30 earlier nights have mean 40, population SD 5. Older history and the
    # other metric must not skew the personal baseline.
    earlier = [
        steady_day(day, hrv_ms=35.0 if i % 2 else 45.0, hrv_kind=kind)
        for i, day in enumerate(days_before(D - timedelta(days=1), 30))
    ]
    old = steady_day(D - timedelta(days=61), hrv_ms=1000, hrv_kind=kind)
    today = steady_day(D, hrv_ms=35, hrv_kind=kind, sleep_hr_low_at=None)
    legacy = readiness([old, *earlier, replace(today, hrv_ms=None)], ADULT, None)
    scored = readiness([old, *earlier, today], ADULT, None)
    assert scored.components["hrv_balance"] == pytest.approx(resting_hr_score(1))
    assert scored.value == pytest.approx(
        0.88 * expected_value(legacy.components) + 0.12 * 57.5, abs=0.05
    )
    assert scored.note == "estimate"


def test_hrv_constant_baseline_uses_one_ms_floor():
    history = steady_history(hrv_ms=40.0, hrv_kind="sdnn")
    low = readiness(with_day(history, D, hrv_ms=39), ADULT, None)
    high = readiness(with_day(history, D, hrv_ms=41), ADULT, None)
    assert low.components["hrv_balance"] == pytest.approx(57.5)
    assert high.components["hrv_balance"] == 100
    assert readiness(history, ADULT, None).components["hrv_balance"] == 87.5


@pytest.mark.parametrize("value", [None, 0, -1, float("nan"), float("inf")])
def test_unusable_hrv_keeps_legacy_readiness_identical(value):
    history = steady_history(hrv_ms=40.0, hrv_kind="rmssd")
    actual = readiness(with_day(history, D, hrv_ms=value), ADULT, 85)
    legacy = readiness(steady_history(), ADULT, 85)
    assert actual == legacy


def test_hrv_history_does_not_mix_rmssd_and_sdnn_or_use_today_in_baseline():
    history = steady_history(hrv_ms=40.0, hrv_kind="rmssd")
    mixed = with_day(history, D, hrv_ms=40, hrv_kind="sdnn")
    assert readiness(mixed, ADULT, None) == readiness(steady_history(), ADULT, None)
    # Six same-kind earlier nights plus today are still too few for a seven-night baseline.
    for index in range(1, 7):
        mixed = with_day(mixed, D - timedelta(days=index), hrv_ms=40, hrv_kind="sdnn")
    assert "hrv_balance" not in readiness(mixed, ADULT, None).components
    mixed = with_day(mixed, D - timedelta(days=7), hrv_ms=40, hrv_kind="sdnn")
    assert readiness(mixed, ADULT, None).components["hrv_balance"] == 87.5


def test_hrv_survives_stored_features_and_rescore(tmp_path):
    from owi.scoring import rescore
    from owi.store import Store

    history = steady_history(hrv_ms=40, hrv_kind="sdnn")
    history = with_day(history, D, hrv_ms=39)
    with Store(tmp_path / "synthetic.db") as store:
        for day in history:
            store.save_features(day)
        assert store.get_features(D).hrv_kind == "sdnn"
        rescore(store, history[0].day, D, ADULT, "UTC")
        scored = store.get_scores(D).readiness
        assert scored.components["hrv_balance"] == 57.5
        assert scored.note == "estimate"


# night_signal()


def nights(values: list[float], last: date = D) -> list[DayFeatures]:
    days = days_before(last, len(values))
    return [make_day(day, night_hr=v) for day, v in zip(days, values, strict=True)]


def test_night_signal_needs_seven_earlier_nights():
    signal = night_signal(nights([50.0] * 6 + [60.0]))

    assert (signal.level, signal.night_hr, signal.baseline, signal.delta) == (None,) * 4


def test_night_signal_needs_last_nights_heart_rate():
    history = [*nights([50.0] * 10, last=D - timedelta(days=1)), make_day(D)]

    assert night_signal(history).level is None


def test_night_signal_is_green_below_three_bpm_over_the_median():
    signal = night_signal(nights([50.0] * 10 + [52.9]))

    assert signal.level == "green"
    assert signal.night_hr == pytest.approx(52.9)
    assert signal.baseline == pytest.approx(50.0)
    assert signal.delta == pytest.approx(2.9)


def test_night_signal_is_yellow_from_three_bpm():
    assert night_signal(nights([50.0] * 10 + [53.0])).level == "yellow"
    assert night_signal(nights([50.0] * 10 + [53.9])).level == "yellow"


def test_one_night_four_bpm_over_is_only_yellow():
    assert night_signal(nights([50.0] * 10 + [50.0, 55.0])).level == "yellow"


def test_two_nights_in_a_row_four_bpm_over_are_red():
    assert night_signal(nights([50.0] * 10 + [54.0, 55.0])).level == "red"


def test_red_needs_the_previous_calendar_night():
    history = [*nights([50.0] * 10 + [54.0], last=D - timedelta(days=2)), make_day(D, night_hr=55)]

    assert night_signal(history).level == "yellow"


def test_previous_night_needs_its_own_seven_earlier_nights_to_count():
    # D has 7 earlier nights, but the night before D has only 6 of its own.
    assert night_signal(nights([50.0] * 6 + [54.0, 55.0])).level == "yellow"


def test_night_signal_baseline_is_the_median_of_all_earlier_nights():
    history = nights([50.0] * 100 + [80.0] * 3 + [51.0])

    signal = night_signal(history)

    assert signal.baseline == pytest.approx(50.0)
    assert signal.level == "green"
