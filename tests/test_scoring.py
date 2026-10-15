from dataclasses import replace
from datetime import date, timedelta
from statistics import fmean

import pytest

from owi import activity_score, load, longterm, readiness, scoring, sleep_scores
from owi.models import DEFAULT_MAX_HR
from owi.score_models import MALE, CardioLoad, DayFeatures, DayScores, Person, Score
from owi.scoring import person_for, rescore, score_day
from owi.store import Store
from tests.factories import make_features, make_scores
from tests.test_store import make_day

TIMEZONE = "Europe/Bratislava"
D = date(2026, 10, 14)
TEEN = Person(age=17, sex=MALE, weight_kg=70.0, max_hr=200.0)


def days_before(last: date, count: int) -> list[date]:
    """`count` consecutive days ending on `last`, oldest first."""
    return [last - timedelta(days=count - 1 - i) for i in range(count)]


def history(count: int = 40, last: date = D, **fields: object) -> list[DayFeatures]:
    return [make_features(day, **fields) for day in days_before(last, count)]


def with_day(days: list[DayFeatures], day: date, **fields: object) -> list[DayFeatures]:
    return [replace(item, **fields) if item.day == day else item for item in days]


# score_day


def test_day_values_come_from_the_days_features():
    days = with_day(history(), D, strain=14.5, vo2max=51.0, resting_hr=45.0, awake_rest_hr=60.0)

    scores = score_day(days, [], TEEN, TIMEZONE)

    assert scores.day == D
    assert scores.strain == 14.5
    assert scores.vo2max == 51.0
    # Uth-Sorensen from the awake resting heart rate, not the sleeping minimum.
    assert scores.vo2max_uth == pytest.approx(15.3 * 200.0 / 60.0)


def test_a_finished_day_worn_too_little_has_no_strain_or_activity():
    previous = [make_scores(D - timedelta(days=1), sleep_need_minutes=530.0)]
    days = with_day(history(), D, wear_minutes=999)

    scores = score_day(days, previous, TEEN, TIMEZONE)

    assert scores.strain is None
    assert scores.activity == Score(None, note="too little wear")
    parts = [scores.readiness.value, scores.sleep_performance.value]
    assert scores.day_score == pytest.approx(round(fmean(parts), 1))


def test_today_keeps_its_strain_and_activity_while_it_is_still_running():
    days = with_day(history(), D, wear_minutes=300, complete=False)

    scores = score_day(days, [], TEEN, TIMEZONE)

    assert scores.strain == days[-1].strain
    assert scores.activity.value is not None


def test_vo2max_uth_needs_a_max_hr():
    scores = score_day(history(), [], replace(TEEN, max_hr=None), TIMEZONE)

    assert scores.vo2max_uth is None


def test_cardio_load_counts_calendar_days_and_unmeasured_days_as_unknown():
    missing, barely_worn = D - timedelta(days=10), D - timedelta(days=3)
    days = [
        replace(item, trimp=100.0 if index >= 33 else 50.0)
        for index, item in enumerate(history())
        if item.day != missing
    ]
    days = with_day(days, barely_worn, wear_minutes=999)
    expected_trimp: list[float | None] = [50.0] * 21 + [100.0] * 7
    expected_trimp[-11] = None
    expected_trimp[-4] = None

    scores = score_day(days, [], TEEN, TIMEZONE)

    assert scores.cardio_load == load.cardio_load(expected_trimp, False)
    assert scores.cardio_load.strain_7d == pytest.approx(100.0)
    assert scores.cardio_load.status == "overreaching"


def test_cardio_load_needs_28_days():
    scores = score_day(history(27), [], TEEN, TIMEZONE)

    assert scores.cardio_load == CardioLoad(None, None, None, None)


