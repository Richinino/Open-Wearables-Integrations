from datetime import date
from zoneinfo import ZoneInfo

from owi.days import day_window, elapsed_fraction, local_date, today
from tests.factories import utc

TZ = ZoneInfo("Europe/Bratislava")


def test_window_in_summer_time_starts_two_hours_before_utc_midnight():
    assert day_window(date(2026, 10, 12), TZ) == (utc(2026, 10, 11, 22), utc(2026, 10, 12, 22))


def test_window_has_25_hours_when_clocks_go_back():
    assert day_window(date(2026, 10, 25), TZ) == (utc(2026, 10, 24, 22), utc(2026, 10, 25, 23))


def test_window_has_23_hours_when_clocks_go_forward():
    assert day_window(date(2026, 3, 29), TZ) == (utc(2026, 3, 28, 23), utc(2026, 3, 29, 22))


def test_local_date_changes_at_local_midnight():
    assert local_date(utc(2026, 10, 11, 21, 59), TZ) == date(2026, 10, 11)
    assert local_date(utc(2026, 10, 11, 22), TZ) == date(2026, 10, 12)


def test_today_uses_the_given_instant():
    assert today(TZ, utc(2026, 10, 12, 23, 30)) == date(2026, 10, 13)


def test_elapsed_fraction_is_clamped_to_the_day():
    day = date(2026, 10, 12)

    assert elapsed_fraction(day, TZ, utc(2026, 10, 11, 21)) == 0.0
    assert elapsed_fraction(day, TZ, utc(2026, 10, 12, 10)) == 0.5
    assert elapsed_fraction(day, TZ, utc(2026, 10, 13, 5)) == 1.0
