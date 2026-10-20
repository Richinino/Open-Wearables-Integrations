"""Synthetic Apple/Suunto regression fixtures matching OW's normalized API schemas."""

import sqlite3
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest

from owi import features, scoring, sleep, workouts
from owi.activity_score import activity_score
from owi.cli import Seen
from owi.client import OWClient
from owi.models import (
    ACTIVE_ENERGY,
    DISTANCE,
    HRV_SDNN,
    STEPS,
    DayInputs,
    Params,
    Profile,
    SourceRef,
    source_rank,
)
from owi.pipeline import compute, fetch_day
from owi.score_models import Person
from owi.store import Store
from tests.factories import HC_PHONE, HC_SHEALTH, make_features, sample, sleep_session, utc, workout
from tests.fakes import FakeClient

DAY = date(2026, 10, 12)
START = utc(2026, 10, 12)
END = START + timedelta(days=1)
APPLE_WATCH = SourceRef("apple", "Apple Watch", "Watch7,1", "watch")
APPLE_PHONE = SourceRef("apple", "Health", "iPhone15,2", "phone")
SUUNTO = SourceRef("suunto", "suunto", "Suunto Race", "watch")


def inputs(samples=(), sleeps=(), found_workouts=(), complete=True):
    return DayInputs(
        DAY,
        START,
        END,
        tuple(samples),
        tuple(found_workouts),
        tuple(sleeps),
        Profile(weight_kg=70, vo2max=45),
        complete=complete,
    )


def test_provider_rank_and_watch_priority_apply_to_sleep_and_workout():
    sources = [
        SourceRef("health_connect"),
        SourceRef("samsung"),
        APPLE_WATCH,
        SUUNTO,
        SourceRef("other"),
    ]
    assert [source_rank(source) for source in sources] == [0, 1, 2, 3, 5]
    phone = sleep_session("phone", START, START + timedelta(hours=9), APPLE_PHONE)
    watch = sleep_session("watch", START, START + timedelta(hours=8), APPLE_WATCH)
    assert sleep.dedupe([phone, watch]) == [watch]
    assert sleep.dedupe([watch, phone]) == [watch]
    phone_run = workout("phone", START, 60, source=APPLE_PHONE)
    watch_run = workout("watch", START + timedelta(seconds=30), 60, source=APPLE_WATCH)
    suunto_run = workout("suunto", START, 60, source=SUUNTO)
    assert workouts.dedupe([suunto_run, phone_run, watch_run]) == [watch_run]
    assert workouts.dedupe([watch_run, phone_run, suunto_run]) == [watch_run]


@pytest.mark.parametrize("summary", [True, False])
def test_apple_staged_sleep_uses_real_ow_metadata_and_stage_schema(summary):
    def response(request):
        assert request.url.params["include"] == "stages"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "apple-night",
                        "start_time": "2026-10-12T00:00:00Z",
                        "end_time": "2026-10-12T03:00:00Z",
                        "sleep_duration_seconds": None,
                        "duration_seconds": 10800,
                        "source": {
                            "provider": "apple",
                            "source": "Apple Watch",
                            "device": "Watch7,1",
                            "device_type": "watch",
                            "device_name": "Apple Watch Series 9",
                        },
                        "stages": {
                            "deep_minutes": 60,
                            "rem_minutes": 30,
                            "light_minutes": 60,
                            "awake_minutes": 30,
                        }
                        if summary
                        else None,
                        "sleep_stage_intervals": [
                            {"stage": stage, "start_time": start, "end_time": end}
                            for stage, start, end in [
                                ("deep", "2026-10-12T00:00:00Z", "2026-10-12T01:00:00Z"),
                                ("awake", "2026-10-12T01:00:00Z", "2026-10-12T01:30:00Z"),
                                ("rem", "2026-10-12T01:30:00Z", "2026-10-12T02:00:00Z"),
                                ("light", "2026-10-12T02:00:00Z", "2026-10-12T03:00:00Z"),
                            ]
                        ],
                    }
                ]
            },
        )

    with OWClient(
        "https://synthetic.test", "test", transport=httpx.MockTransport(response)
    ) as client:
        sessions = client.sleeps("synthetic-user", START, END)
    assert sessions[0].source == APPLE_WATCH
    day = inputs(sleeps=sessions)
    result = compute(day, Params(), "UTC")
    extracted = features.extract(day, result, Person(), None)
    assert result.sleep_minutes == extracted.sleep_minutes == 150
    assert (result.sleep_deep_min, result.sleep_rem_min, result.sleep_light_min) == (60, 30, 60)
    assert (extracted.deep_minutes, extracted.rem_minutes, extracted.light_minutes) == (60, 30, 60)
    assert extracted.awake_minutes == 30


@pytest.mark.parametrize("source", [APPLE_WATCH, SUUNTO])
def test_non_samsung_steps_and_energy_do_not_feed_samsung_auto_values(source):
    day = inputs(
        samples=[
            sample(START + timedelta(hours=23), STEPS, 4000, source),
            sample(START + timedelta(hours=23), ACTIVE_ENERGY, 300, source),
        ]
    )
    result = compute(day, Params(), "UTC")
    extracted = features.extract(day, result, Person(), None)
    assert result.steps == 4000
    assert result.steps_source == source.provider
    assert result.active_kcal == 300
    assert extracted.samsung_steps is extracted.samsung_active_kcal is None
    seen = Seen()
    seen.observe(day.samples, START)
    assert not seen.samsung


