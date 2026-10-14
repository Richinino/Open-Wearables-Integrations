import math
from datetime import UTC, date, datetime, time, timedelta

import pytest

from owi.longterm import vo2max_target, vo2max_uth, whoop_age
from owi.score_models import FEMALE, MALE, DayFeatures, Person

D = date(2026, 10, 14)
MAN_30 = Person(age=30, sex=MALE)
WOMAN_30 = Person(age=30, sex=FEMALE)
METRICS = {
    "sleep_duration",
    "sleep_consistency",
    "steps",
    "zone_1_3",
    "zone_4_5",
    "strength",
    "vo2max",
    "resting_hr",
    "lean_mass",
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


def lifestyle(
    count: int = 42,
    *,
    last: date = D,
    sleep: float = 420.0,
    spread: int = 30,
    steps: int = 8000,
    zone_low: int | None = 100,
    zone_high: int | None = 10,
    strength: float = 40.0,
    vo2max: float | None = 44.0,
    resting_hr: float = 60.0,
    body_fat: float | None = 20.0,
    wear_minutes: int = 1440,
) -> list[DayFeatures]:
    """Days with the given weekly habits; defaults sit on WHOOP's targets for a man of 30.

    Sleep onsets alternate `spread` minutes either side of 23:00, so their SD is `spread`.
    Weekly zone and strength minutes all fall on one day a week.
    """
    result = []
    for i, day in enumerate(days_before(last, count)):
        weekly = i % 7 == 0
        onset = at(day - timedelta(days=1), 23) + timedelta(minutes=spread if i % 2 else -spread)
        result.append(
            make_day(
                day,
                wear_minutes=wear_minutes,
                sleep_minutes=sleep,
                sleep_start=onset,
                steps=steps,
                zone_low_minutes=None if zone_low is None else (zone_low if weekly else 0),
                zone_high_minutes=None if zone_high is None else (zone_high if weekly else 0),
                strength_minutes=strength if weekly else 0.0,
                vo2max=vo2max,
                resting_hr=resting_hr,
                body_fat_pct=body_fat,
            )
        )
    return result


# Uth-Sorensen


def test_vo2max_uth_is_15_3_times_max_over_resting():
    assert vo2max_uth(190.0, 50.0) == pytest.approx(58.14)


def test_vo2max_uth_needs_both_heart_rates():
    assert vo2max_uth(None, 50.0) is None
    assert vo2max_uth(190.0, None) is None
    assert vo2max_uth(190.0, 0.0) is None


# WHOOP VO2max targets (white paper Figure 4, p. 26)


def test_vo2max_target_follows_the_white_paper_table():
    assert vo2max_target(30, MALE) == 44.0
    assert vo2max_target(30, FEMALE) == 38.0
    assert vo2max_target(60, MALE) == 32.0
    assert vo2max_target(60, FEMALE) == 27.0
    assert vo2max_target(32, MALE) == pytest.approx(43.2)
    assert vo2max_target(15, MALE) == 46.0
    assert vo2max_target(110, FEMALE) == 18.0
    assert vo2max_target(30, None) == 44.0


# whoop_age()


def test_whoop_age_needs_the_persons_age():
    score = whoop_age(lifestyle(), Person(sex=MALE))

    assert score.value is None
    assert score.note == "age missing"


def test_whoop_age_needs_30_worn_days():
    short = whoop_age(lifestyle(count=29), MAN_30)
    barely_worn = whoop_age(lifestyle(wear_minutes=600), MAN_30)

    assert short.value is None
    assert short.note == "too little history"
    assert barely_worn.value is None
    assert barely_worn.note == "too little history"


def test_meeting_every_target_gives_your_own_age():
    score = whoop_age(lifestyle(), MAN_30)

    assert set(score.components) == METRICS
    assert all(impact == pytest.approx(0.0, abs=1e-9) for impact in score.components.values())
    assert score.value == pytest.approx(30.0)
    assert score.note == "estimate"


def test_women_have_their_own_targets():
    days = lifestyle(vo2max=38.0, resting_hr=64.0, body_fat=33.0)

    assert whoop_age(days, WOMAN_30).value == pytest.approx(30.0)


def test_better_habits_make_you_younger():
    days = lifestyle(
        sleep=480.0,
        spread=10,
        steps=9000,
        zone_low=200,
        zone_high=15,
        strength=60.0,
        vo2max=50.0,
        resting_hr=50.0,
        body_fat=12.0,
    )

    score = whoop_age(days, MAN_30)

    assert score.components["sleep_duration"] == pytest.approx(0.0)
    assert all(v < 0 for k, v in score.components.items() if k != "sleep_duration")
    assert score.value < 30.0


def test_worse_habits_make_you_older():
    days = lifestyle(
        sleep=360.0,
        spread=50,
        steps=5000,
        zone_low=30,
        zone_high=0,
        strength=0.0,
        vo2max=38.0,
        resting_hr=70.0,
        body_fat=28.0,
    )

    score = whoop_age(days, MAN_30)

    assert all(v > 0 for v in score.components.values())
    assert score.value > 30.0


def test_white_paper_typical_profiles_order_as_in_table_2():
    # Table 2 (p. 35): the typical U.S. man of 30 comes out older, a typical WHOOP member younger.
    us_average = lifestyle(
        sleep=381.0,
        spread=35,
        steps=5200,
        zone_low=69,
        zone_high=None,
        strength=0.0,
        vo2max=42.4,
        resting_hr=67.0,
        body_fat=26.1,
    )
    member = lifestyle(
        sleep=420.0,
        spread=33,
        steps=10900,
        zone_low=141,
        zone_high=6,
        strength=46.0,
        vo2max=46.8,
        resting_hr=58.0,
        body_fat=19.0,
    )

    us_score = whoop_age(us_average, MAN_30)
    member_score = whoop_age(member, MAN_30)

    assert us_score.components["zone_4_5"] is None
    assert us_score.value > 30.0 > member_score.value


def test_age_impact_is_ten_times_the_log_hazard_ratio():
    score = whoop_age(lifestyle(resting_hr=70.0, vo2max=40.5, body_fat=30.0), MAN_30)

    assert score.components["resting_hr"] == pytest.approx(10 * math.log(1.09))
    assert score.components["vo2max"] == pytest.approx(-10 * math.log(0.87))
    assert score.components["lean_mass"] == pytest.approx(10 * math.log(1.11))
    assert score.value == pytest.approx(30 + sum(score.components.values()), abs=0.05)


def test_short_sleep_adds_years_per_hour_and_long_sleep_has_no_effect():
    six = whoop_age(lifestyle(sleep=360.0), MAN_30).components["sleep_duration"]
    four = whoop_age(lifestyle(sleep=240.0), MAN_30).components["sleep_duration"]
    ten = whoop_age(lifestyle(sleep=600.0), MAN_30).components["sleep_duration"]

    assert six == pytest.approx(10 * math.log(1.12))
    assert four == pytest.approx(2 * 10 * math.log(1.12))  # not extrapolated below 5 h
    assert ten == pytest.approx(0.0)


def test_sleep_consistency_comes_from_the_sd_of_sleep_onset():
    # SD 10 min gives 90 %: the top Windred 2024 quintile (HR 0.70) against the 70 % target.
    at_target_hr = math.log(0.80) * (70 - 65.10) / (75.62 - 65.10)

    score = whoop_age(lifestyle(spread=10), MAN_30)

    assert score.components["sleep_consistency"] == pytest.approx(
        10 * (math.log(0.70) - at_target_hr)
    )


def test_steps_benefit_levels_off_above_the_target():
    more = whoop_age(lifestyle(steps=9000), MAN_30).components["steps"]
    much_more = whoop_age(lifestyle(steps=12000), MAN_30).components["steps"]

    assert more == pytest.approx(10 * math.log(0.77))
    assert much_more == pytest.approx(more)


def test_older_adults_have_lower_activity_targets():
    days = lifestyle(steps=5600, zone_low=70, zone_high=7)

    score = whoop_age(days, Person(age=65, sex=MALE))

    assert score.components["steps"] == pytest.approx(0.0)
    assert score.components["zone_1_3"] == pytest.approx(0.0)
    assert score.components["zone_4_5"] == pytest.approx(0.0)


def test_strength_benefit_stops_growing_past_an_hour_a_week():
    none = whoop_age(lifestyle(strength=0.0), MAN_30).components["strength"]
    hour = whoop_age(lifestyle(strength=60.0), MAN_30).components["strength"]
    two_hours = whoop_age(lifestyle(strength=120.0), MAN_30).components["strength"]

    assert none == pytest.approx(-10 * math.log(0.80) * 40 / 45)
    assert two_hours == pytest.approx(hour)


def test_without_body_fat_lean_mass_is_left_out():
    days = lifestyle(body_fat=None, resting_hr=70.0)

    score = whoop_age(days, MAN_30)

    assert score.components["lean_mass"] is None
    assert score.value == pytest.approx(30 + 10 * math.log(1.09), abs=0.05)


def test_body_fat_falls_back_to_the_profile():
    days = lifestyle(body_fat=None)

    score = whoop_age(days, Person(age=30, sex=MALE, body_fat_pct=30.0))

    assert score.components["lean_mass"] == pytest.approx(10 * math.log(1.11))


def test_without_watch_vo2max_that_metric_is_left_out():
    score = whoop_age(lifestyle(vo2max=None), MAN_30)

    assert score.components["vo2max"] is None
    assert score.value == pytest.approx(30.0)


def test_only_the_last_180_days_count():
    old = lifestyle(count=60, last=D - timedelta(days=200), resting_hr=90.0, steps=2000)
    days = [*old, *lifestyle()]

    assert whoop_age(days, MAN_30).value == pytest.approx(30.0)


def test_unknown_sex_uses_the_male_targets():
    assert whoop_age(lifestyle(), Person(age=30)).value == pytest.approx(30.0)
