from owi.sleep import summarize
from tests.factories import HC_SHEALTH, SAMSUNG_WATCH, sleep_session, utc


def test_no_sessions_gives_none():
    assert summarize([]) is None


def test_longest_session_is_the_main_sleep_and_the_rest_are_naps():
    night = sleep_session("night", utc(2026, 10, 11, 21), utc(2026, 10, 12, 5))
    nap = sleep_session("nap", utc(2026, 10, 12, 13), utc(2026, 10, 12, 13, 30))

    summary = summarize([nap, night])

    assert summary.main == night
    assert summary.nap_minutes == 30


def test_overlapping_sessions_keep_the_health_connect_one():
    health_connect = sleep_session("hc", utc(2026, 10, 11, 21), utc(2026, 10, 12, 5), HC_SHEALTH)
    samsung = sleep_session(
        "samsung", utc(2026, 10, 11, 20, 30), utc(2026, 10, 12, 5, 30), SAMSUNG_WATCH
    )

    summary = summarize([samsung, health_connect])

    assert summary.main == health_connect
    assert summary.nap_minutes == 0


def test_overlapping_sessions_from_one_provider_keep_the_longer():
    short = sleep_session("short", utc(2026, 10, 11, 22), utc(2026, 10, 12, 4))
    long = sleep_session("long", utc(2026, 10, 11, 21), utc(2026, 10, 12, 5))

    summary = summarize([short, long])

    assert summary.main == long
    assert summary.nap_minutes == 0


def test_reported_sleep_minutes_are_preferred_over_the_time_span():
    night = sleep_session("night", utc(2026, 10, 11, 21), utc(2026, 10, 12, 5), sleep_minutes=420)
    nap = sleep_session("nap", utc(2026, 10, 12, 13), utc(2026, 10, 12, 13, 30), sleep_minutes=20)

    summary = summarize([night, nap])

    assert summary.main == night
    assert summary.nap_minutes == 20
