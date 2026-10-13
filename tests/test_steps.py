from datetime import date
from zoneinfo import ZoneInfo

from owi.models import HEART_RATE, STEPS
from owi.steps import PHONE, SAMSUNG_HEALTH_TOTAL, SAMSUNG_HOURLY, StepsChoice, select_steps
from tests.factories import HC_PHONE, HC_SHEALTH, SAMSUNG_PHONE, sample, utc

TZ = ZoneInfo("Europe/Bratislava")
DAY = date(2026, 10, 12)
START = utc(2026, 10, 11, 22)
END = utc(2026, 10, 12, 22)


def select(samples):
    return select_steps(samples, DAY, TZ, START, END)


def test_no_step_samples_gives_none():
    assert select([sample(START, HEART_RATE, 60)]) is None


def test_samsung_health_daily_total_wins_over_the_phone_counter():
    samples = [
        sample(START, STEPS, 20000, HC_SHEALTH),
        sample(utc(2026, 10, 12, 8), STEPS, 5000, HC_PHONE),
        sample(utc(2026, 10, 12, 9), STEPS, 3000, HC_PHONE),
    ]

    assert select(samples) == StepsChoice(20000, SAMSUNG_HEALTH_TOTAL)


def test_total_stamped_at_the_window_end_belongs_to_the_next_day():
    samples = [
        sample(END, STEPS, 9999, HC_SHEALTH),
        sample(utc(2026, 10, 12, 8), STEPS, 100, HC_PHONE),
    ]

    assert select(samples) == StepsChoice(100, PHONE)


def test_samsung_hourly_sum_is_used_when_higher_than_the_phone():
    samples = [
        sample(utc(2026, 10, 12, 5), STEPS, 1000, SAMSUNG_PHONE),
        sample(utc(2026, 10, 12, 6), STEPS, 500, SAMSUNG_PHONE),
        sample(utc(2026, 10, 12, 7), STEPS, 200, HC_PHONE),
    ]

    assert select(samples) == StepsChoice(1500, SAMSUNG_HOURLY)


def test_higher_candidate_beats_a_partial_daily_total():
    samples = [
        sample(START, STEPS, 300, HC_SHEALTH),
        sample(utc(2026, 10, 12, 8), STEPS, 764, HC_PHONE),
    ]

    assert select(samples) == StepsChoice(764, PHONE)


def test_a_tie_prefers_the_samsung_health_total():
    samples = [
        sample(START, STEPS, 500, HC_SHEALTH),
        sample(utc(2026, 10, 12, 8), STEPS, 500, HC_PHONE),
    ]

    assert select(samples) == StepsChoice(500, SAMSUNG_HEALTH_TOTAL)


def test_summed_sources_only_count_samples_inside_the_window():
    samples = [
        sample(utc(2026, 10, 11, 21, 59), STEPS, 400, HC_PHONE),
        sample(END, STEPS, 400, HC_PHONE),
        sample(utc(2026, 10, 12, 12), STEPS, 50, HC_PHONE),
    ]

    assert select(samples) == StepsChoice(50, PHONE)


def test_several_totals_for_one_day_use_the_highest():
    samples = [
        sample(START, STEPS, 1000, HC_SHEALTH),
        sample(utc(2026, 10, 11, 22, 0, 30), STEPS, 1200, HC_SHEALTH),
    ]

    assert select(samples) == StepsChoice(1200, SAMSUNG_HEALTH_TOTAL)
