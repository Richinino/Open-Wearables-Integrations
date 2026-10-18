import json
import sqlite3
from datetime import date, timedelta

import pytest

from owi import cli, entries, tuning
from owi.accounts import Accounts, accounts_path
from owi.calibration import day_weight, load_params, save_params
from owi.client import OWError
from owi.models import ACTIVE_ENERGY, STEPS, Params, SourceRef
from owi.store import Store
from owi.users import user_paths
from tests.factories import (
    HC_SHEALTH,
    SAMSUNG_WATCH,
    hr_minutes,
    make_features,
    sample,
    sleep_score,
    sleep_session,
    utc,
)
from tests.fakes import FakeClient

DAY = date(2026, 10, 12)
START = utc(2026, 10, 11, 22)
NOW = utc(2026, 10, 16, 9)
TRUTH_HEADER = "date,steps,active_minutes,activity_kcal,total_kcal,distance_km\n"


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("OWI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("OWI_TIMEZONE", "Europe/Bratislava")
    monkeypatch.setenv("OWI_API_KEY", "test-key")
    for name in (
        "OWI_USER_ID",
        "OWI_MAX_HR",
        "OWI_WEIGHT_KG",
        "OWI_VO2MAX",
        "OWI_BASAL_KCAL",
        "OWI_AGE",
        "OWI_SEX",
        "OWI_SERVE_TOKEN",
        "OWI_WRITE_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


def use_client(monkeypatch, client) -> None:
    monkeypatch.setattr(cli, "OWClient", lambda *args, **kwargs: client)


def at(monkeypatch, moment) -> None:
    monkeypatch.setattr(cli, "_now", lambda: moment)


def write_truth(env, *rows: str) -> None:
    data = env / "data"
    data.mkdir(exist_ok=True)
    (data / "truth.csv").write_text(TRUTH_HEADER + "".join(r + "\n" for r in rows), "utf-8")


def entries_path(env):
    return entries.path_in(env / "data")


def save_entry(env, day: date, saved_at=NOW, **values) -> None:
    entries.save(entries_path(env), day, values, saved_at)


def stride_after_one_entry(stride: float, day: date = DAY, now=NOW) -> float:
    weight = day_weight(day, now.date())
    return 0.74 + weight / (weight + 7) * (stride - 0.74)


def test_sync_stores_the_requested_days(env, monkeypatch, capsys):
    samples = [sample(START, STEPS, 12345, HC_SHEALTH), *hr_minutes(START, [55.0] * 90)]
    use_client(monkeypatch, FakeClient(samples))

    code = cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-12"])

    assert code == 0
    with Store(env / "data" / "owi.db") as store:
        assert store.get_day(DAY).steps == 12345
    assert "2026-10-12" in capsys.readouterr().out


def test_sync_stores_features_and_scores_with_the_profile_from_settings(env, monkeypatch):
    monkeypatch.setenv("OWI_AGE", "17")
    monkeypatch.setenv("OWI_SEX", "male")
    # Worn long enough (1000 minutes) for the finished day to get a strain.
    samples = [sample(START, STEPS, 12345, HC_SHEALTH), *hr_minutes(START, [55.0] * 1000)]
    night = sleep_session("night", utc(2026, 10, 11, 21), utc(2026, 10, 12, 5))
    use_client(monkeypatch, FakeClient(samples, sleeps=[night]))

    assert cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-12"]) == 0

    with Store(env / "data" / "owi.db") as store:
        features = store.get_features(DAY)
        scores = store.get_scores(DAY)
    assert features.steps == 12345
    assert features.sleep_start == utc(2026, 10, 11, 21)
    assert scores.day == DAY
    assert scores.strain == features.strain
    # A 17-year-old's sleep need starts at 8 h (7.5 h for adults); strain 0 adds under a minute.
    assert scores.sleep_need_minutes == pytest.approx(480.0, abs=1.0)


def test_sync_rescores_the_stored_days_after_the_synced_ones(env, monkeypatch, capsys):
    data = env / "data"
    with Store(data / "owi.db") as store:
        store.save_features(make_features(date(2026, 10, 14)))
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 500, HC_SHEALTH)]))

    assert cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-12"]) == 0

    with Store(data / "owi.db") as store:
        assert [s.day for s in store.scores(DAY, date(2026, 10, 31))] == [
            DAY,
            date(2026, 10, 14),
        ]
    assert "počet dní: 2" in capsys.readouterr().out


def test_rescore_recomputes_scores_from_stored_features_only(env, monkeypatch, capsys):
    def no_client(*args, **kwargs):
        raise AssertionError("rescore must not download anything")

    monkeypatch.setattr(cli, "OWClient", no_client)
    with Store(env / "data" / "owi.db") as store:
        for day in (10, 11, 13):
            store.save_features(make_features(date(2026, 10, day), strain=float(day)))

    assert cli.main(["rescore"]) == 0

    with Store(env / "data" / "owi.db") as store:
        scores = store.scores(date(2026, 10, 1), date(2026, 10, 31))
    assert [(s.day.day, s.strain) for s in scores] == [(10, 10.0), (11, 11.0), (13, 13.0)]
    assert "počet dní: 3" in capsys.readouterr().out


