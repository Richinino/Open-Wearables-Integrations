import math
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from owi.models import SleepInterval
from owi.score_models import DayFeatures, Person
from owi.sleep_scores import (
    apple_sleep_score,
    sleep_need_minutes,
    sleep_performance,
    sleep_regularity_index,
)

TIMEZONE = "Europe/Bratislava"
TZ = ZoneInfo(TIMEZONE)
D = date(2026, 10, 14)
ADULT = Person(age=35)
TEEN = Person(age=16)


def at(day: date, hour: int, minute: int = 0) -> datetime:
    """A local clock time on `day`, in UTC. An ambiguous time takes its first pass."""
    return datetime.combine(day, time(hour, minute), tzinfo=TZ).astimezone(UTC)


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
    return DayFeatures(day=day, **values)


def night(
    day: date = D,
    onset: tuple[int, int] = (23, 0),
    wake: tuple[int, int] = (7, 0),
    **fields: object,
) -> DayFeatures:
    """A day whose main sleep ran from `onset` (the evening before if after noon) to `wake`."""
    start = at(day - timedelta(days=1) if onset[0] >= 12 else day, *onset)
    end = at(day, *wake)
    minutes = (end - start).total_seconds() / 60
    values: dict[str, object] = {
        "sleep_start": start,
        "sleep_end": end,
        "sleep_minutes": minutes,
        "in_bed_minutes": minutes,
        "sleep_intervals": (SleepInterval(start, end, "light"),),
    }
    values.update(fields)
    return make_day(day, **values)


def regular_nights(count: int, last: date = D) -> list[DayFeatures]:
    """`count` nights from 23:00 to 07:00 local, the last one ending on `last`."""
    return [night(day) for day in days_before(last, count)]


def with_nap(features: DayFeatures, start: tuple[int, int], end: tuple[int, int]) -> DayFeatures:
    nap = SleepInterval(at(features.day, *start), at(features.day, *end), "light")
    minutes = (nap.end - nap.start).total_seconds() / 60
    return replace(
        features,
        nap_minutes=features.nap_minutes + minutes,
        sleep_intervals=features.sleep_intervals + (nap,),
    )


# Sleep need


