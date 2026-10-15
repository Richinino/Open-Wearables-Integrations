from datetime import date, timedelta
from zoneinfo import ZoneInfo

import pytest

from owi import estimates
from owi.features import extract
from owi.models import (
    BASAL_ENERGY,
    BODY_FAT,
    DISTANCE,
    HEART_RATE,
    STEPS,
    VO2_MAX,
    WEIGHT,
    Params,
    Profile,
)
from owi.pipeline import (
    compute,
    day_features,
    fetch_day,
    has_data,
    load_profile_samples,
    profile_for,
)
from owi.score_models import MALE, Person
from owi.steps import SAMSUNG_HEALTH_TOTAL
from owi.store import Store
from tests.factories import (
    HC_PHONE,
    HC_SHEALTH,
    SAMSUNG_WATCH,
    hr_minutes,
    make_features,
    sample,
    sleep_session,
    utc,
    workout,
)
from tests.fakes import FakeClient

TIMEZONE = "Europe/Bratislava"
TZ = ZoneInfo(TIMEZONE)
DAY = date(2026, 10, 12)
START = utc(2026, 10, 11, 22)
END = utc(2026, 10, 12, 22)
NOW = utc(2026, 10, 14, 12)
WORKOUT_START = utc(2026, 10, 12, 16)


def make_client() -> FakeClient:
    samples = [
        sample(START, STEPS, 20000, HC_SHEALTH),
        sample(utc(2026, 10, 12, 8), STEPS, 8000, HC_PHONE),
        sample(END, STEPS, 1500, HC_SHEALTH),
        *hr_minutes(utc(2026, 10, 11, 19, 30), [70.0] * 30),  # before going to bed
        *hr_minutes(utc(2026, 10, 11, 20), [48.0] * 120),  # asleep before midnight
        sample(utc(2026, 10, 11, 21), STEPS, 10, HC_PHONE),
        *hr_minutes(START, [50.0] * 120),
        *hr_minutes(WORKOUT_START, [150.0] * 60),
        sample(WORKOUT_START + timedelta(seconds=20), DISTANCE, 7500.0, HC_SHEALTH),
        sample(utc(2026, 9, 9, 5), WEIGHT, 70.0),
        sample(utc(2026, 8, 1, 5), WEIGHT, 72.0),
        sample(utc(2026, 10, 12, 16), VO2_MAX, 48.0),
        sample(utc(2026, 9, 9, 5), BASAL_ENERGY, 1650.0),
        sample(utc(2026, 9, 9, 5), BODY_FAT, 15.5),
    ]
    workouts = [
        workout("hc", WORKOUT_START, 60, source=HC_SHEALTH),
        workout("samsung", WORKOUT_START + timedelta(minutes=1), 60, source=SAMSUNG_WATCH),
        workout("next-day", END, 30),
    ]
    sleeps = [
        sleep_session("night", utc(2026, 10, 11, 20), utc(2026, 10, 12, 4), sleep_minutes=450),
        sleep_session("previous", utc(2026, 10, 10, 21), utc(2026, 10, 11, 4)),
        sleep_session("tonight", utc(2026, 10, 12, 21), utc(2026, 10, 13, 5)),
    ]
    return FakeClient(samples, workouts, sleeps)


def make_inputs():
    client = make_client()
    profile_samples = load_profile_samples(client, "u1", END)
    profile = profile_for(profile_samples, END, Profile(max_hr=190.0))
    return fetch_day(client, "u1", DAY, TZ, profile, NOW)


def test_profile_uses_the_latest_sample_before_the_day_ends_and_falls_back_to_defaults():
    samples = load_profile_samples(make_client(), "u1", END)

    assert profile_for(samples, END, Profile(max_hr=185.0)) == Profile(
        weight_kg=70.0, vo2max=48.0, basal_kcal_per_day=1650.0, max_hr=185.0, body_fat_pct=15.5
    )
    assert profile_for([], END, Profile(weight_kg=65.0, max_hr=185.0)) == Profile(
        weight_kg=65.0, vo2max=None, basal_kcal_per_day=None, max_hr=185.0
    )
    assert profile_for(samples, utc(2026, 8, 15), Profile()).weight_kg == 72.0


def test_fetch_day_clips_everything_to_the_local_day():
    inputs = make_inputs()

    assert (inputs.start, inputs.end) == (START, END)
    assert all(START <= s.timestamp < END for s in inputs.samples)
    assert [w.id for w in inputs.workouts] == ["hc"]
    assert [s.id for s in inputs.sleeps] == ["night"]
    assert inputs.complete is True
    assert inputs.elapsed_fraction == 1.0


