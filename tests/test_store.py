import json
import sqlite3
from dataclasses import replace
from datetime import date

import pytest

from owi.models import DayResult, WorkoutResult
from owi.score_models import Score
from owi.store import FitRecord, Store, jsonable
from tests.factories import make_features, make_scores, utc

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


def test_days_returns_the_range_in_order_with_workouts(store):
    for offset in (3, 1, 2, 5):
        day = date(2026, 10, offset)
        store.save_day(make_day(day, steps=offset, workouts=(make_workout(f"w{offset}", day),)))

    loaded = store.days(date(2026, 10, 2), date(2026, 10, 4))

    assert [d.day for d in loaded] == [date(2026, 10, 2), date(2026, 10, 3)]
    assert [d.steps for d in loaded] == [2, 3]
    assert [[w.id for w in d.workouts] for d in loaded] == [["w2"], ["w3"]]
    assert loaded[0] == store.get_day(date(2026, 10, 2))


def test_days_without_matches_is_empty(store):
    store.save_day(make_day())

    assert store.days(date(2026, 1, 1), date(2026, 1, 31)) == []


def test_span_covers_all_stored_days(store):
    store.save_day(make_day(date(2026, 10, 3)), computed_at=utc(2026, 10, 3, 9))
    store.save_day(make_day(date(2026, 9, 28)), computed_at=utc(2026, 10, 4, 7, 30))

    assert store.span() == (date(2026, 9, 28), date(2026, 10, 3), utc(2026, 10, 4, 7, 30))


def test_span_of_an_empty_store_is_none(store):
    assert store.span() is None


def test_readonly_store_reads_but_cannot_write(tmp_path):
    path = tmp_path / "owi.db"
    with Store(path) as writer:
        writer.save_day(make_day())

    with Store(path, readonly=True) as reader:
        assert reader.get_day(DAY) == make_day()
        with pytest.raises(sqlite3.OperationalError):
            reader.save_day(make_day(steps=1))


def test_readonly_store_does_not_create_a_missing_database(tmp_path):
    path = tmp_path / "missing" / "owi.db"

    with pytest.raises(sqlite3.OperationalError):
        Store(path, readonly=True)

    assert not path.parent.exists()


# Features and scores


def test_saved_features_read_back_identical(store):
    features = make_features(DAY)

    store.save_features(features)

    loaded = store.get_features(DAY)
    assert loaded == features
    assert isinstance(loaded.sleep_intervals, tuple)
    assert isinstance(loaded.strength_minutes, float)


def test_features_with_empty_values_read_back_identical(store):
    features = make_features(
        DAY,
        sleep_rhr=None,
        sleep_hr_low_at=None,
        strain=None,
        workout_strain={},
        sleep_start=None,
        sleep_end=None,
        sleep_intervals=(),
        vo2max=None,
    )

    store.save_features(features)

    assert store.get_features(DAY) == features


def test_saved_scores_read_back_identical(store):
    scores = make_scores(DAY)

    store.save_scores(scores)

    assert store.get_scores(DAY) == scores


def test_scores_with_empty_values_read_back_identical(store):
    scores = make_scores(
        DAY,
        strain=None,
        sleep_need_minutes=None,
        sleep_performance=Score(None, {}, "no data"),
        day_score=None,
        whoop_age=Score(None),
    )

    store.save_scores(scores)

    assert store.get_scores(DAY) == scores


def test_features_and_scores_ranges_are_inclusive_and_oldest_first(store):
    for offset in (3, 1, 2, 5):
        store.save_features(make_features(date(2026, 10, offset), steps=offset))
        store.save_scores(make_scores(date(2026, 10, offset), strain=float(offset)))

    features = store.features(date(2026, 10, 2), date(2026, 10, 5))
    scores = store.scores(date(2026, 10, 1), date(2026, 10, 3))

    assert [f.steps for f in features] == [2, 3, 5]
    assert [s.strain for s in scores] == [1.0, 2.0, 3.0]


def test_saving_features_or_scores_again_replaces_them(store):
    store.save_features(make_features(DAY, steps=1))
    store.save_scores(make_scores(DAY, strain=1.0))

    store.save_features(make_features(DAY, steps=2))
    store.save_scores(make_scores(DAY, strain=2.0))

    assert store.get_features(DAY).steps == 2
    assert store.get_scores(DAY).strain == 2.0


def test_missing_features_and_scores_are_none(store):
    assert store.get_features(DAY) is None
    assert store.get_scores(DAY) is None
    assert store.features_span() is None


def test_features_span_covers_all_stored_features(store):
    store.save_features(make_features(date(2026, 10, 3)))
    store.save_features(make_features(date(2026, 9, 28)))

    assert store.features_span() == (date(2026, 9, 28), date(2026, 10, 3))


def test_features_stored_before_the_awake_reference_load_with_defaults(store):
    features = make_features(DAY)
    data = jsonable(features)
    del data["awake_hr_p10"], data["awake_rest_hr"]
    store._db.execute(
        "INSERT INTO day_features VALUES (?, ?, ?)", (DAY.isoformat(), json.dumps(data), "x")
    )

    assert store.get_features(DAY) == replace(features, awake_hr_p10=None, awake_rest_hr=None)


def make_old_database(path) -> None:
    """A database written before features and scores existed."""
    with Store(path) as old:
        old.save_day(make_day())
    with sqlite3.connect(path) as db:
        db.execute("DROP TABLE day_features")
        db.execute("DROP TABLE day_scores")
    db.close()