def baseline_history(
    count: int = 65, rested: tuple[float, float] = (400.0, 456.6)
) -> list[DayFeatures]:
    """Strain alternates 5 and 15. Nights after a light day take `rested` in turn, nights
    after a hard day 600 min, so counting them would push the percentile up."""
    history = []
    for i, day in enumerate(days_before(D, count)):
        after_light_day = i % 2 == 1
        sleep = rested[(i // 2) % 2] if after_light_day else 600.0
        history.append(make_day(day, strain=5.0 if i % 2 == 0 else 15.0, sleep_minutes=sleep))
    return history


def test_need_is_none_without_history():
    assert sleep_need_minutes([], ADULT, None) is None


def test_adult_baseline_defaults_to_seven_and_a_half_hours():
    assert sleep_need_minutes([make_day()], ADULT, None) == 450
    assert sleep_need_minutes([make_day()], Person(), None) == 450
    assert sleep_need_minutes([make_day()], Person(age=18), None) == 450


def test_teen_baseline_defaults_to_eight_hours():
    assert sleep_need_minutes([make_day()], TEEN, None) == 480


@pytest.mark.parametrize(
    ("strain", "extra"), [(0.0, 0.8), (10.0, 12.2), (14.0, 30.4), (17.0, 51.0)]
)
def test_strain_adds_minutes_on_a_logistic_curve(strain, extra):
    need = sleep_need_minutes([make_day(strain=strain)], ADULT, None)

    assert need == pytest.approx(450 + extra, abs=0.05)


def test_debt_adds_half_of_the_need_that_was_missed():
    assert sleep_need_minutes([make_day(sleep_minutes=420.0)], ADULT, 480.0) == 480


def test_debt_is_capped_at_two_hours():
    assert sleep_need_minutes([make_day(sleep_minutes=60.0)], ADULT, 540.0) == 450 + 120


def test_no_debt_after_enough_sleep_or_without_both_values():
    assert sleep_need_minutes([make_day(sleep_minutes=500.0)], ADULT, 480.0) == 450
    assert sleep_need_minutes([make_day(sleep_minutes=300.0)], ADULT, None) == 450
    assert sleep_need_minutes([make_day()], ADULT, 480.0) == 450


def test_naps_reduce_the_need():
    assert sleep_need_minutes([make_day(nap_minutes=30.0)], ADULT, None) == 420


def test_need_never_goes_below_zero():
    assert sleep_need_minutes([make_day(nap_minutes=600.0)], ADULT, None) == 0


@pytest.mark.parametrize("count", [60, 65])
def test_whoop_worked_example_baseline_is_the_75th_percentile_of_rested_nights(count):
    history = baseline_history(count)
    history[-1] = replace(history[-1], strain=None)

    need = sleep_need_minutes(history, ADULT, None)

    assert need == pytest.approx(456.6)
    assert need / 60 == pytest.approx(7.61)


def test_whoop_worked_example_adds_strain_and_debt_to_the_baseline():
    history = baseline_history()
    history[-1] = replace(history[-1], strain=8.0, sleep_minutes=450.0)

    need = sleep_need_minutes(history, ADULT, 470.0)

    strain_term = 60 * 1.7 / (1 + math.exp((17 - 8) / 3.5))
    assert strain_term == pytest.approx(7.24, abs=0.01)
    assert need == pytest.approx(456.6 + strain_term + 10.0)


def test_baseline_needs_60_nights_of_history():
    history = baseline_history(59)
    history[-1] = replace(history[-1], strain=None)

    assert sleep_need_minutes(history, ADULT, None) == 450


@pytest.mark.parametrize(
    ("person", "rested", "expected"),
    [
        (ADULT, (600.0, 600.0), 540),
        (ADULT, (360.0, 360.0), 420),
        (TEEN, (456.6, 456.6), 480),
        (TEEN, (650.0, 650.0), 600),
        (TEEN, (500.0, 520.0), 520),
    ],
)
def test_learned_baseline_is_clamped_to_the_age_range(person, rested, expected):
    history = baseline_history(rested=rested)
    history[-1] = replace(history[-1], strain=None)

    assert sleep_need_minutes(history, person, None) == pytest.approx(expected)


def test_baseline_looks_up_the_preceding_day_by_date():
    # Only the light days, two days apart: no night has its preceding day in the history,
    # so nothing counts as rested and the default applies (not the 600-min nights).
    every_other_day = [f for f in baseline_history(125) if f.strain == 5.0]
    every_other_day[-1] = replace(every_other_day[-1], strain=None)

    assert sleep_need_minutes(every_other_day, ADULT, None) == 450


# Sleep Performance


def test_performance_blends_hours_consistency_and_efficiency():
    history = regular_nights(4)
    history[-1] = replace(history[-1], sleep_minutes=450.0)

    score = sleep_performance(history, 500.0, TIMEZONE)

    assert score.components == pytest.approx(
        {"hours_vs_needed": 90.0, "consistency": 100.0, "efficiency": 93.75}, abs=0.05
    )
    assert score.value == pytest.approx(0.70 * 90 + 0.15 * 100 + 0.15 * 93.75, abs=0.05)
    assert score.note is None


def test_hours_vs_needed_is_capped_at_100():
    score = sleep_performance(regular_nights(4), 420.0, TIMEZONE)

    assert score.components["hours_vs_needed"] == 100
    assert score.value == 100


def test_consistency_is_shared_sleep_over_any_sleep_in_the_last_four_days():
    days = days_before(D, 5)
    history = [
        night(days[0], (3, 0), (11, 0)),  # outside the last four days
        night(days[1], (23, 0), (7, 0)),
        night(days[2], (0, 0), (8, 0)),
        night(days[3], (1, 0), (9, 0)),
        night(days[4], (23, 0), (7, 0)),
    ]

    score = sleep_performance(history, 480.0, TIMEZONE)

    # Asleep on all four: 01:00-07:00. Asleep on any: 23:00-09:00.
    assert score.components["consistency"] == pytest.approx(100 * 360 / 600)


def test_naps_count_towards_consistency():
    history = regular_nights(4)
    history[-2] = with_nap(history[-2], (14, 0), (15, 0))

    score = sleep_performance(history, 480.0, TIMEZONE)

    assert score.components["consistency"] == pytest.approx(100 * 480 / 540, abs=0.05)


def test_awake_stages_do_not_count_as_asleep():
    history = regular_nights(4)
    last = history[-1]
    intervals = (
        SleepInterval(last.sleep_start, at(D, 3), "deep"),
        SleepInterval(at(D, 3), at(D, 4), "awake"),
        SleepInterval(at(D, 4), last.sleep_end, "rem"),
    )
    history[-1] = replace(last, sleep_intervals=intervals)

    score = sleep_performance(history, 480.0, TIMEZONE)

    assert score.components["consistency"] == pytest.approx(100 * 420 / 480)


def test_consistency_needs_four_days_and_the_weights_renormalise():
    history = regular_nights(3)
    history[-1] = replace(history[-1], sleep_minutes=450.0)

    score = sleep_performance(history, 500.0, TIMEZONE)

    assert score.components["consistency"] is None
    assert score.value == pytest.approx((0.70 * 90 + 0.15 * 93.75) / 0.85, abs=0.05)
    assert "consistency" in score.note


def test_a_day_without_sleep_data_leaves_consistency_unknown():
    history = regular_nights(4)
    history[1] = make_day(history[1].day)

    score = sleep_performance(history, 480.0, TIMEZONE)

    assert score.components["consistency"] is None


def test_efficiency_is_left_out_without_time_in_bed():
    history = regular_nights(4)
    history[-1] = replace(history[-1], sleep_minutes=450.0, in_bed_minutes=None)

    score = sleep_performance(history, 500.0, TIMEZONE)

    assert score.components["efficiency"] is None
    assert score.value == pytest.approx((0.70 * 90 + 0.15 * 100) / 0.85, abs=0.05)
    assert "efficiency" in score.note


def test_performance_is_none_without_sleep_need_or_history():
    no_sleep = sleep_performance([make_day()], 480.0, TIMEZONE)
    no_need = sleep_performance(regular_nights(4), None, TIMEZONE)
    empty = sleep_performance([], 480.0, TIMEZONE)

    for score in (no_sleep, no_need, empty):
        assert score.value is None
        assert score.note
    assert no_need.components["efficiency"] == 100


# Apple Sleep Score


def good_night(day: date = D, onset: tuple[int, int] = (23, 0), **fields: object) -> DayFeatures:
    """Eight hours with healthy stage shares and almost no waking."""
    values: dict[str, object] = {
        "deep_minutes": 96.0,
        "rem_minutes": 96.0,
        "awake_minutes": 5.0,
        "awake_bouts": 1,
    }
    values.update(fields)
    return night(day, onset, **values)


def with_bedtimes(
    previous: list[tuple[int, int]], onset: tuple[int, int] = (23, 0), **fields: object
) -> list[DayFeatures]:
    """Earlier nights falling asleep at `previous`, then last night at `onset`."""
    days = days_before(D, len(previous) + 1)
    earlier = [night(day, p) for day, p in zip(days, previous, strict=False)]
    return earlier + [good_night(D, onset, **fields)]


def test_apple_full_marks():
    score = apple_sleep_score(with_bedtimes([(23, 0)] * 13), TIMEZONE)

    assert score.value == 100
    assert score.components == {"duration": 50, "bedtime": 30, "interruptions": 20}
    assert score.note is None


@pytest.mark.parametrize(
    ("minutes", "expected"),
    [(600.0, 50.0), (470.0, 50.0), (410.0, 50 - 13 * 0.5**2.4), (350.0, 37.0), (230.0, 0.0)],
)
def test_apple_duration_falls_with_missing_sleep(minutes, expected):
    history = with_bedtimes(
        [(23, 0)] * 13, sleep_minutes=minutes, deep_minutes=100.0, rem_minutes=100.0
    )

    score = apple_sleep_score(history, TIMEZONE)

    assert score.components["duration"] == pytest.approx(expected, abs=0.05)


def test_apple_duration_loses_five_points_each_for_little_deep_and_rem_sleep():
    little_deep = with_bedtimes([(23, 0)] * 13, deep_minutes=40.0)
    little_both = with_bedtimes([(23, 0)] * 13, deep_minutes=40.0, rem_minutes=60.0)

    assert apple_sleep_score(little_deep, TIMEZONE).components["duration"] == 45
    assert apple_sleep_score(little_both, TIMEZONE).components["duration"] == 40


@pytest.mark.parametrize(
    ("onset", "expected"),
    [
        ((23, 0), 30.0),
        ((23, 15), 30.0),
        ((23, 45), 30 - 30 / 4.5),
        ((2, 0), 0.0),
        ((22, 0), 30.0),
        ((21, 30), 29.0),
        ((19, 0), 24.0),
    ],
)
def test_apple_bedtime_against_the_usual_onset(onset, expected):
    score = apple_sleep_score(with_bedtimes([(23, 0)] * 13, onset), TIMEZONE)

    assert score.components["bedtime"] == pytest.approx(expected, abs=0.05)


@pytest.mark.parametrize(
    ("onset", "expected"),
    [((0, 0), 30.0), ((0, 45), 30 - 30 / 4.5), ((23, 0), 30.0), ((1, 0), 20.0)],
)
def test_apple_bedtime_median_works_across_midnight(onset, expected):
    # Circular median 00:00; a plain median of clock minutes would say 00:30.
    previous = [(23, 30), (23, 40), (23, 50), (0, 10), (0, 20), (0, 30)] * 2 + [(0, 0)]

    score = apple_sleep_score(with_bedtimes(previous, onset), TIMEZONE)

    assert score.components["bedtime"] == pytest.approx(expected, abs=0.05)


def test_apple_bedtime_median_of_an_even_count_across_midnight():
    # Circular median 00:00; a plain median would land at noon.
    previous = [(23, 30), (23, 40), (23, 50), (0, 10), (0, 20), (0, 30)]

    on_time = apple_sleep_score(with_bedtimes(previous, (0, 0)), TIMEZONE)
    late = apple_sleep_score(with_bedtimes(previous, (0, 45)), TIMEZONE)

    assert on_time.components["bedtime"] == 30
    assert late.components["bedtime"] == pytest.approx(30 - 30 / 4.5, abs=0.05)


def test_apple_bedtime_uses_only_the_13_nights_before():
    previous = [(20, 0)] * 20 + [(23, 0)] * 13

    score = apple_sleep_score(with_bedtimes(previous, (23, 0)), TIMEZONE)

    assert score.components["bedtime"] == 30


def test_apple_bedtime_gets_full_marks_with_a_note_when_history_is_short():
    score = apple_sleep_score(with_bedtimes([(20, 0)] * 2, (23, 0)), TIMEZONE)

    assert score.components["bedtime"] == 30
    assert score.value == 100
    assert "bedtime" in score.note


def test_apple_bedtime_uses_the_local_clock_across_a_dst_change():
    days = days_before(date(2026, 10, 30), 14)
    history = [night(day) for day in days[:-1]] + [good_night(days[-1])]

    assert apple_sleep_score(history, TIMEZONE).components["bedtime"] == 30


@pytest.mark.parametrize(
    ("waso", "bouts", "expected"),
    [(11.0, 2, 20.0), (31.0, 2, 15.0), (11.0, 6, 18.0), (51.0, 4, 9.0), (200.0, 30, 0.0)],
)
def test_apple_interruptions(waso, bouts, expected):
    history = with_bedtimes([(23, 0)] * 13, awake_minutes=waso, awake_bouts=bouts)

    score = apple_sleep_score(history, TIMEZONE)

    assert score.components["interruptions"] == pytest.approx(expected)


def test_apple_value_is_the_sum_rounded_to_one_decimal():
    history = with_bedtimes([(23, 0)] * 13, (23, 45), sleep_minutes=480.0)

    score = apple_sleep_score(history, TIMEZONE)

    assert score.value == 93.3


def test_apple_without_wake_data_scales_the_other_parts_to_100():
    history = with_bedtimes(
        [(23, 0)] * 13, (23, 45), sleep_minutes=480.0, awake_minutes=None, awake_bouts=None
    )

    score = apple_sleep_score(history, TIMEZONE)

    assert score.components["interruptions"] is None
    assert score.value == pytest.approx(100 * (50 + 30 - 30 / 4.5) / 80, abs=0.05)
    assert "interruptions" in score.note


def test_apple_is_none_without_sleep():
    for history in ([], [make_day()]):
        score = apple_sleep_score(history, TIMEZONE)
        assert score.value is None
        assert score.note


# Sleep Regularity Index


def test_sri_is_100_for_a_perfectly_regular_schedule():
    assert sleep_regularity_index(regular_nights(14), TIMEZONE) == 100


def test_sri_is_low_when_bedtime_jumps_four_hours_every_other_night():
    history = [
        night(day) if i % 2 == 0 else night(day, (3, 0), (11, 0))
        for i, day in enumerate(days_before(D, 14))
    ]

    # Each pair of days disagrees on 23:00-03:00 and 07:00-11:00.
    expected = 200 * (1440 - 480) / 1440 - 100
    assert sleep_regularity_index(history, TIMEZONE) == pytest.approx(expected, abs=0.05)


def test_sri_drops_when_bedtime_drifts_later_every_night():
    history = []
    for i, day in enumerate(days_before(D, 14)):
        onset = 20 * 60 + 30 * i
        wake = onset + 8 * 60
        history.append(night(day, divmod(onset % 1440, 60), divmod(wake % 1440, 60)))

    expected = 200 * (1440 - 60) / 1440 - 100
    assert sleep_regularity_index(history, TIMEZONE) == pytest.approx(expected, abs=0.05)


def test_naps_count_as_sleep_in_sri():
    history = regular_nights(14)
    for i in range(0, 14, 2):
        history[i] = with_nap(history[i], (14, 0), (15, 0))

    # Every pair of days has the nap on exactly one side.
    expected = 200 * (1440 - 60) / 1440 - 100
    assert sleep_regularity_index(history, TIMEZONE) == pytest.approx(expected, abs=0.05)


def test_sri_needs_five_day_pairs():
    assert sleep_regularity_index([], TIMEZONE) is None
    assert sleep_regularity_index(regular_nights(5), TIMEZONE) is None
    assert sleep_regularity_index(regular_nights(6), TIMEZONE) == 100


def test_days_without_sleep_data_are_skipped_not_counted_as_wake():
    history = regular_nights(14)
    for i in (3, 9):
        history[i] = make_day(history[i].day)
    sparse = [f if i % 2 else make_day(f.day) for i, f in enumerate(regular_nights(14))]

    assert sleep_regularity_index(history, TIMEZONE) == 100
    assert sleep_regularity_index(sparse, TIMEZONE) is None


def test_sri_looks_only_at_the_last_days():
    days = days_before(D, 14)
    history = [
        night(day, (3, 0), (11, 0)) if i % 2 else night(day) for i, day in enumerate(days[:7])
    ] + [night(day) for day in days[7:]]

    assert sleep_regularity_index(history, TIMEZONE, days=7) == 100
    assert sleep_regularity_index(history, TIMEZONE) < 100


@pytest.mark.parametrize("last", [date(2026, 10, 30), date(2026, 4, 3)])
def test_sri_stays_100_across_dst_changes(last):
    # 25-hour day: the repeated hour counts once. 23-hour day: the skipped hour is unknown.
    assert sleep_regularity_index(regular_nights(14, last), TIMEZONE) == 100


def test_sri_keeps_the_first_pass_of_the_repeated_hour():
    # Waking at the first 02:30 of 25 October matches the other nights' 02:30 wake.
    history = [night(day, (23, 0), (2, 30)) for day in days_before(date(2026, 10, 30), 14)]

    assert sleep_regularity_index(history, TIMEZONE) == 100