def test_rescore_limits_itself_to_the_given_range(env):
    with Store(env / "data" / "owi.db") as store:
        for day in (10, 11, 12, 13):
            store.save_features(make_features(date(2026, 10, day)))

    assert cli.main(["rescore", "--from", "2026-10-11", "--to", "2026-10-12"]) == 0

    with Store(env / "data" / "owi.db") as store:
        scored = [s.day.day for s in store.scores(date(2026, 10, 1), date(2026, 10, 31))]
    assert scored == [11, 12]


def test_rescore_without_stored_features_exits_non_zero(env, capsys):
    assert cli.main(["rescore"]) == 1
    assert "owi sync" in capsys.readouterr().err


def test_sync_skips_past_days_without_data(env, monkeypatch):
    use_client(monkeypatch, FakeClient())

    assert cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-12"]) == 0

    with Store(env / "data" / "owi.db") as store:
        assert store.get_day(DAY) is None


def test_sync_reports_api_failures_with_a_non_zero_exit_code(env, monkeypatch, capsys):
    class Broken(FakeClient):
        def timeseries(self, *args, **kwargs):
            raise OWError("unreachable")

    use_client(monkeypatch, Broken())

    assert cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-12"]) == 1
    assert "unreachable" in capsys.readouterr().err


def test_an_api_failure_part_way_leaves_earlier_days_unsaved(env, monkeypatch):
    class FailsOnSecondDay(FakeClient):
        def workouts(self, user_id, start, end):
            if start >= utc(2026, 10, 12, 22):
                raise OWError("unreachable")
            return super().workouts(user_id, start, end)

    use_client(monkeypatch, FailsOnSecondDay([sample(START, STEPS, 500, HC_SHEALTH)]))

    assert cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-13"]) == 1

    with Store(env / "data" / "owi.db") as store:
        assert store.get_day(DAY) is None


def test_day_prints_json_for_a_stored_day(env, monkeypatch, capsys):
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 777, HC_SHEALTH)]))
    cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-12"])
    capsys.readouterr()

    code = cli.main(["day", "2026-10-12", "--json"])

    assert code == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["day"] == "2026-10-12"
    assert printed["steps"] == 777


def test_day_without_stored_data_exits_non_zero(env, capsys):
    assert cli.main(["day", "2026-10-12"]) == 1
    assert "2026-10-12" in capsys.readouterr().err


def test_calibrate_writes_params_fitted_to_the_entries(env, monkeypatch, capsys):
    at(monkeypatch, NOW)
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 20000, HC_SHEALTH)]))
    save_entry(env, DAY, steps=20000, distance_km=15.0, sleep_score=80.0)

    assert cli.main(["calibrate"]) == 0

    saved = json.loads((env / "data" / "params.json").read_text(encoding="utf-8"))
    assert saved["stride_m"] == pytest.approx(stride_after_one_entry(0.75))
    assert "stride_m" in capsys.readouterr().out
    with Store(env / "data" / "owi.db") as store:
        fit = store.latest_fit()
    assert (fit.fitted_at, fit.entries) == (NOW, 1)
    assert "distance_km" in fit.quality
    weights = json.loads((env / "data" / "score_weights.json").read_text(encoding="utf-8"))
    assert weights["samsung_sleep"]["entries"] == 1


def test_calibrate_records_the_max_hr_it_used_and_later_syncs_reuse_it(env, monkeypatch):
    reference_day = [
        sample(START, STEPS, 20000, HC_SHEALTH),
        *hr_minutes(START, [60.0] * 89 + [170.0]),
    ]
    earlier_day = hr_minutes(utc(2026, 10, 10, 22), [130.0] * 90)
    use_client(monkeypatch, FakeClient([*reference_day, *earlier_day]))
    at(monkeypatch, NOW)
    save_entry(env, DAY, steps=20000, distance_km=15.0)

    assert cli.main(["calibrate"]) == 0
    saved = json.loads((env / "data" / "params.json").read_text(encoding="utf-8"))
    assert saved["max_hr"] == 170.0

    # On its own the earlier day peaks at 130, which would make every minute vigorous.
    assert cli.main(["sync", "--from", "2026-10-11", "--to", "2026-10-11"]) == 0
    with Store(env / "data" / "owi.db") as store:
        earlier = store.get_day(date(2026, 10, 11))
    assert (earlier.zone_moderate_min, earlier.zone_vigorous_min) == (90, 0)