@pytest.mark.parametrize(("days_ago", "status"), [(14, "recovering"), (15, "detraining")])
def test_low_load_after_overreaching_in_the_last_14_days_is_recovery(days_ago, status):
    days = [
        replace(item, trimp=20.0 if index >= 33 else 100.0) for index, item in enumerate(history())
    ]
    overreached = make_scores(
        D - timedelta(days=days_ago), cardio_load=CardioLoad(1.0, 1.0, 1.5, "overreaching")
    )

    scores = score_day(days, [overreached], TEEN, TIMEZONE)

    assert scores.cardio_load.status == status


def test_sleep_need_and_performance_use_the_need_stored_the_day_before():
    days = history()
    previous = [
        make_scores(D - timedelta(days=2), sleep_need_minutes=999.0),
        make_scores(D - timedelta(days=1), sleep_need_minutes=530.0),
    ]

    scores = score_day(days, previous, TEEN, TIMEZONE)

    assert scores.sleep_need_minutes == sleep_scores.sleep_need_minutes(days, TEEN, 530.0)
    assert scores.sleep_performance == sleep_scores.sleep_performance(days, 530.0, TIMEZONE)
    assert scores.sleep_performance.value is not None


def test_without_yesterdays_scores_there_is_no_sleep_performance():
    days = history()
    previous = [make_scores(D - timedelta(days=2), sleep_need_minutes=530.0)]

    scores = score_day(days, previous, TEEN, TIMEZONE)

    assert scores.sleep_need_minutes == sleep_scores.sleep_need_minutes(days, TEEN, None)
    assert scores.sleep_performance.value is None


def test_sleep_readiness_activity_night_and_age_scores_are_wired_through():
    days = history(60)

    scores = score_day(days, [], TEEN, TIMEZONE)

    regularity = sleep_scores.sleep_regularity_index(days, TIMEZONE)
    ready = readiness.readiness(days, TEEN, regularity)
    assert scores.apple_sleep == sleep_scores.apple_sleep_score(days, TIMEZONE)
    assert scores.sleep_regularity == regularity
    assert scores.readiness == ready
    assert scores.activity == activity_score.activity_score(days, TEEN, ready.value)
    assert scores.night_signal == readiness.night_signal(days)
    assert scores.whoop_age == longterm.whoop_age(days, TEEN)
    assert regularity is not None
    assert ready.value is not None


def test_day_score_is_the_mean_of_the_available_scores():
    previous = [make_scores(D - timedelta(days=1), sleep_need_minutes=530.0)]

    scores = score_day(history(), previous, TEEN, TIMEZONE)

    parts = [scores.readiness.value, scores.sleep_performance.value, scores.activity.value]
    assert None not in parts
    assert scores.day_score == pytest.approx(round(fmean(parts), 1))


def test_day_score_leaves_out_missing_scores():
    scores = score_day(history(10), [], TEEN, TIMEZONE)

    assert scores.readiness.value is None
    assert scores.sleep_performance.value is None
    assert scores.day_score == scores.activity.value


def test_day_score_is_none_without_any_score():
    empty = DayFeatures(
        day=D,
        complete=True,
        wear_minutes=0,
        resting_hr=None,
        sleep_rhr=None,
        sleep_hr_low_at=None,
        night_hr=None,
        max_hr_seen=None,
        trimp=None,
        strain_load=None,
        strain=None,
    )

    scores = score_day([empty], [], replace(TEEN, weight_kg=None), TIMEZONE)

    assert (scores.readiness.value, scores.sleep_performance.value) == (None, None)
    assert scores.activity.value is None
    assert scores.day_score is None


def test_a_red_night_signal_caps_the_day_score_at_50():
    days = history(night_hr=50.0)
    days = with_day(days, D - timedelta(days=1), night_hr=58.0)
    days = with_day(days, D, night_hr=58.0)
    previous = [make_scores(D - timedelta(days=1), sleep_need_minutes=530.0)]

    scores = score_day(days, previous, TEEN, TIMEZONE)

    parts = [scores.readiness.value, scores.sleep_performance.value, scores.activity.value]
    assert scores.night_signal.level == "red"
    assert fmean(v for v in parts if v is not None) > 50
    assert scores.day_score == 50.0


# person_for


