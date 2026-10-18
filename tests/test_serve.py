import json
import sqlite3
import threading
from dataclasses import fields, replace
from datetime import date, timedelta

import httpx
import pytest

from owi import cli, entries
from owi.calibration import save_params
from owi.models import DayResult, Params, SleepInterval
from owi.serve import MAX_BODY_BYTES, MAX_DAYS, Response, make_server, respond
from owi.store import FitRecord, Store, jsonable
from tests.factories import make_features, make_scores, utc
from tests.test_store import make_day, make_workout

TOKEN = "t" * 40
WRITE_TOKEN = "w" * 40
TIMEZONE = "Europe/Bratislava"
AUTH = f"Bearer {TOKEN}"
WRITE_AUTH = f"Bearer {WRITE_TOKEN}"
# Noon on the last stored day: entries may go from 2026-10-01 to 2026-10-03.
NOW = utc(2026, 10, 3, 10)
ENTRY = {
    "steps": 23588,
    "distance_km": 17.9,
    "active_minutes": 210,
    "active_kcal": 980,
    "total_kcal": 2610,
    "sleep_score": 82,
    "energy_score": 76,
}
DEFAULT_PARAMS = {"stride_m": 0.74, "active_hr_delta": 30.0, "kcal_scale": 1.0, "basal_kcal": None}
NO_CALIBRATION = {
    "fitted_at": None,
    "entries": 0,
    "params": DEFAULT_PARAMS,
    "defaults": DEFAULT_PARAMS,
    "quality": {},
}


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
    return respond(
        method,
        target,
        authorization,
        db_path=db_path,
        token=TOKEN,
        timezone=TIMEZONE,
        write_token=WRITE_TOKEN,
    )


def put(
    db_path,
    day: str,
    body: object = ENTRY,
    authorization: str | None = WRITE_AUTH,
    write_token: str = WRITE_TOKEN,
    raw: bytes | None = None,
) -> Response:
    return respond(
        "PUT",
        f"/v1/entries/{day}",
        authorization,
        db_path=db_path,
        token=TOKEN,
        timezone=TIMEZONE,
        write_token=write_token,
        body=json.dumps(body).encode() if raw is None else raw,
        now=NOW,
    )


def entries_path(db_path):
    return entries.path_in(db_path.parent)


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
    assert set(day) == stored | {"scores", "sleep_timeline", "samsung", "samsung_auto"}
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
        {
            "timezone": TIMEZONE,
            "first_day": None,
            "last_day": None,
            "synced_at": None,
            "days": [],
            "calibration": NO_CALIBRATION,
        },
    )


@pytest.fixture
def base_url(db_path):
    server = make_server(
        "127.0.0.1", 0, db_path=db_path, token=TOKEN, timezone=TIMEZONE, write_token=WRITE_TOKEN
    )
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


def test_compressed_when_the_client_accepts_gzip(base_url):
    # The web fetches every day on each load through the tunnel; gzip makes that ~10x smaller.
    url = f"{base_url}/v1/days?from=2026-10-02"
    plain = httpx.get(url, headers={"Authorization": AUTH, "Accept-Encoding": "identity"})
    packed = httpx.get(url, headers={"Authorization": AUTH, "Accept-Encoding": "br, gzip;q=0.8"})
    refused = httpx.get(url, headers={"Authorization": AUTH, "Accept-Encoding": "gzip;q=0"})

    assert "content-encoding" not in plain.headers
    assert packed.headers["content-encoding"] == "gzip"
    assert packed.headers["vary"] == "Accept-Encoding"
    assert int(packed.headers["content-length"]) < len(plain.content)
    assert packed.json() == plain.json()
    assert "content-encoding" not in refused.headers


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