def test_long_ranges_are_synced_in_batches_so_finished_batches_survive_a_failure(env, monkeypatch):
    class FailsLate(FakeClient):
        def workouts(self, user_id, start, end):
            if start >= utc(2026, 10, 20):
                raise OWError("unreachable")
            return super().workouts(user_id, start, end)

    samples = [
        sample(utc(2026, 9, 30, 22), STEPS, 111, HC_SHEALTH),
        sample(utc(2026, 10, 19, 22), STEPS, 222, HC_SHEALTH),
    ]
    use_client(monkeypatch, FailsLate(samples))

    assert cli.main(["sync", "--from", "2026-10-01", "--to", "2026-10-25"]) == 1

    with Store(env / "data" / "owi.db") as store:
        assert store.get_day(date(2026, 10, 1)).steps == 111
        assert store.get_day(date(2026, 10, 20)) is None
        # The finished batch is scored even though a later one failed.
        assert store.get_scores(date(2026, 10, 1)) is not None
        assert store.get_features(date(2026, 10, 20)) is None


def test_calibrate_without_entries_explains_what_is_missing(env, capsys):
    assert cli.main(["calibrate"]) == 1
    err = capsys.readouterr().err
    assert "zapisy.db" in err
    assert "owi entries import" in err


def test_check_prints_estimates_next_to_reference_values(env, monkeypatch, capsys):
    at(monkeypatch, NOW)
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 21000, HC_SHEALTH)]))
    save_entry(env, DAY, steps=20000)

    assert cli.main(["check"]) == 0

    out = capsys.readouterr().out
    assert "steps" in out
    assert "21000" in out
    assert "+5.0" in out


# owi entries import


def test_entries_import_copies_truth_csv_into_the_entries_store(env, monkeypatch, capsys):
    at(monkeypatch, NOW)
    write_truth(env, "2026-10-12,20000,200,950,2400,15.5", "2026-10-11,13000,,,,")

    assert cli.main(["entries", "import"]) == 0

    assert entries.load(entries_path(env)) == [
        entries.Entry(date(2026, 10, 11), steps=13000, saved_at=NOW),
        entries.Entry(
            DAY,
            steps=20000,
            distance_km=15.5,
            active_minutes=200.0,
            active_kcal=950.0,
            total_kcal=2400.0,
            saved_at=NOW,
        ),
    ]
    assert "2" in capsys.readouterr().out


def test_entries_import_keeps_existing_entries_and_skips_invalid_rows(env, monkeypatch, capsys):
    save_entry(env, DAY, sleep_score=80.0)
    other = env / "other.csv"
    other.write_text(
        TRUTH_HEADER + "2026-10-12,20000,,,,\n2026-10-10,500000,,,,\n2026-10-09,,,,,\n",
        encoding="utf-8",
    )

    assert cli.main(["entries", "import", "--path", str(other)]) == 0

    (entry,) = entries.load(entries_path(env))
    assert (entry.steps, entry.sleep_score) == (None, 80.0)
    out = capsys.readouterr().out
    assert "2026-10-12" in out
    assert "2026-10-10" in out


def test_entries_import_without_the_file_fails(env, capsys):
    assert cli.main(["entries", "import"]) == 1
    assert "truth.csv" in capsys.readouterr().err


# Tuning inside owi sync


def stepped_client() -> FakeClient:
    """10 000 steps on 10 and 12 October."""
    return FakeClient(
        [
            sample(utc(2026, 10, 9, 22), STEPS, 10000, HC_SHEALTH),
            sample(START, STEPS, 10000, HC_SHEALTH),
        ]
    )


def sync(*days: str) -> int:
    return cli.main(["sync", "--from", days[0], "--to", days[-1]])


def stored_distance(env, day: date) -> float:
    with Store(env / "data" / "owi.db") as store:
        return store.get_day(day).distance_m_est


def test_sync_creates_the_entries_folder_and_tunes_nothing_without_entries(env, monkeypatch):
    at(monkeypatch, NOW)
    use_client(monkeypatch, stepped_client())

    assert sync("2026-10-12") == 0

    assert entries_path(env).parent.is_dir()
    assert not (env / "data" / "params.json").exists()
    with Store(env / "data" / "owi.db") as store:
        assert store.latest_fit() is None


def test_sync_tunes_on_a_new_entry_and_recomputes_every_stored_day(env, monkeypatch):
    at(monkeypatch, NOW)
    use_client(monkeypatch, stepped_client())
    assert sync("2026-10-10", "2026-10-12") == 0
    assert stored_distance(env, date(2026, 10, 10)) == pytest.approx(7400.0)

    save_entry(env, DAY, steps=10000, distance_km=9.0)
    assert sync("2026-10-12") == 0

    stride = stride_after_one_entry(0.90)
    assert load_params(env / "data" / "params.json").stride_m == pytest.approx(stride)
    assert stored_distance(env, date(2026, 10, 10)) == pytest.approx(10000 * stride)
    with Store(env / "data" / "owi.db") as store:
        assert store.latest_fit().fitted_at == NOW
        computed_with, recomputed_at = store.recompute_state()
    assert computed_with["stride_m"] == pytest.approx(stride)
    assert recomputed_at == NOW


