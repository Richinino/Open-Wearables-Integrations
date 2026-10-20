from dataclasses import replace
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import pytest

from owi import estimates
from owi.features import extract
from owi.models import (
    ACTIVE_ENERGY,
    BASAL_ENERGY,
    BODY_FAT,
    DISTANCE,
    HEART_RATE,
    HRV_RMSSD,
    HRV_SDNN,
    RESTING_HR,
    STEPS,
    TOTAL_ENERGY,
    VO2_MAX,
    WEIGHT,
    Params,
    Profile,
    SourceRef,
    source_order,
    source_rank,
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
    sleep_score,
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


def test_fetch_day_also_fetches_active_calories():
    client = FakeClient([sample(utc(2026, 10, 12, 9), ACTIVE_ENERGY, 120.0, SAMSUNG_WATCH)])

    inputs = fetch_day(client, "u1", DAY, TZ, Profile(), NOW)

    assert [(s.type, s.value) for s in inputs.samples] == [(ACTIVE_ENERGY, 120.0)]


def test_fetch_day_keeps_the_samsung_sleep_scores_of_the_night_that_ended_on_the_day():
    night = sleep_session("night", utc(2026, 10, 11, 20), utc(2026, 10, 12, 4))
    tonight = sleep_session("tonight", utc(2026, 10, 12, 21), utc(2026, 10, 13, 5))
    # Fell asleep at 00:30 on the 11th: fetched with this day's sleeps, but it ended the day before.
    previous = sleep_session("previous", utc(2026, 10, 10, 22, 30), utc(2026, 10, 11, 4))
    scores = [
        sleep_score("linked", 88, utc(2026, 10, 11, 20), "night"),
        sleep_score("tonight", 70, utc(2026, 10, 12, 21), "tonight"),
        sleep_score("previous", 60, utc(2026, 10, 10, 22, 30), "previous"),
        # Without a session owi knows: the local date 12 hours after the sleep started.
        sleep_score("late-evening", 80, utc(2026, 10, 11, 21, 30), "unknown"),
        sleep_score("from-noon", 66, utc(2026, 10, 11, 10)),
        sleep_score("afternoon", 75, utc(2026, 10, 12, 11)),
        sleep_score("morning-before", 65, utc(2026, 10, 11, 9)),
    ]
    client = FakeClient(sleeps=[night, tonight, previous], health_scores=scores)

    inputs = fetch_day(client, "u1", DAY, TZ, Profile(), NOW)

    assert [s.id for s in inputs.samsung_sleep_scores] == ["linked", "late-evening", "from-noon"]


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
        for days_back, sleep_rhr, awake_p10 in (
            (15, 70.0, 99.0),
            (14, 40.0, 60.0),
            (3, None, None),
            (1, 50.0, 64.0),
            (-1, 99.0, 99.0),
        ):
            day = DAY - timedelta(days=days_back)
            store.save_features(make_features(day, sleep_rhr=sleep_rhr, awake_hr_p10=awake_p10))

        features = day_features(store, inputs, result, person)

    assert features == extract(inputs, result, person, 45.0, [60.0, 64.0])
    assert features != extract(inputs, result, person, None, [60.0, 64.0])


def test_day_features_without_stored_days_use_the_days_own_resting_hr(tmp_path):
    inputs = make_inputs()
    result = compute(inputs, Params(), TIMEZONE)
    with Store(tmp_path / "owi.db") as store:
        features = day_features(store, inputs, result, Person())

    assert features == extract(inputs, result, Person(), None, [])


def test_a_fitted_basal_fills_in_only_on_days_without_a_samsung_basal_record():
    inputs = make_inputs()
    without_record = replace(inputs, profile=replace(inputs.profile, basal_kcal_per_day=None))
    params = Params(basal_kcal=1800.0)

    recorded = compute(inputs, params, TIMEZONE)
    filled = compute(without_record, params, TIMEZONE)
    unknown = compute(without_record, Params(), TIMEZONE)

    assert recorded.basal_kcal == 1650.0
    assert filled.basal_kcal == 1800.0
    assert filled.total_kcal_est == pytest.approx(1800.0 + filled.activity_kcal_est)
    assert (unknown.basal_kcal, unknown.total_kcal_est) == (None, None)


# Measured values before estimates

APPLE_WATCH = SourceRef("apple", "Watch", "Watch6", "watch")
APPLE_PHONE = SourceRef("apple", "iPhone", "iPhone15", "phone")
SUUNTO = SourceRef("suunto", "Suunto", "Race", "watch")
OTHER = SourceRef("garmin", "Garmin", "Fenix", "watch")


def measured_day(extra, steps=20000, now=NOW, with_hr=True):
    samples = [sample(START, STEPS, steps, HC_SHEALTH), *extra]
    if with_hr:
        samples += hr_minutes(WORKOUT_START, [150.0] * 60) + hr_minutes(START, [50.0] * 120)
    inputs = fetch_day(
        FakeClient(samples),
        "u1",
        DAY,
        TZ,
        Profile(weight_kg=70.0, vo2max=48.0, basal_kcal_per_day=1650.0, max_hr=190.0),
        now,
    )
    return compute(inputs, Params(stride_m=0.75), TIMEZONE)


def test_device_distance_wins_over_the_stride_estimate():
    result = measured_day(
        [
            sample(utc(2026, 10, 12, 9), DISTANCE, 5000.0, SAMSUNG_WATCH),
            sample(utc(2026, 10, 12, 10), DISTANCE, 2500.0, SAMSUNG_WATCH),
        ]
    )

    assert (result.distance_m, result.distance_m_source) == (7500.0, "measured")
    assert result.distance_m_est == pytest.approx(20000 * 0.75)


def test_without_device_distance_the_estimate_fills_in():
    result = measured_day([])

    assert (result.distance_m, result.distance_m_source) == (
        pytest.approx(15000.0),
        "estimated",
    )


def test_the_best_ranked_source_is_used_and_sources_are_not_added():
    result = measured_day(
        [
            sample(utc(2026, 10, 12, 9), DISTANCE, 6000.0, APPLE_WATCH),
            sample(utc(2026, 10, 12, 9), DISTANCE, 9000.0, SAMSUNG_WATCH),
            sample(utc(2026, 10, 12, 9), DISTANCE, 100.0, HC_PHONE),
            sample(utc(2026, 10, 12, 9), RESTING_HR, 60.0, APPLE_PHONE),
            sample(utc(2026, 10, 12, 9), RESTING_HR, 58.0, APPLE_WATCH),
        ]
    )

    assert result.distance_m == 100.0  # Health Connect ranks first
    assert result.resting_hr_measured == 58.0  # a watch before a phone


def test_source_rank_order():
    assert [source_rank(s) for s in (HC_PHONE, SAMSUNG_WATCH, APPLE_PHONE, SUUNTO, OTHER)] == [
        0,
        1,
        2,
        3,
        5,
    ]
    assert source_order(APPLE_WATCH) < source_order(APPLE_PHONE) < source_order(SUUNTO)


def test_device_active_energy_wins_and_total_adds_basal():
    result = measured_day(
        [
            sample(utc(2026, 10, 12, 9), ACTIVE_ENERGY, 300.0, SAMSUNG_WATCH),
            sample(utc(2026, 10, 12, 12), ACTIVE_ENERGY, 200.0, SAMSUNG_WATCH),
            sample(utc(2026, 9, 9, 5), BASAL_ENERGY, 1650.0),
        ]
    )

    assert (result.active_kcal, result.active_kcal_source) == (500.0, "measured")
    assert (result.total_kcal, result.total_kcal_source) == (2150.0, "derived")
    assert result.activity_kcal_est is not None  # the estimate is still computed


def test_device_total_energy_is_used_when_the_device_sends_it():
    result = measured_day(
        [
            sample(utc(2026, 10, 12, 9), ACTIVE_ENERGY, 300.0, SAMSUNG_WATCH),
            sample(utc(2026, 10, 12, 9), TOTAL_ENERGY, 2400.0, SAMSUNG_WATCH),
            sample(utc(2026, 9, 9, 5), BASAL_ENERGY, 1650.0),
        ]
    )

    assert (result.total_kcal, result.total_kcal_source) == (2400.0, "measured")


def test_without_device_energy_the_estimates_fill_in():
    result = measured_day([sample(utc(2026, 9, 9, 5), BASAL_ENERGY, 1650.0)])

    assert (result.active_kcal, result.active_kcal_source) == (
        result.activity_kcal_est,
        "estimated",
    )
    assert (result.total_kcal, result.total_kcal_source) == (result.total_kcal_est, "estimated")


def test_device_resting_heart_rate_is_reported_separately():
    result = measured_day(
        [
            sample(utc(2026, 10, 12, 6), RESTING_HR, 55.0, SAMSUNG_WATCH),
            sample(utc(2026, 10, 12, 18), RESTING_HR, 53.0, SAMSUNG_WATCH),
            sample(utc(2026, 10, 12, 12), RESTING_HR, 99.0, SAMSUNG_WATCH),
        ]
    )

    assert (result.resting_hr_measured, result.resting_hr_source) == (53.0, "measured")
    assert result.hr_resting == pytest.approx(50.0)  # owi's own value stays its own


def test_nightly_hrv_rmssd_or_sdnn_is_reported():
    night = [
        sample(utc(2026, 10, 12, 1), HRV_RMSSD, 60.0, SAMSUNG_WATCH),
        sample(utc(2026, 10, 12, 3), HRV_RMSSD, 80.0, SAMSUNG_WATCH),
        sample(utc(2026, 10, 12, 15), HRV_RMSSD, 10.0, SAMSUNG_WATCH),  # awake
    ]
    sleeps = [sleep_session("night", utc(2026, 10, 11, 20), utc(2026, 10, 12, 4))]
    only_sdnn = [sample(utc(2026, 10, 12, 2), HRV_SDNN, 45.0, SAMSUNG_WATCH)]

    def run(extra):
        client = FakeClient([*extra, sample(START, STEPS, 100, HC_SHEALTH)], sleeps=sleeps)
        return compute(fetch_day(client, "u1", DAY, TZ, Profile(), NOW), Params(), TIMEZONE)

    rmssd = run([*night, *only_sdnn])
    sdnn = run(only_sdnn)

    assert (rmssd.hrv_ms, rmssd.hrv_kind, rmssd.hrv_ms_source) == (70.0, "rmssd", "measured")
    assert (sdnn.hrv_ms, sdnn.hrv_kind, sdnn.hrv_ms_source) == (45.0, "sdnn", "measured")


def test_no_value_at_all_is_null_with_null_source():
    inputs = fetch_day(FakeClient(), "u1", DAY, TZ, Profile(), NOW)
    result = compute(inputs, Params(), TIMEZONE)

    for name in ("distance_m", "active_kcal", "total_kcal", "resting_hr_measured", "hrv_ms"):
        assert getattr(result, name) is None
    assert result.hrv_kind is None
    for name in (
        "distance_m_source",
        "active_kcal_source",
        "total_kcal_source",
        "resting_hr_source",
        "hrv_ms_source",
    ):
        assert getattr(result, name) is None


def test_fetch_day_asks_for_the_resting_hr_and_hrv_series():
    asked = []

    class Spy(FakeClient):
        def timeseries(self, user_id, types, start, end):
            asked.append(tuple(types))
            return super().timeseries(user_id, types, start, end)

    fetch_day(Spy(), "u1", DAY, TZ, Profile(), NOW)

    (types,) = asked
    assert {RESTING_HR, HRV_RMSSD, HRV_SDNN, TOTAL_ENERGY} <= set(types)