def test_person_takes_the_latest_known_weight_and_body_fat():
    days = history(5, weight_kg=None, body_fat_pct=None)
    days = with_day(days, D - timedelta(days=3), weight_kg=68.0, body_fat_pct=16.0)
    days = with_day(days, D - timedelta(days=1), weight_kg=69.0)

    person = person_for(Person(age=17, sex=MALE), days, 195.0)

    assert person == Person(age=17, sex=MALE, weight_kg=69.0, body_fat_pct=16.0, max_hr=195.0)


def test_person_without_known_body_values_keeps_the_base_ones():
    base = Person(age=17, sex=MALE, weight_kg=60.0, body_fat_pct=12.0)

    person = person_for(base, history(3, weight_kg=None, body_fat_pct=None), 195.0)

    assert person == replace(base, max_hr=195.0)


# rescore


@pytest.fixture
def store(tmp_path):
    with Store(tmp_path / "owi.db") as opened:
        yield opened


def save_history(store: Store, days: list[DayFeatures]) -> None:
    for features in days:
        store.save_features(features)


def test_rescore_scores_every_stored_day_in_the_range(store):
    days = [item for item in history(40) if item.day != D - timedelta(days=5)]
    save_history(store, days)

    count = rescore(store, D - timedelta(days=9), D, Person(age=17, sex=MALE), TIMEZONE)

    scored = store.scores(D - timedelta(days=40), D)
    assert count == 9
    assert [s.day for s in scored] == [d.day for d in days[-9:]]


def test_rescore_matches_score_day_and_chains_the_sleep_need(store):
    days = history(40)
    save_history(store, days)
    store.save_scores(make_scores(D - timedelta(days=3), sleep_need_minutes=600.0))
    base = Person(age=17, sex=MALE, max_hr=200.0)

    rescore(store, D - timedelta(days=2), D, base, TIMEZONE)

    first, second, third = store.scores(D - timedelta(days=2), D)
    person = person_for(base, days, 200.0)
    stored = [store.get_scores(D - timedelta(days=3))]
    assert first == score_day(days[:-2], stored, person, TIMEZONE)
    assert second == score_day(days[:-1], [*stored, first], person, TIMEZONE)
    assert third == score_day(days, [*stored, first, second], person, TIMEZONE)
    assert second.sleep_performance == sleep_scores.sleep_performance(
        days[:-1], first.sleep_need_minutes, TIMEZONE
    )


def test_rescore_passes_at_most_180_days_and_the_scores_of_the_last_14(store, monkeypatch):
    seen: list[tuple[list[DayFeatures], list[DayScores]]] = []
    real = scoring.score_day

    def spy(history, previous, person, timezone):
        seen.append((list(history), list(previous)))
        return real(history, previous, person, timezone)

    save_history(store, history(200))
    for day in days_before(D - timedelta(days=1), 20):
        store.save_scores(make_scores(day))
    monkeypatch.setattr(scoring, "score_day", spy)

    rescore(store, D, D, Person(age=17), TIMEZONE)

    ((passed, previous),) = seen
    assert (passed[0].day, passed[-1].day, len(passed)) == (D - timedelta(days=179), D, 180)
    assert [s.day for s in previous] == days_before(D - timedelta(days=1), 14)


def test_rescore_uses_the_highest_stored_heart_rate_without_a_set_max(store, monkeypatch):
    people: list[Person] = []
    real = scoring.score_day

    def spy(history, previous, person, timezone):
        people.append(person)
        return real(history, previous, person, timezone)

    save_history(store, history(3))
    store.save_day(make_day(D - timedelta(days=1), hr_max=188.0))
    monkeypatch.setattr(scoring, "score_day", spy)

    rescore(store, D - timedelta(days=2), D, Person(age=17), TIMEZONE)
    rescore(store, D, D, Person(age=17, max_hr=201.0), TIMEZONE)

    assert [p.max_hr for p in people] == [DEFAULT_MAX_HR, 188.0, 188.0, 201.0]
