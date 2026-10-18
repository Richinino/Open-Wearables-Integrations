from datetime import UTC, date

import httpx
import pytest

from owi.client import OWClient, OWError
from owi.models import SleepInterval, SleepSession
from tests.factories import utc

SOURCE = {
    "provider": "Google",
    "source": "com.sec.android.app.shealth",
    "device": None,
    "device_type": None,
    "device_name": None,
}
LAST_PAGE = {"next_cursor": None, "has_more": False}


def make_client(handler) -> OWClient:
    return OWClient("http://ow.test/", "key-123", transport=httpx.MockTransport(handler))


def test_user_id_returns_the_single_user():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/users"
        assert request.headers["X-Open-Wearables-API-Key"] == "key-123"
        return httpx.Response(200, json={"items": [{"id": "u1"}]})

    assert make_client(handler).user_id() == "u1"


@pytest.mark.parametrize("items", [[], [{"id": "a"}, {"id": "b"}]])
def test_user_id_requires_exactly_one_user(items):
    client = make_client(lambda request: httpx.Response(200, json={"items": items}))

    with pytest.raises(OWError, match="OWI_USER_ID"):
        client.user_id()


def test_timeseries_follows_the_cursor_and_parses_samples():
    calls: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url)
        if "cursor" not in request.url.params:
            item = {
                "timestamp": "2026-10-11T22:00:00Z",
                "type": "steps",
                "value": 20000.0,
                "source": SOURCE,
            }
            page = {"next_cursor": "abc", "has_more": True}
        else:
            item = {
                "timestamp": "2026-10-12T07:30:00+02:00",
                "type": "energy",
                "value": 1.5,
                "source": None,
            }
            page = LAST_PAGE
        return httpx.Response(200, json={"data": [item], "pagination": page})

    samples = make_client(handler).timeseries(
        "u1", ["steps", "energy"], utc(2026, 10, 11, 22), utc(2026, 10, 12, 22)
    )

    assert [s.type for s in samples] == ["steps", "active_energy"]
    assert samples[0].timestamp == utc(2026, 10, 11, 22)
    assert samples[0].value == 20000.0
    assert samples[0].source.provider == "google"
    assert samples[0].source.is_samsung_health_app
    assert samples[1].timestamp == utc(2026, 10, 12, 5, 30)
    assert samples[1].source.provider == "unknown"

    first = calls[0]
    assert first.path == "/api/v1/users/u1/timeseries"
    assert first.params["start_time"] == "2026-10-11T22:00:00Z"
    assert first.params["end_time"] == "2026-10-12T22:00:00Z"
    assert first.params.get_list("types") == ["steps", "energy"]
    assert first.params["limit"] == "100"
    assert calls[1].params["cursor"] == "abc"
    assert len(calls) == 2


def test_workouts_are_parsed():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/users/u1/events/workouts"
        assert request.url.params["start_date"] == "2026-10-11T22:00:00Z"
        assert request.url.params["end_date"] == "2026-10-12T22:00:00Z"
        item = {
            "id": "w1",
            "type": "running",
            "start_time": "2026-10-12T16:30:00Z",
            "end_time": "2026-10-12T17:30:00Z",
            "source": SOURCE,
            "distance_meters": None,
            "calories_kcal": None,
        }
        return httpx.Response(200, json={"data": [item], "pagination": LAST_PAGE})

    (workout,) = make_client(handler).workouts("u1", utc(2026, 10, 11, 22), utc(2026, 10, 12, 22))

    assert workout.id == "w1"
    assert workout.type == "running"
    assert workout.start == utc(2026, 10, 12, 16, 30)
    assert workout.end == utc(2026, 10, 12, 17, 30)
    assert workout.source.is_samsung_health_app
    assert workout.distance_m is None


def test_sleep_sessions_are_parsed():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/users/u1/events/sleep"
        # Open Wearables 0.10+ sends the stage intervals only when asked for them.
        assert request.url.params.get_list("include") == ["stages"]
        item = {
            "id": "s1",
            "start_time": "2026-10-11T22:00:00Z",
            "end_time": "2026-10-12T05:00:00Z",
            "source": SOURCE,
            "sleep_duration_seconds": 24000,
            "stages": {
                "awake_minutes": 20,
                "light_minutes": 220,
                "deep_minutes": 90,
                "rem_minutes": 70,
            },
        }
        return httpx.Response(200, json={"data": [item], "pagination": LAST_PAGE})

    (session,) = make_client(handler).sleeps("u1", utc(2026, 10, 10, 22), utc(2026, 10, 12, 22))

    assert session.id == "s1"
    assert session.start == utc(2026, 10, 11, 22)
    assert session.end == utc(2026, 10, 12, 5)
    assert session.sleep_minutes == 400.0
    assert (session.deep_minutes, session.rem_minutes) == (90, 70)
    assert (session.light_minutes, session.awake_minutes) == (220, 20)
    assert session.is_nap is False


