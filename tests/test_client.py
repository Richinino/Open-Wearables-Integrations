import httpx
import pytest

from owi.client import OWClient, OWError
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


def test_http_error_becomes_ow_error():
    client = make_client(lambda request: httpx.Response(500, json={"detail": "boom"}))

    with pytest.raises(OWError, match="timeseries"):
        client.timeseries("u1", ["steps"], utc(2026, 10, 11, 22), utc(2026, 10, 12, 22))


def test_connection_failure_becomes_ow_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(OWError):
        make_client(handler).user_id()