def test_sync_refits_only_after_a_change_or_a_day(env, monkeypatch):
    use_client(monkeypatch, stepped_client())
    save_entry(env, DAY, steps=10000, distance_km=9.0)
    for moment in (NOW, NOW + timedelta(hours=1)):
        at(monkeypatch, moment)
        assert sync("2026-10-12") == 0
    with Store(env / "data" / "owi.db") as store:
        assert store.latest_fit().fitted_at == NOW

    later = NOW + timedelta(hours=2)
    save_entry(env, date(2026, 10, 11), saved_at=later, steps=1000, distance_km=0.8)
    at(monkeypatch, later)
    assert sync("2026-10-12") == 0
    with Store(env / "data" / "owi.db") as store:
        assert store.latest_fit().fitted_at == later

    at(monkeypatch, later + timedelta(hours=24))
    assert sync("2026-10-12") == 0
    with Store(env / "data" / "owi.db") as store:
        assert store.latest_fit().fitted_at == later + timedelta(hours=24)


def test_a_full_recompute_happens_at_most_once_in_24_hours(env, monkeypatch):
    at(monkeypatch, NOW)
    use_client(monkeypatch, stepped_client())
    assert sync("2026-10-10", "2026-10-12") == 0
    with Store(env / "data" / "owi.db") as store:
        stale = tuning.estimate_params(Params())
        store.set_recompute_state(stale, NOW - timedelta(hours=1))

    save_entry(env, DAY, steps=10000, distance_km=9.0)
    assert sync("2026-10-12") == 0
    stride = stride_after_one_entry(0.90)
    assert load_params(env / "data" / "params.json").stride_m == pytest.approx(stride)

    # Until 24 hours have passed only the following syncs use the new stride.
    at(monkeypatch, NOW + timedelta(hours=22))
    assert sync("2026-10-12") == 0
    assert stored_distance(env, DAY) == pytest.approx(10000 * stride)
    assert stored_distance(env, date(2026, 10, 10)) == pytest.approx(7400.0)

    at(monkeypatch, NOW + timedelta(hours=23))
    assert sync("2026-10-12") == 0
    assert stored_distance(env, date(2026, 10, 10)) == pytest.approx(10000 * stride)


def test_new_score_weights_only_rescore_the_stored_days(env, monkeypatch, capsys):
    at(monkeypatch, NOW)
    use_client(monkeypatch, stepped_client())
    with Store(env / "data" / "owi.db") as store:
        store.save_features(make_features(date(2026, 10, 5)))
    assert sync("2026-10-12") == 0
    capsys.readouterr()
    syncs = []
    real = cli._sync_once

    def counting(*args, **kwargs):
        syncs.append(args[1])
        return real(*args, **kwargs)

    monkeypatch.setattr(cli, "_sync_once", counting)
    save_entry(env, DAY, sleep_score=80.0)

    assert sync("2026-10-12") == 0

    assert syncs == [[DAY]]
    assert "skóre prepočítané od 2026-10-05" in capsys.readouterr().out
    assert (
        json.loads((env / "data" / "score_weights.json").read_text("utf-8"))["samsung_sleep"][
            "entries"
        ]
        == 1
    )


def test_calibrate_recomputes_the_stored_days_right_away(env, monkeypatch):
    at(monkeypatch, NOW)
    use_client(monkeypatch, stepped_client())
    assert sync("2026-10-10", "2026-10-12") == 0
    save_params(env / "data" / "params.json", Params())
    save_entry(env, DAY, steps=10000, distance_km=9.0)

    assert cli.main(["calibrate"]) == 0

    stride = stride_after_one_entry(0.90)
    assert stored_distance(env, date(2026, 10, 10)) == pytest.approx(10000 * stride)


# Auto entries: Samsung's own numbers


def samsung_client(late_steps: int = 0) -> FakeClient:
    """Samsung's own steps, active calories and Sleep Score for 12 October."""
    night = sleep_session("night", utc(2026, 10, 11, 21), utc(2026, 10, 12, 5), SAMSUNG_WATCH)
    samples = [
        sample(utc(2026, 10, 12, 7), STEPS, 12000, SAMSUNG_WATCH),
        sample(utc(2026, 10, 12, 8), STEPS, 230, SAMSUNG_WATCH),
        sample(utc(2026, 10, 12, 7), ACTIVE_ENERGY, 600.0, SAMSUNG_WATCH),
        sample(utc(2026, 10, 12, 8), ACTIVE_ENERGY, 360.0, SAMSUNG_WATCH),
        # 21:00 local: the uploads cover the evening, so the sums count as the whole day.
        sample(utc(2026, 10, 12, 19), ACTIVE_ENERGY, 0.0, SAMSUNG_WATCH),
    ]
    if late_steps:
        samples.append(sample(utc(2026, 10, 12, 19), STEPS, late_steps, SAMSUNG_WATCH))
    scores = [sleep_score("h1", 84, utc(2026, 10, 11, 21), "night")]
    return FakeClient(samples, sleeps=[night], health_scores=scores)


