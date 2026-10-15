import json
import sqlite3
import threading
from dataclasses import fields, replace
from datetime import date, timedelta

import httpx
import pytest

from owi import cli
from owi.models import DayResult, SleepInterval
from owi.serve import MAX_DAYS, Response, make_server, respond
from owi.store import Store, jsonable
from tests.factories import make_features, make_scores, utc
from tests.test_store import make_day, make_workout

TOKEN = "t" * 40
TIMEZONE = "Europe/Bratislava"
AUTH = f"Bearer {TOKEN}"


TIMELINE = (
    SleepInterval(utc(2026, 10, 1, 21), utc(2026, 10, 2, 1), "light"),
    SleepInterval(utc(2026, 10, 2, 1), utc(2026, 10, 2, 1, 5), "awake"),
    SleepInterval(utc(2026, 10, 2, 13), utc(2026, 10, 2, 13, 30), "asleep"),
)


LATER_WORKOUT = replace(
    make_workout("unscored", date(2026, 10, 2)),
    start=utc(2026, 10, 12, 19),
    end=utc(2026, 10, 12, 20),
)


@pytest.fixture
def db_path(tmp_path):
    """Three days; day 2 has two workouts, features and scores, day 1 only features."""
    path = tmp_path / "owi.db"
    with Store(path) as store:
        for offset in (1, 2, 3):
            day = date(2026, 10, offset)
            workouts = (make_workout(f"w{offset}", day), LATER_WORKOUT) if offset == 2 else ()
            store.save_day(
                make_day(day, steps=offset * 1000, workouts=workouts),
                computed_at=utc(2026, 10, 3, offset),
            )
        store.save_features(make_features(date(2026, 10, 1), sleep_intervals=()))
        store.save_features(
            make_features(date(2026, 10, 2), sleep_intervals=TIMELINE, workout_strain={"w2": 9.5})
        )
        store.save_scores(make_scores(date(2026, 10, 2)))
    return path


def get(db_path, target: str, authorization: str | None = AUTH, method: str = "GET") -> Response:
    return respond(method, target, authorization, db_path=db_path, token=TOKEN, timezone=TIMEZONE)


def test_health_needs_no_token(db_path):
    assert get(db_path, "/health", authorization=None) == Response(200, {"status": "ok"})


@pytest.mark.parametrize(
    "authorization",
    [None, "", "Bearer", "Bearer wrong", f"Basic {TOKEN}", TOKEN, f"Bearer {TOKEN}x"],
)
def test_days_reject_a_missing_or_wrong_token(db_path, authorization):
    assert get(db_path, "/v1/days", authorization) == Response(401, {"error": "unauthorized"})


def test_days_default_to_everything_stored(db_path):
    response = get(db_path, "/v1/days")

    assert response.status == 200
    body = response.body
    assert json.loads(json.dumps(body)) == body
    assert body["timezone"] == TIMEZONE
    assert body["first_day"] == "2026-10-01"
    assert body["last_day"] == "2026-10-03"
    assert body["synced_at"] == "2026-10-03T03:00:00+00:00"
    assert [d["day"] for d in body["days"]] == ["2026-10-01", "2026-10-02", "2026-10-03"]
    assert [d["steps"] for d in body["days"]] == [1000, 2000, 3000]


def test_a_day_carries_every_stored_field_and_its_workouts(db_path):
    body = get(db_path, "/v1/days?from=2026-10-02&to=2026-10-02").body

    (day,) = body["days"]
    stored = {f.name for f in fields(DayResult)}
    assert set(day) == stored | {"scores", "sleep_timeline"}
    assert day["complete"] is True
    assert day["steps_source"] == "samsung_health_total"
    assert day["total_kcal_est"] == 2550.5
    assert day["sleep_start"] == "2026-10-11T22:00:00+00:00"
    workout, _ = day["workouts"]
    assert workout["id"] == "w2"
    assert workout["day"] == "2026-10-02"
    assert workout["start"] == "2026-10-12T16:30:00+00:00"
    assert workout["duration_s"] == 3600
    assert workout["kcal_est"] == 812.5


def test_a_day_carries_its_scores_or_null_before_it_is_scored(db_path):
    body = get(db_path, "/v1/days").body

    scored, unscored = body["days"][1], body["days"][2]
    assert scored["scores"] == jsonable(make_scores(date(2026, 10, 2)))
    assert scored["scores"]["day"] == "2026-10-02"
    assert scored["scores"]["cardio_load"]["status"] == "productive"
    assert scored["scores"]["whoop_age"] == {
        "value": 15.2,
        "components": {"steps": -0.5, "vo2max": None},
        "note": "estimate",
    }
    assert unscored["scores"] is None