def test_an_old_database_gains_the_new_tables_and_keeps_its_days(tmp_path):
    path = tmp_path / "owi.db"
    make_old_database(path)

    with Store(path) as store:
        assert store.get_day(DAY) == make_day()
        store.save_features(make_features(DAY))
        store.save_scores(make_scores(DAY))
        assert store.get_scores(DAY) == make_scores(DAY)


def test_readonly_store_reads_an_old_database_without_features_or_scores(tmp_path):
    path = tmp_path / "owi.db"
    make_old_database(path)

    with Store(path, readonly=True) as reader:
        assert reader.get_day(DAY) == make_day()
        assert reader.features(DAY, DAY) == []
        assert reader.scores(DAY, DAY) == []
        assert reader.get_features(DAY) is None
        assert reader.features_span() is None


def test_readonly_store_reads_features_and_scores_but_cannot_write_them(tmp_path):
    path = tmp_path / "owi.db"
    with Store(path) as writer:
        writer.save_features(make_features(DAY))
        writer.save_scores(make_scores(DAY))

    with Store(path, readonly=True) as reader:
        assert reader.get_features(DAY) == make_features(DAY)
        assert reader.scores(DAY, DAY) == [make_scores(DAY)]
        with pytest.raises(sqlite3.OperationalError):
            reader.save_scores(make_scores(DAY, strain=1.0))


def test_workout_phone_steps_read_back(store):
    day = make_day(workouts=(replace(make_workout(), phone_steps=4200),))

    store.save_day(day)

    assert store.get_day(DAY).workouts[0].phone_steps == 4200


def test_a_workouts_table_without_phone_steps_still_reads_and_gains_the_column(tmp_path):
    path = tmp_path / "owi.db"
    with Store(path) as old:
        old.save_day(make_day())
    with sqlite3.connect(path) as db:
        db.execute('ALTER TABLE workouts DROP COLUMN "phone_steps"')
    db.close()

    with Store(path, readonly=True) as reader:
        assert reader.get_day(DAY) == make_day()
    with Store(path) as writer:
        writer.save_day(make_day(workouts=(replace(make_workout(), phone_steps=10),)))
        assert writer.get_day(DAY).workouts[0].phone_steps == 10


def test_fits_are_kept_as_history_and_the_latest_reads_back(store):
    first = FitRecord(utc(2026, 10, 15, 9), 3, "2026-10-15T08:00:00+00:00", {"a": 1.0}, {})
    second = FitRecord(
        utc(2026, 10, 16, 9), 4, None, {"a": 2.0}, {"distance_km": {"n": 4, "error": 1.5}}
    )

    assert store.latest_fit() is None
    store.save_fit(second)
    store.save_fit(first)

    assert store.latest_fit() == second
    assert store._db.execute("SELECT COUNT(*) FROM params_history").fetchone()[0] == 2


def test_recompute_state_starts_empty_and_keeps_the_last_value(store):
    assert store.recompute_state() is None

    store.set_recompute_state({"stride_m": 0.74}, None)
    store.set_recompute_state({"stride_m": 0.76}, utc(2026, 10, 16, 9))

    assert store.recompute_state() == ({"stride_m": 0.76}, utc(2026, 10, 16, 9))


def test_readonly_store_over_a_database_without_tuning_tables(tmp_path):
    path = tmp_path / "owi.db"
    make_old_database(path)
    with sqlite3.connect(path) as db:
        db.execute("DROP TABLE params_history")
        db.execute("DROP TABLE recompute_state")
    db.close()

    with Store(path, readonly=True) as reader:
        assert reader.latest_fit() is None
        assert reader.recompute_state() is None


def test_scores_stored_before_the_samsung_estimates_load_with_empty_ones(store):
    data = jsonable(make_scores(DAY))
    del data["samsung_sleep"], data["energy_score"]
    store._db.execute(
        "INSERT INTO day_scores VALUES (?, ?, ?)", (DAY.isoformat(), json.dumps(data), "x")
    )

    loaded = store.get_scores(DAY)

    assert loaded.samsung_sleep == Score(None)
    assert loaded.energy_score == Score(None)


def test_features_keep_samsungs_own_numbers_and_older_rows_load_without_them(store):
    features = make_features(
        DAY, samsung_steps=18230, samsung_active_kcal=960.0, samsung_sleep_score=84.0
    )
    store.save_features(features)
    assert store.get_features(DAY) == features

    data = jsonable(make_features(DAY))
    for name in ("samsung_steps", "samsung_active_kcal", "samsung_sleep_score"):
        del data[name]
    store._db.execute(
        "INSERT OR REPLACE INTO day_features VALUES (?, ?, ?)",
        (DAY.isoformat(), json.dumps(data), "x"),
    )

    assert store.get_features(DAY) == make_features(DAY)


def test_fits_keep_the_signature_of_what_they_saw(store):
    record = FitRecord(utc(2026, 10, 15, 9), 3, None, {}, {}, signature="abc123")

    store.save_fit(record)

    assert store.latest_fit() == record


def test_a_history_without_the_signature_column_still_reads_and_gains_it(tmp_path):
    path = tmp_path / "owi.db"
    with Store(path) as old:
        old.save_fit(FitRecord(utc(2026, 10, 15, 9), 3, None, {}, {}))
    with sqlite3.connect(path) as db:
        db.execute('ALTER TABLE params_history DROP COLUMN "signature"')
    db.close()

    with Store(path, readonly=True) as reader:
        assert reader.latest_fit().signature is None
    with Store(path) as writer:
        writer.save_fit(FitRecord(utc(2026, 10, 16, 9), 4, None, {}, {}, signature="d"))
        assert writer.latest_fit().signature == "d"