def test_sync_stores_samsungs_own_numbers_in_the_features(env, monkeypatch):
    at(monkeypatch, NOW)
    use_client(monkeypatch, samsung_client())

    assert sync("2026-10-12") == 0

    with Store(env / "data" / "owi.db") as store:
        features = store.get_features(DAY)
    assert features.samsung_steps == 12230
    assert features.samsung_active_kcal == 960.0
    assert features.samsung_sleep_score == 84.0


def test_sync_tunes_on_samsungs_own_numbers_without_any_entry(env, monkeypatch):
    at(monkeypatch, NOW)
    use_client(monkeypatch, samsung_client())

    assert sync("2026-10-12") == 0

    assert not entries_path(env).exists()
    with Store(env / "data" / "owi.db") as store:
        fit = store.latest_fit()
    assert (fit.fitted_at, fit.entries) == (NOW, 1)
    weights = json.loads((env / "data" / "score_weights.json").read_text("utf-8"))
    assert weights["samsung_sleep"]["entries"] == 1


def test_a_changed_samsung_number_asks_for_a_new_fit(env, monkeypatch):
    use_client(monkeypatch, samsung_client())
    for moment in (NOW, NOW + timedelta(hours=1)):
        at(monkeypatch, moment)
        assert sync("2026-10-12") == 0
    with Store(env / "data" / "owi.db") as store:
        assert store.latest_fit().fitted_at == NOW

    # The phone sends the evening's steps late.
    later = NOW + timedelta(hours=2)
    use_client(monkeypatch, samsung_client(late_steps=800))
    at(monkeypatch, later)
    assert sync("2026-10-12") == 0

    with Store(env / "data" / "owi.db") as store:
        assert store.latest_fit().fitted_at == later


def test_a_fit_downloads_the_heart_rate_of_recent_days_with_samsungs_calories(env, monkeypatch):
    at(monkeypatch, NOW)
    use_client(monkeypatch, samsung_client())
    asked = []
    real = cli._reference_days

    def spy(settings, max_hr, days, now):
        asked.append(list(days))
        return real(settings, max_hr, days, now)

    monkeypatch.setattr(cli, "_reference_days", spy)

    assert sync("2026-10-12") == 0

    assert asked == [[DAY]]


def test_a_locked_entries_store_postpones_the_fit(env, monkeypatch, capsys):
    at(monkeypatch, NOW)
    use_client(monkeypatch, stepped_client())
    save_entry(env, DAY, steps=10000, distance_km=9.0)

    def locked(*args, **kwargs):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(cli.entries, "load", locked)

    assert sync("2026-10-12") == 0

    assert "doladenie odložené" in capsys.readouterr().err
    with Store(env / "data" / "owi.db") as store:
        assert store.latest_fit() is None


# Several users: one folder each

OTHER_DAY = date(2026, 10, 14)


class ByUser(FakeClient):
    """Answers each Open Wearables user from that user's own fake data."""

    def __init__(self, clients: dict[str, FakeClient], **kwargs) -> None:
        super().__init__(**kwargs)
        self.clients = clients

    def timeseries(self, user_id, types, start, end):
        return self.clients[user_id].timeseries(user_id, types, start, end)

    def workouts(self, user_id, start, end):
        return self.clients[user_id].workouts(user_id, start, end)

    def sleeps(self, user_id, start, end):
        return self.clients[user_id].sleeps(user_id, start, end)

    def health_scores(self, user_id, category, provider, first, last):
        return self.clients[user_id].health_scores(user_id, category, provider, first, last)


def open_accounts(env) -> Accounts:
    return Accounts(accounts_path(env / "data"))


def add_account(env, ow_user_id, email, *, status="active", **changes):
    """A paired account (suspended afterwards when asked); `changes` go to Accounts.update."""
    with open_accounts(env) as store:
        account = store.create(email, "Test", None, "correct horse battery", "user", "pending", NOW)
        store.pair(account.id, ow_user_id)
        if changes:
            store.update(account.id, changes)
        if status != "active":
            store.set_role_status(account.id, None, status)
        return account


def paths_of(env, ow_user_id):
    return user_paths(env / "data", ow_user_id)


def day_of(env, ow_user_id, day: date = DAY):
    with Store(paths_of(env, ow_user_id).db_path) as store:
        return store.get_day(day)


def steps_client(steps: int) -> FakeClient:
    return FakeClient([sample(START, STEPS, steps, HC_SHEALTH)])