def test_sleep_without_stage_summary_has_no_stage_minutes():
    def handler(request: httpx.Request) -> httpx.Response:
        item = {
            "id": "s2",
            "start_time": "2026-10-12T12:00:00Z",
            "end_time": "2026-10-12T12:30:00Z",
            "source": SOURCE,
            "is_nap": True,
        }
        return httpx.Response(200, json={"data": [item], "pagination": LAST_PAGE})

    (session,) = make_client(handler).sleeps("u1", utc(2026, 10, 11, 22), utc(2026, 10, 12, 22))

    assert session.sleep_minutes is None
    assert session.deep_minutes is None
    assert session.is_nap is True
    assert session.intervals == ()


def sleep_with_intervals(intervals) -> SleepSession:
    def handler(request: httpx.Request) -> httpx.Response:
        item = {
            "id": "s3",
            "start_time": "2026-10-11T21:50:00Z",
            "end_time": "2026-10-12T05:00:00Z",
            "source": SOURCE,
            "sleep_stage_intervals": intervals,
        }
        return httpx.Response(200, json={"data": [item], "pagination": LAST_PAGE})

    (session,) = make_client(handler).sleeps("u1", utc(2026, 10, 10, 22), utc(2026, 10, 12, 22))
    return session


def stage_interval(start: str, end: str, stage: str | None) -> dict:
    return {"start_time": start, "end_time": end, "stage": stage}


def test_sleep_stage_intervals_are_parsed_in_utc_and_sorted():
    session = sleep_with_intervals(
        [
            stage_interval("2026-10-12T01:00:00+02:00", "2026-10-12T01:40:00+02:00", "deep"),
            stage_interval("2026-10-11T21:50:00Z", "2026-10-11T22:00:00Z", "in_bed"),
            stage_interval("2026-10-11T22:00:00Z", "2026-10-11T23:00:00Z", "light"),
        ]
    )

    assert session.intervals == (
        SleepInterval(utc(2026, 10, 11, 21, 50), utc(2026, 10, 11, 22), "awake"),
        SleepInterval(utc(2026, 10, 11, 22), utc(2026, 10, 11, 23), "light"),
        SleepInterval(utc(2026, 10, 11, 23), utc(2026, 10, 11, 23, 40), "deep"),
    )
    assert session.intervals[0].start.tzinfo == UTC


@pytest.mark.parametrize(
    ("raw", "stage"),
    [
        ("deep", "deep"),
        ("rem", "rem"),
        ("light", "light"),
        ("awake", "awake"),
        ("in_bed", "awake"),
        ("out_of_bed", "awake"),
        ("sleeping", "asleep"),
        ("unknown", "asleep"),
        ("restless", "asleep"),
        ("DEEP", "deep"),
        (None, "asleep"),
    ],
)
def test_sleep_stages_are_normalised(raw, stage):
    session = sleep_with_intervals(
        [stage_interval("2026-10-11T22:00:00Z", "2026-10-11T23:00:00Z", raw)]
    )

    assert [interval.stage for interval in session.intervals] == [stage]


@pytest.mark.parametrize("intervals", [None, []])
def test_sleep_without_stage_intervals_has_an_empty_timeline(intervals):
    assert sleep_with_intervals(intervals).intervals == ()


def health_score(id_: str, value: float | None, recorded_at: str, event: str | None) -> dict:
    return {
        "category": "sleep",
        "value": value,
        "qualifier": None,
        "recorded_at": recorded_at,
        "zone_offset": "+02:00",
        "components": None,
        "id": id_,
        "data_source_id": "ds1",
        "provider": "samsung",
        "event_record_id": event,
    }


def test_health_scores_follow_the_offset_and_are_parsed():
    calls: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url)
        if request.url.params["offset"] == "0":
            items = [
                health_score("h1", 84.0, "2026-10-11T22:15:00Z", "s1"),
                health_score("h2", None, "2026-10-12T12:00:00Z", None),
            ]
            page = {"has_more": True, "total_count": 3}
        else:
            items = [health_score("h3", 71.0, "2026-10-12T23:10:00+02:00", None)]
            page = {"has_more": False, "total_count": 3}
        return httpx.Response(200, json={"data": items, "pagination": page})

    scores = make_client(handler).health_scores(
        "u1", "sleep", "samsung", date(2026, 10, 10), date(2026, 10, 14)
    )

    assert [(s.id, s.value, s.event_record_id) for s in scores] == [
        ("h1", 84.0, "s1"),
        ("h3", 71.0, None),
    ]
    assert scores[0].recorded_at == utc(2026, 10, 11, 22, 15)
    assert scores[1].recorded_at == utc(2026, 10, 12, 21, 10)
    assert (scores[0].category, scores[0].provider) == ("sleep", "samsung")
    first = calls[0]
    assert first.path == "/api/v1/users/u1/health-scores"
    assert first.params["start_date"] == "2026-10-10"
    assert first.params["end_date"] == "2026-10-14"
    assert first.params["category"] == "sleep"
    assert first.params["provider"] == "samsung"
    assert first.params["limit"] == "100"
    # The next page starts after every item of the first, also the one without a value.
    assert calls[1].params["offset"] == "2"
    assert len(calls) == 2


def test_http_error_becomes_ow_error():
    client = make_client(lambda request: httpx.Response(500, json={"detail": "boom"}))

    with pytest.raises(OWError, match="timeseries"):
        client.timeseries("u1", ["steps"], utc(2026, 10, 11, 22), utc(2026, 10, 12, 22))


def test_connection_failure_becomes_ow_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(OWError):
        make_client(handler).user_id()