def test_apple_watch_steps_win_over_longer_phone_series():
    day = inputs(
        samples=[
            sample(START, STEPS, 10000, APPLE_PHONE),
            sample(START, STEPS, 1000, APPLE_WATCH),
            sample(START + timedelta(hours=1), STEPS, 2000, APPLE_WATCH),
        ]
    )
    assert compute(day, Params(), "UTC").steps == 3000


@pytest.mark.parametrize("source", [APPLE_WATCH, SUUNTO])
def test_samsung_workout_distance_and_phone_pedometer_never_fill_other_providers(source):
    run = workout("run", START, 60, source=source)
    records = [sample(START, DISTANCE, 9999, HC_SHEALTH), sample(START, STEPS, 999, HC_PHONE)]
    result = workouts.enrich(run, records, DAY, 50, Profile(), Params())
    assert result.distance_m is result.phone_steps is None


@pytest.mark.parametrize("source", [APPLE_WATCH, SUUNTO])
@pytest.mark.parametrize("complete", [True, False])
def test_no_minute_hr_means_missing_zones_strain_and_activity_even_with_past_history(
    source, complete, tmp_path
):
    run = workout("run", START, 60, source=source, distance_m=5000)
    day = inputs(
        samples=[sample(START, ACTIVE_ENERGY, 500, source)], found_workouts=[run], complete=complete
    )
    result = compute(day, Params(), "UTC")
    extracted = features.extract(day, result, Person(), 50)
    past = [make_features(DAY - timedelta(days=i)) for i in range(7, 0, -1)]
    assert result.zone_light_min is result.zone_moderate_min is result.zone_vigorous_min is None
    assert extracted.strain is extracted.trimp is extracted.zone_low_minutes is None
    assert extracted.met_minutes_medium is extracted.met_minutes_high is None
    assert activity_score([*past, extracted], Person(weight_kg=70), None).value is None
    scores = scoring.score_day([*past, extracted], [], Person(weight_kg=70), "UTC")
    assert scores.strain is scores.activity.value is None
    assert result.workouts[0].zone_light_min is None
    with Store(tmp_path / "synthetic.db") as store:
        store.save_day(result)
        assert store.get_day(DAY) == result


def test_pre_midnight_apple_hrv_reaches_features_and_survives_serialization(tmp_path):
    night = sleep_session(
        "night", START - timedelta(hours=2), START + timedelta(hours=7), APPLE_WATCH
    )
    client = FakeClient(
        [sample(START - timedelta(hours=1), HRV_SDNN, 45, APPLE_WATCH)], sleeps=[night]
    )
    day = fetch_day(client, "synthetic", DAY, ZoneInfo("UTC"), Profile(), END)
    result = compute(day, Params(), "UTC")
    extracted = features.extract(day, result, Person(), None)
    assert (result.hrv_ms, result.hrv_kind) == (45, "sdnn")
    assert (extracted.hrv_ms, extracted.hrv_kind, extracted.hrv_ms_source) == (
        45,
        "sdnn",
        "measured",
    )
    with Store(tmp_path / "synthetic.db") as store:
        store.save_features(extracted)
        assert store.get_features(DAY) == extracted


def test_phone_only_samsung_source_still_sets_samsung_flag():
    seen = Seen()
    seen.observe([sample(START, STEPS, 300, SourceRef("samsung", device_type="phone"))], START)
    assert seen.samsung


def test_legacy_not_null_workout_zones_migrate_without_losing_workouts(tmp_path):
    from owi import store as module

    path = tmp_path / "legacy-synthetic.db"
    old_schema = module._SCHEMA.replace(
        '"zone_light_min" INTEGER,', '"zone_light_min" INTEGER NOT NULL,'
    )
    old_schema = old_schema.replace(
        '"zone_moderate_min" INTEGER,', '"zone_moderate_min" INTEGER NOT NULL,'
    )
    old_schema = old_schema.replace(
        '"zone_vigorous_min" INTEGER,', '"zone_vigorous_min" INTEGER NOT NULL,'
    )
    with sqlite3.connect(path) as db:
        db.executescript(old_schema)
        db.execute(
            "INSERT INTO workouts (id, day, type, start, end, duration_s, source,"
            " zone_light_min, zone_moderate_min, zone_vigorous_min, distance_m)"
            " VALUES ('old', '2026-10-12', 'running', '2026-10-12T00:00:00+00:00',"
            " '2026-10-12T01:00:00+00:00', 3600, 'suunto', 0, 0, 0, 5000)"
        )
    # A read-only reader also exposes the old missing zones correctly, without migrating.
    with Store(path, readonly=True) as store:
        row = store._db.execute("SELECT * FROM workouts").fetchone()
        assert store._workout(row).zone_light_min is None
    with Store(path):
        pass
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT id, distance_m, zone_light_min FROM workouts").fetchone() == (
            "old",
            5000,
            None,
        )
        assert all(
            not row[3]
            for row in db.execute("PRAGMA table_info(workouts)")
            if row[1].startswith("zone_")
        )
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