def test_sync_runs_for_every_paired_active_account(env, monkeypatch):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    add_account(env, "ow-b", "b@example.test")
    add_account(env, "ow-c", "c@example.test", status="suspended")
    clients = {"ow-a": steps_client(111), "ow-b": steps_client(222), "ow-c": steps_client(333)}
    use_client(monkeypatch, ByUser(clients))

    assert sync("2026-10-12") == 0

    assert day_of(env, "ow-a").steps == 111
    assert day_of(env, "ow-b").steps == 222
    assert not paths_of(env, "ow-c").folder.exists()
    assert not (env / "data" / "owi.db").exists()


def test_sync_without_accounts_db_keeps_the_single_user_behaviour(env, monkeypatch):
    at(monkeypatch, NOW)
    monkeypatch.setenv("OWI_USER_ID", "ow-legacy")
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 777, HC_SHEALTH)], user="ow-legacy"))

    assert sync("2026-10-12") == 0

    with Store(env / "data" / "owi.db") as store:
        assert store.get_day(DAY).steps == 777
    assert not (env / "data" / "users").exists()
    assert not accounts_path(env / "data").exists()


def sleeping_client() -> FakeClient:
    """Worn long enough on 12 and 14 October for strain, with a night before each."""
    samples = []
    nights = []
    for day in (DAY, OTHER_DAY):
        start = utc(day.year, day.month, day.day - 1, 22)
        samples += [sample(start, STEPS, 5000, HC_SHEALTH), *hr_minutes(start, [55.0] * 1000)]
        nights.append(
            sleep_session(f"n{day}", start - timedelta(hours=1), start + timedelta(hours=7))
        )
    return FakeClient(samples, sleeps=nights)


def sleep_need(env, ow_user_id, day: date) -> float:
    with Store(paths_of(env, ow_user_id).db_path) as store:
        return store.get_scores(day).sleep_need_minutes


def test_age_comes_from_birth_date_at_each_day(env, monkeypatch):
    at(monkeypatch, NOW)
    # Turns 18 on 13 October: a teenager's need on the 12th, an adult's on the 14th.
    add_account(env, "ow-a", "a@example.test", birth_date="2008-10-13", sex="male")
    use_client(monkeypatch, ByUser({"ow-a": sleeping_client()}))

    assert cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-14"]) == 0

    assert sleep_need(env, "ow-a", DAY) == pytest.approx(480.0, abs=5.0)
    assert sleep_need(env, "ow-a", OTHER_DAY) == pytest.approx(450.0, abs=5.0)


def test_account_without_a_profile_does_not_get_the_env_profile(env, monkeypatch):
    at(monkeypatch, NOW)
    monkeypatch.setenv("OWI_AGE", "17")
    add_account(env, "ow-a", "a@example.test")
    use_client(monkeypatch, ByUser({"ow-a": sleeping_client()}))

    assert cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-12"]) == 0

    assert sleep_need(env, "ow-a", DAY) == pytest.approx(450.0, abs=5.0)


def test_the_old_user_falls_back_to_the_env_profile(env, monkeypatch):
    at(monkeypatch, NOW)
    monkeypatch.setenv("OWI_USER_ID", "ow-a")
    monkeypatch.setenv("OWI_AGE", "17")
    add_account(env, "ow-a", "a@example.test")
    use_client(monkeypatch, ByUser({"ow-a": sleeping_client()}))

    assert cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-12"]) == 0

    assert sleep_need(env, "ow-a", DAY) == pytest.approx(480.0, abs=5.0)


def test_consent_off_skips_tuning_and_uses_defaults(env, monkeypatch):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test", training_consent=False)
    add_account(env, "ow-b", "b@example.test")
    for ow_user_id in ("ow-a", "ow-b"):
        entries.save(paths_of(env, ow_user_id).entries_path, DAY, {"steps": 10000}, NOW)
    clients = {"ow-a": steps_client(10000), "ow-b": steps_client(10000)}
    use_client(monkeypatch, ByUser(clients))

    assert sync("2026-10-12") == 0

    assert not paths_of(env, "ow-a").params_path.exists()
    assert load_params(paths_of(env, "ow-a").params_path) == Params()
    with Store(paths_of(env, "ow-a").db_path) as store:
        assert store.latest_fit() is None
    with Store(paths_of(env, "ow-b").db_path) as store:
        assert store.latest_fit() is not None


GARMIN = SourceRef("garmin")
SUMMARY = {
    "series_type_counts": {"steps": 3, "heart_rate": 2, "spo2": 4},
    "by_provider": [
        {
            "provider": "garmin",
            "data_points": 9,
            "series_counts": {"steps": 3, "heart_rate": 2, "spo2": 4},
        }
    ],
}
OW_USERS = [
    {"id": "ow-a", "first_name": "Ada", "last_name": "Test", "email": "ada@example.test"},
    {"id": "ow-b", "first_name": None, "last_name": "", "email": "b@example.test"},
]
CONNECTIONS = [{"provider": "garmin", "status": "active", "last_synced_at": "2026-10-16T08:00:00Z"}]


