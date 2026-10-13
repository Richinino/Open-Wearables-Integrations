from dataclasses import replace
from datetime import date

import pytest

from owi.models import DayResult, WorkoutResult
from owi.store import Store
from tests.factories import utc

DAY = date(2026, 10, 12)


def make_workout(id_: str = "w1", day: date = DAY) -> WorkoutResult:
    return WorkoutResult(
        id=id_,
        day=day,
        type="running",
        start=utc(2026, 10, 12, 16, 30),
        end=utc(2026, 10, 12, 17, 30),
        duration_s=3600,
        source="google",
        hr_avg=140.0,
        hr_max=175.0,
        hr_min=92.0,
        zone_light_min=10,
        zone_moderate_min=40,
        zone_vigorous_min=45,
        distance_m=7500.0,
        kcal_est=812.5,
    )


def make_day(day: date = DAY, **changes) -> DayResult:
    result = DayResult(
        day=day,
        timezone="Europe/Bratislava",
        complete=True,
        steps=20000,
        steps_source="samsung_health_total",
        distance_m_est=14800.0,
        active_minutes_est=200,
        activity_kcal_est=950.5,
        basal_kcal=1600.0,
        total_kcal_est=2550.5,
        hr_resting=45.5,
        hr_avg=72.3,
        hr_max=175.0,
        hr_min=44.0,
        zone_light_min=120,
        zone_moderate_min=40,
        zone_vigorous_min=45,
        sleep_start=utc(2026, 10, 11, 22),
        sleep_end=utc(2026, 10, 12, 5),
        sleep_minutes=400.0,
        sleep_deep_min=90.0,
        sleep_rem_min=70.0,
        sleep_light_min=220.0,
        sleep_awake_min=20.0,
        nap_minutes=0.0,
        workouts=(make_workout(day=day),),
    )
    return replace(result, **changes)


@pytest.fixture
def store(tmp_path):
    with Store(tmp_path / "nested" / "owi.db") as opened:
        yield opened


def test_missing_day_is_none(store):
    assert store.get_day(DAY) is None


def test_saved_day_reads_back_identical(store):
    day = make_day()

    store.save_day(day)

    assert store.get_day(DAY) == day


def test_day_with_empty_values_reads_back_identical(store):
    day = make_day(
        complete=False,
        steps=None,
        steps_source=None,
        hr_resting=None,
        sleep_start=None,
        sleep_end=None,
        zone_light_min=None,
        workouts=(),
    )

    store.save_day(day)

    assert store.get_day(DAY) == day


def test_saving_again_replaces_the_day_and_its_workouts(store):
    store.save_day(make_day(workouts=(make_workout("w1"), make_workout("w2"))))

    store.save_day(make_day(steps=123, workouts=(make_workout("w3"),)))

    loaded = store.get_day(DAY)
    assert loaded.steps == 123
    assert [w.id for w in loaded.workouts] == ["w3"]


def test_workouts_are_returned_in_start_order(store):
    late = replace(make_workout("late"), start=utc(2026, 10, 12, 19), end=utc(2026, 10, 12, 20))
    early = replace(make_workout("early"), start=utc(2026, 10, 12, 6), end=utc(2026, 10, 12, 7))

    store.save_day(make_day(workouts=(late, early)))

    assert [w.id for w in store.get_day(DAY).workouts] == ["early", "late"]


def test_max_hr_recent_is_the_highest_daily_maximum_in_the_window(store):
    store.save_day(make_day(date(2026, 10, 10), hr_max=175.0))
    store.save_day(make_day(date(2026, 10, 11), hr_max=186.0))
    store.save_day(make_day(date(2026, 1, 1), hr_max=199.0))

    assert store.max_hr_recent(DAY) == 186.0


def test_max_hr_recent_is_capped_against_sensor_spikes(store):
    store.save_day(make_day(date(2026, 10, 11), hr_max=240.0))

    assert store.max_hr_recent(DAY) == 210.0


def test_max_hr_recent_without_data_is_none(store):
    store.save_day(make_day(date(2026, 10, 11), hr_max=None))

    assert store.max_hr_recent(DAY) is None


def test_data_survives_reopening(tmp_path):
    path = tmp_path / "owi.db"
    with Store(path) as first:
        first.save_day(make_day())

    with Store(path) as second:
        assert second.get_day(DAY) == make_day()