def test_put_without_a_body_or_with_too_large_a_body_over_http(base_url):
    url = f"{base_url}/v1/entries/2026-10-02"
    headers = {"Authorization": WRITE_AUTH}
    empty = httpx.put(url, headers=headers)
    large = httpx.put(url, headers=headers, content=b" " * (MAX_BODY_BYTES + 1))

    assert (empty.status_code, empty.json()["fields"]) == (400, {"body": "objekt JSON"})
    assert (large.status_code, large.json()) == (413, {"error": "body too large"})


def test_entries_are_written_over_http(base_url, db_path):
    response = httpx.put(
        f"{base_url}/v1/entries/2026-10-02",
        headers={"Authorization": WRITE_AUTH, "Accept-Encoding": "gzip"},
        json={**ENTRY, "steps": 1234},
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["steps"] == 1234
    assert entries.load(entries_path(db_path))[0].steps == 1234


# PUT /v1/entries/{day}


def test_an_entry_is_saved_and_returned(db_path):
    response = put(db_path, "2026-10-02")

    assert response == Response(
        200,
        {
            "day": "2026-10-02",
            "steps": 23588,
            "distance_km": 17.9,
            "active_minutes": 210.0,
            "active_kcal": 980.0,
            "total_kcal": 2610.0,
            "sleep_score": 82.0,
            "energy_score": 76.0,
            "saved_at": NOW.isoformat(),
        },
    )
    (saved,) = entries.load(entries_path(db_path))
    assert entries.as_json(saved) == response.body


def test_missing_fields_are_saved_as_null(db_path):
    response = put(db_path, "2026-10-02", {"sleep_score": 70})

    assert response.status == 200
    assert response.body["sleep_score"] == 70.0
    assert response.body["steps"] is None


def test_all_fields_null_deletes_the_entry(db_path):
    put(db_path, "2026-10-02")

    response = put(db_path, "2026-10-02", dict.fromkeys(ENTRY))

    assert response == Response(200, entries.as_json(entries.Entry(date(2026, 10, 2))))
    assert entries.load(entries_path(db_path)) == []


@pytest.mark.parametrize("authorization", [None, "Bearer wrong", AUTH, WRITE_TOKEN])
def test_only_the_write_token_writes(db_path, authorization):
    assert put(db_path, "2026-10-02", authorization=authorization) == Response(
        401, {"error": "unauthorized"}
    )
    assert entries.load(entries_path(db_path)) == []


def test_the_write_token_does_not_read(db_path):
    assert get(db_path, "/v1/days", WRITE_AUTH) == Response(401, {"error": "unauthorized"})


def test_writes_are_unavailable_without_a_write_token(db_path):
    response = put(db_path, "2026-10-02", authorization="Bearer ", write_token="")

    assert response == Response(503, {"error": "writes are disabled"})


def test_invalid_values_and_days_are_named_in_slovak(db_path):
    response = put(db_path, "2026-10-04", {**ENTRY, "sleep_score": 101, "steps": 1.5})

    assert response == Response(
        400,
        {
            "error": "invalid",
            "fields": {"sleep_score": "0–100", "steps": "celé číslo", "day": "mimo rozsahu"},
        },
    )
    assert entries.load(entries_path(db_path)) == []


@pytest.mark.parametrize(
    ("day", "message"),
    [
        ("2026-09-30", "mimo rozsahu"),
        ("2026-10-04", "mimo rozsahu"),
        ("2026-13-01", "RRRR-MM-DD"),
        ("20261002", "RRRR-MM-DD"),
        ("yesterday", "RRRR-MM-DD"),
    ],
)
def test_entries_go_from_the_first_stored_day_to_today(db_path, day, message):
    assert put(db_path, day).body == {"error": "invalid", "fields": {"day": message}}


def test_today_takes_an_entry(db_path):
    assert put(db_path, "2026-10-03").status == 200


def test_a_body_that_is_not_json_is_invalid(db_path):
    response = put(db_path, "2026-10-02", raw=b"{steps:")

    assert response == Response(400, {"error": "invalid", "fields": {"body": "objekt JSON"}})


def test_writing_before_any_day_is_stored_is_unavailable(tmp_path):
    response = put(tmp_path / "missing" / "owi.db", "2026-10-02")

    assert response == Response(503, {"error": "no data yet"})


def test_other_methods_and_paths_of_entries(db_path):
    assert get(db_path, "/v1/entries/2026-10-02").status == 405
    assert get(db_path, "/v1/entries/2026-10-02", method="POST").status == 405
    assert get(db_path, "/v1/days", method="PUT").status == 405
    assert get(db_path, "/v1/entries", method="PUT").status == 405
    assert get(db_path, "/v1/entries/2026-10-02/x", method="PUT").status == 405


# GET /v1/days additions


def test_days_carry_their_samsung_entry_or_null(db_path):
    saved = put(db_path, "2026-10-02").body

    days = get(db_path, "/v1/days").body["days"]

    assert [d["samsung"] for d in days] == [None, saved, None]


def test_days_carry_samsungs_own_numbers_or_null(db_path):
    with Store(db_path) as store:
        store.save_features(
            make_features(
                date(2026, 10, 2),
                samsung_steps=18230,
                samsung_active_kcal=960.0,
                samsung_sleep_score=84.0,
            )
        )
    saved = put(db_path, "2026-10-02").body

    days = get(db_path, "/v1/days").body["days"]

    # Day 1 has features without Samsung's numbers, day 3 no features at all.
    assert [d["samsung_auto"] for d in days] == [
        None,
        {"steps": 18230, "active_kcal": 960.0, "sleep_score": 84.0},
        None,
    ]
    # The user's entry stays apart from them.
    assert days[1]["samsung"] == saved


def test_days_without_an_entries_store_and_a_fit_have_the_empty_calibration(db_path):
    body = get(db_path, "/v1/days").body

    assert body["calibration"] == NO_CALIBRATION
    assert not entries_path(db_path).exists()


def test_days_carry_the_latest_fit_and_the_current_params(db_path):
    quality = {"distance_km": {"n": 5, "error": 4.1, "previous_error": 6.0, "unit": "%"}}
    with Store(db_path) as store:
        store.save_fit(FitRecord(utc(2026, 10, 3, 9, 30), 5, None, {}, quality))
    save_params(db_path.parent / "params.json", Params(stride_m=0.76, max_hr=190.0))

    calibration = get(db_path, "/v1/days").body["calibration"]

    assert calibration == {
        **NO_CALIBRATION,
        "fitted_at": "2026-10-03T09:30:00+00:00",
        "entries": 5,
        "params": {**DEFAULT_PARAMS, "stride_m": 0.76},
        "quality": quality,
    }


def test_scores_carry_the_samsung_estimates(db_path):
    body = get(db_path, "/v1/days?from=2026-10-02&to=2026-10-02").body

    scores = body["days"][0]["scores"]
    assert scores["samsung_sleep"] == {"value": None, "components": {}, "note": None}
    assert "energy_score" in scores


# Startup


@pytest.mark.parametrize("write_token", ["short", TOKEN])
def test_the_server_refuses_a_short_write_token_or_the_read_token(db_path, write_token):
    with pytest.raises(ValueError):
        make_server(
            "127.0.0.1", 0, db_path=db_path, token=TOKEN, timezone=TIMEZONE, write_token=write_token
        )


def test_serve_refuses_a_short_write_token(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("OWI_SERVE_TOKEN", TOKEN)
    monkeypatch.setenv("OWI_WRITE_TOKEN", "short")

    assert cli.main(["serve", "--port", "0"]) == 1
    assert "OWI_WRITE_TOKEN" in capsys.readouterr().err


def test_an_unreadable_params_file_does_not_break_the_days(db_path):
    (db_path.parent / "params.json").write_text('{"stride_m": 0.7', encoding="utf-8")

    response = get(db_path, "/v1/days")

    assert response.status == 200
    assert response.body["calibration"]["params"] == DEFAULT_PARAMS