def test_sync_stores_ow_users_sources_and_last_data_in_accounts(env, monkeypatch):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    samples = [sample(START, STEPS, 100, GARMIN), sample(utc(2026, 10, 14, 8), "spo2", 97, GARMIN)]
    client = FakeClient(samples, ow_users=OW_USERS, connections=CONNECTIONS, summary=SUMMARY)
    use_client(monkeypatch, client)

    assert sync("2026-10-12") == 0

    with open_accounts(env) as store:
        assert {user.id: user.label for user in store.ow_users()} == {
            "ow-a": "Ada Test · ada@example.test",
            "ow-b": "b@example.test",
        }
        sources = store.sources("ow-a")
        assert store.last_data("ow-a") == START
    assert sources["connections"] == CONNECTIONS
    assert sources["types"] == [
        {"type": "heart_rate", "provider": "garmin", "arriving": False},
        {"type": "spo2", "provider": "garmin", "arriving": True},
        {"type": "steps", "provider": "garmin", "arriving": True},
    ]
    assert sources["samsung_health"] is False
    # Steps arrived in the synced window; only the other two types needed a request.
    assert sorted(client.head_calls) == [("heart_rate", "garmin"), ("spo2", "garmin")]


@pytest.mark.parametrize("source", [SAMSUNG_WATCH, HC_SHEALTH])
def test_samsung_health_flag_is_set_for_samsung_samples(env, monkeypatch, source):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 100, source)]))

    assert sync("2026-10-12") == 0

    with open_accounts(env) as store:
        assert store.sources("ow-a")["samsung_health"] is True


def test_a_week_long_window_needs_no_request_for_the_types_it_downloads(env, monkeypatch):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    summary = {"by_provider": [{"provider": "garmin", "series_counts": {"steps": 1, "spo2": 1}}]}
    client = FakeClient([sample(START, STEPS, 100, GARMIN)], summary=summary)
    use_client(monkeypatch, client)

    assert cli.main(["sync", "--days", "8"]) == 0

    assert client.head_calls == [("spo2", "garmin")]
    with open_accounts(env) as store:
        types = {t["type"]: t["arriving"] for t in store.sources("ow-a")["types"]}
    assert types == {"steps": True, "spo2": False}


def test_sync_deletes_queued_folders_of_unpaired_users(env, monkeypatch):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    data = env / "data"
    for name in ("gone", "ow-a", "other"):
        (data / "users" / name).mkdir(parents=True)
        if name != "ow-a":
            (data / "users" / name / "owi.db").write_text("x", "utf-8")
    (data / "victim").mkdir()
    with open_accounts(env) as store:
        for name in ("gone", "ow-a", "../victim"):
            store.deletions_add(name, NOW)
    use_client(monkeypatch, FakeClient())

    assert sync("2026-10-12") == 0

    assert not (data / "users" / "gone").exists()
    assert (data / "users" / "other").exists()
    assert (data / "users" / "ow-a").exists()
    assert (data / "victim").exists()
    with open_accounts(env) as store:
        assert store.deletions_pending() == ["ow-a"]


def test_one_failing_user_does_not_stop_the_others(env, monkeypatch, capsys):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    add_account(env, "ow-b", "b@example.test")

    class Broken(ByUser):
        def timeseries(self, user_id, *args, **kwargs):
            if user_id == "ow-a":
                raise OWError("unreachable")
            return super().timeseries(user_id, *args, **kwargs)

    use_client(monkeypatch, Broken({"ow-a": steps_client(1), "ow-b": steps_client(222)}))

    assert sync("2026-10-12") == 1

    assert day_of(env, "ow-b").steps == 222
    assert "unreachable" in capsys.readouterr().err


def test_sync_records_when_it_ran_and_whether_it_succeeded(env, monkeypatch):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    use_client(monkeypatch, ByUser({"ow-a": steps_client(111)}))

    assert sync("2026-10-12") == 0

    with open_accounts(env) as store:
        assert store.system_get("last_sync_at") == NOW.isoformat()
        assert store.system_get("last_sync_ok") == "1"

    class Broken(ByUser):
        def timeseries(self, user_id, *args, **kwargs):
            raise OWError("unreachable")

    later = NOW + timedelta(minutes=10)
    at(monkeypatch, later)
    use_client(monkeypatch, Broken({"ow-a": steps_client(1)}))

    assert sync("2026-10-12") == 1

    with open_accounts(env) as store:
        assert store.system_get("last_sync_at") == later.isoformat()
        assert store.system_get("last_sync_ok") == "0"