def test_fetch_day_adds_heart_rate_back_to_the_start_of_the_nights_sleep():
    inputs = make_inputs()

    lead_in = inputs.lead_in_samples
    assert len(lead_in) == 120
    assert {s.type for s in lead_in} == {HEART_RATE}
    assert (min(s.timestamp for s in lead_in), max(s.timestamp for s in lead_in)) == (
        utc(2026, 10, 11, 20),
        utc(2026, 10, 11, 21, 59),
    )


def test_fetch_day_keeps_tonights_sleep_apart_from_the_days_sleeps():
    inputs = make_inputs()

    assert [s.id for s in inputs.tonight_sleeps] == ["tonight"]
    assert "tonight" not in [s.id for s in inputs.sleeps]


def test_fetch_day_without_a_night_has_no_lead_in():
    client = FakeClient(hr_minutes(utc(2026, 10, 11, 21), [60.0] * 120))

    inputs = fetch_day(client, "u1", DAY, TZ, Profile(), NOW)

    assert inputs.lead_in_samples == ()
    assert len(inputs.samples) == 60


def test_fetch_day_marks_today_as_incomplete():
    client = make_client()

    inputs = fetch_day(client, "u1", DAY, TZ, Profile(), utc(2026, 10, 12, 10))

    assert inputs.complete is False
    assert inputs.elapsed_fraction == 0.5


def test_has_data():
    assert has_data(make_inputs())
    assert not has_data(fetch_day(FakeClient(), "u1", DAY, TZ, Profile(), NOW))


def test_compute_builds_the_day_result():
    inputs = make_inputs()
    params = Params(stride_m=0.75, active_hr_delta=30.0, kcal_scale=1.0)

    result = compute(inputs, params, TIMEZONE)

    per_minute = estimates.kcal_per_minute(150.0, 50.0, inputs.profile)
    assert result.day == DAY
    assert result.timezone == TIMEZONE
    assert result.complete is True
    assert (result.steps, result.steps_source) == (20000, SAMSUNG_HEALTH_TOTAL)
    assert result.distance_m_est == pytest.approx(20000 * 0.75)
    assert result.hr_resting == pytest.approx(50.0)
    assert (result.hr_min, result.hr_max) == (50.0, 150.0)
    assert result.hr_avg == pytest.approx((120 * 50 + 60 * 150) / 180)
    assert (result.zone_light_min, result.zone_moderate_min, result.zone_vigorous_min) == (0, 60, 0)
    assert result.active_minutes_est == 60
    assert result.activity_kcal_est == pytest.approx(60 * per_minute)
    assert result.basal_kcal == 1650.0
    assert result.total_kcal_est == pytest.approx(1650.0 + 60 * per_minute)
    assert (result.sleep_start, result.sleep_end) == (utc(2026, 10, 11, 20), utc(2026, 10, 12, 4))
    assert result.sleep_minutes == 450
    assert result.nap_minutes == 0

    (run,) = result.workouts
    assert run.id == "hc"
    assert run.hr_avg == pytest.approx(150.0)
    assert run.distance_m == 7500.0
    assert run.kcal_est == pytest.approx(60 * per_minute)


def test_compute_on_an_empty_day_leaves_values_empty():
    inputs = fetch_day(FakeClient(), "u1", DAY, TZ, Profile(), utc(2026, 10, 12, 10))

    result = compute(inputs, Params(), TIMEZONE)

    assert result.complete is False
    assert result.steps is None
    assert result.steps_source is None
    assert result.distance_m_est is None
    assert result.active_minutes_est is None
    assert result.activity_kcal_est is None
    assert result.hr_resting is None
    assert result.zone_light_min is None
    assert result.sleep_minutes is None
    assert result.workouts == ()


def test_day_features_use_the_mean_sleep_rhr_of_the_14_stored_days_before(tmp_path):
    inputs = make_inputs()
    result = compute(inputs, Params(), TIMEZONE)
    person = Person(age=17, sex=MALE)
    with Store(tmp_path / "owi.db") as store:
        for days_back, sleep_rhr in ((15, 70.0), (14, 40.0), (3, None), (1, 50.0), (-1, 99.0)):
            day = DAY - timedelta(days=days_back)
            store.save_features(make_features(day, sleep_rhr=sleep_rhr))

        features = day_features(store, inputs, result, person)

    assert features == extract(inputs, result, person, 45.0)
    assert features != extract(inputs, result, person, None)


def test_day_features_without_stored_days_use_the_days_own_resting_hr(tmp_path):
    inputs = make_inputs()
    result = compute(inputs, Params(), TIMEZONE)
    with Store(tmp_path / "owi.db") as store:
        features = day_features(store, inputs, result, Person())

    assert features == extract(inputs, result, Person(), None)