def test_a_day_carries_its_sleep_timeline(db_path):
    body = get(db_path, "/v1/days").body

    assert body["days"][1]["sleep_timeline"] == [
        {
            "start": "2026-10-01T21:00:00+00:00",
            "end": "2026-10-02T01:00:00+00:00",
            "stage": "light",
        },
        {
            "start": "2026-10-02T01:00:00+00:00",
            "end": "2026-10-02T01:05:00+00:00",
            "stage": "awake",
        },
        {
            "start": "2026-10-02T13:00:00+00:00",
            "end": "2026-10-02T13:30:00+00:00",
            "stage": "asleep",
        },
    ]
    # Features without sleep, and a day without features at all.
    assert body["days"][0]["sleep_timeline"] == []
    assert body["days"][2]["sleep_timeline"] == []


def test_workouts_carry_their_strain_or_null(db_path):
    body = get(db_path, "/v1/days?from=2026-10-02&to=2026-10-02").body

    scored, unscored = body["days"][0]["workouts"]
    assert scored["strain"] == 9.5
    assert unscored["strain"] is None


def test_a_database_from_before_scores_still_serves_its_days(db_path):
    with sqlite3.connect(db_path) as db:
        db.execute("DROP TABLE day_features")
        db.execute("DROP TABLE day_scores")
    db.close()

    body = get(db_path, "/v1/days").body

    assert [d["steps"] for d in body["days"]] == [1000, 2000, 3000]
    assert [d["scores"] for d in body["days"]] == [None, None, None]
    assert [d["sleep_timeline"] for d in body["days"]] == [[], [], []]
    assert [w["strain"] for w in body["days"][1]["workouts"]] == [None, None]


def test_range_is_inclusive_and_the_span_still_describes_the_whole_database(db_path):
    body = get(db_path, "/v1/days?from=2026-10-02&to=2026-10-03").body

    assert [d["day"] for d in body["days"]] == ["2026-10-02", "2026-10-03"]
    assert body["first_day"] == "2026-10-01"


def test_an_open_ended_range_ends_at_the_last_stored_day(db_path):
    body = get(db_path, "/v1/days?from=2026-10-03").body

    assert [d["day"] for d in body["days"]] == ["2026-10-03"]


def test_default_range_is_capped(db_path):
    oldest = date(2026, 10, 3) - timedelta(days=MAX_DAYS)
    with Store(db_path) as store:
        store.save_day(make_day(oldest, steps=1))
        store.save_day(make_day(oldest + timedelta(days=1), steps=2))

    body = get(db_path, "/v1/days").body

    assert len(body["days"]) == 4
    assert body["days"][0]["steps"] == 2
    assert body["first_day"] == oldest.isoformat()


@pytest.mark.parametrize(
    "query",
    [
        "from=yesterday",
        "to=2026-13-01",
        "from=2026-10-03&to=2026-10-02",
        "from=2025-01-01&to=2026-10-03",
    ],
)
def test_bad_ranges_are_rejected(db_path, query):
    response = get(db_path, f"/v1/days?{query}")

    assert response.status == 400
    assert set(response.body) == {"error"}


def test_unknown_paths_and_methods(db_path):
    assert get(db_path, "/v1/nothing").status == 404
    assert get(db_path, "/").status == 404
    assert get(db_path, "/v1/days", method="POST").status == 405
    assert get(db_path, "/health", method="DELETE").status == 405


def test_missing_database_is_unavailable_and_stays_missing(tmp_path):
    path = tmp_path / "data" / "owi.db"

    assert get(path, "/v1/days") == Response(503, {"error": "no data yet"})
    assert not path.parent.exists()


def test_empty_database_returns_no_days(tmp_path):
    path = tmp_path / "owi.db"
    Store(path).close()

    assert get(path, "/v1/days") == Response(
        200,
        {"timezone": TIMEZONE, "first_day": None, "last_day": None, "synced_at": None, "days": []},
    )


@pytest.fixture
def base_url(db_path):
    server = make_server("127.0.0.1", 0, db_path=db_path, token=TOKEN, timezone=TIMEZONE)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def test_served_over_http(base_url):
    response = httpx.get(f"{base_url}/v1/days?from=2026-10-02", headers={"Authorization": AUTH})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"
    assert [d["day"] for d in response.json()["days"]] == ["2026-10-02", "2026-10-03"]


def test_http_errors_are_json(base_url):
    unauthorized = httpx.get(f"{base_url}/v1/days")
    not_allowed = httpx.post(f"{base_url}/v1/days", headers={"Authorization": AUTH})

    assert (unauthorized.status_code, unauthorized.json()) == (401, {"error": "unauthorized"})
    assert unauthorized.headers["www-authenticate"] == "Bearer"
    assert (not_allowed.status_code, not_allowed.json()) == (405, {"error": "method not allowed"})


@pytest.mark.parametrize("token", [None, "short"])
def test_serve_refuses_to_start_without_a_long_token(tmp_path, monkeypatch, capsys, token):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("OWI_SERVE_TOKEN", raising=False)
    if token is not None:
        monkeypatch.setenv("OWI_SERVE_TOKEN", token)

    assert cli.main(["serve", "--port", "0"]) == 1
    assert "OWI_SERVE_TOKEN" in capsys.readouterr().err