def test_samsung_health_flag_stays_true_after_a_quiet_run(env, monkeypatch):
    add_account(env, "ow-a", "a@example.test")
    at(monkeypatch, NOW)
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 100, SAMSUNG_WATCH)]))
    assert sync("2026-10-12") == 0

    at(monkeypatch, NOW + timedelta(hours=25))
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 100, GARMIN)]))
    assert sync("2026-10-12") == 0

    with open_accounts(env) as store:
        assert store.sources("ow-a")["samsung_health"] is True


def test_samsung_connection_or_summary_provider_sets_the_flag(env, monkeypatch):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    summary = {"by_provider": [{"provider": "samsung", "series_counts": {"steps": 5}}]}
    use_client(monkeypatch, FakeClient(summary=summary))

    assert sync("2026-10-12") == 0

    with open_accounts(env) as store:
        assert store.sources("ow-a")["samsung_health"] is True


def test_arrival_is_checked_per_provider(env, monkeypatch):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    summary = {
        "by_provider": [
            {"provider": "garmin", "series_counts": {"spo2": 9}},
            {"provider": "oura", "series_counts": {"spo2": 4}},
        ]
    }
    # Only the second provider has a recent sample of the type.
    samples = [sample(utc(2026, 10, 14, 8), "spo2", 97, SourceRef("oura"))]
    client = FakeClient(samples, summary=summary)
    use_client(monkeypatch, client)

    assert sync("2026-10-12") == 0

    with open_accounts(env) as store:
        types = {(t["provider"], t["type"]): t["arriving"] for t in store.sources("ow-a")["types"]}
    assert types == {("garmin", "spo2"): False, ("oura", "spo2"): True}
    assert sorted(client.head_calls) == [("spo2", "garmin"), ("spo2", "oura")]


def test_sources_are_refreshed_at_most_once_in_24_hours(env, monkeypatch):
    add_account(env, "ow-a", "a@example.test")
    summary = {"by_provider": [{"provider": "garmin", "series_counts": {"spo2": 1}}]}
    client = FakeClient(summary=summary)
    use_client(monkeypatch, client)
    at(monkeypatch, NOW)
    assert sync("2026-10-12") == 0
    at(monkeypatch, NOW + timedelta(hours=23))
    assert sync("2026-10-12") == 0
    assert len(client.head_calls) == 1

    at(monkeypatch, NOW + timedelta(hours=25))
    assert sync("2026-10-12") == 0
    assert len(client.head_calls) == 2


def test_a_non_api_failure_of_one_account_does_not_stop_the_others(env, monkeypatch, capsys):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    add_account(env, "ow-b", "b@example.test")

    class Broken(ByUser):
        def timeseries(self, user_id, *args, **kwargs):
            if user_id == "ow-a":
                raise sqlite3.DatabaseError("secret detail")
            return super().timeseries(user_id, *args, **kwargs)

    use_client(monkeypatch, Broken({"ow-a": steps_client(1), "ow-b": steps_client(222)}))

    assert sync("2026-10-12") == 1

    assert day_of(env, "ow-b").steps == 222
    err = capsys.readouterr().err
    assert "DatabaseError" in err
    assert "secret detail" not in err


def test_a_failing_refresh_still_deletes_queued_folders(env, monkeypatch):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    gone = env / "data" / "users" / "gone"
    gone.mkdir(parents=True)
    with open_accounts(env) as store:
        store.deletions_add("gone", NOW)

    class NoUsers(FakeClient):
        def users(self):
            raise ValueError("boom")

    use_client(monkeypatch, NoUsers())

    assert sync("2026-10-12") == 1

    assert not gone.exists()


def test_the_loop_survives_a_locked_accounts_store(env, monkeypatch, capsys):
    at(monkeypatch, NOW)
    add_account(env, "ow-a", "a@example.test")
    use_client(monkeypatch, ByUser({"ow-a": steps_client(111)}))
    real = cli.Accounts
    opened = []

    def flaky(path):
        opened.append(path)
        if len(opened) == 1:
            raise sqlite3.OperationalError("database is locked")
        return real(path)

    sleeps = []

    def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 2:
            raise KeyboardInterrupt

    monkeypatch.setattr(cli, "Accounts", flaky)
    monkeypatch.setattr(cli.time, "sleep", fake_sleep)

    with pytest.raises(KeyboardInterrupt):
        cli.main(["sync", "--from", "2026-10-12", "--to", "2026-10-12", "--loop", "5"])

    assert len(opened) == 2
    assert "OperationalError" in capsys.readouterr().err
    assert day_of(env, "ow-a").steps == 111


def test_a_broken_accounts_store_fails_a_single_run(env, monkeypatch, capsys):
    add_account(env, "ow-a", "a@example.test")

    def locked(path):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(cli, "Accounts", locked)

    assert sync("2026-10-12") == 1
    assert "OperationalError" in capsys.readouterr().err
