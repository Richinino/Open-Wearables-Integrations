import json
from datetime import date

import pytest

from owi import cli
from owi.client import OWError
from owi.models import STEPS
from owi.store import Store
from tests.factories import HC_SHEALTH, hr_minutes, make_features, sample, sleep_session, utc
from tests.fakes import FakeClient

DAY = date(2026, 10, 12)
START = utc(2026, 10, 11, 22)
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
    ):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


def use_client(monkeypatch, client) -> None:
    monkeypatch.setattr(cli, "OWClient", lambda *args, **kwargs: client)


def write_truth(env, row: str) -> None:
    data = env / "data"
    data.mkdir()
    (data / "truth.csv").write_text(TRUTH_HEADER + row + "\n", encoding="utf-8")


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


def test_calibrate_writes_params_fitted_to_the_truth_file(env, monkeypatch, capsys):
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 20000, HC_SHEALTH)]))
    write_truth(env, "2026-10-12,20000,,,,15.0")

    assert cli.main(["calibrate"]) == 0

    saved = json.loads((env / "data" / "params.json").read_text(encoding="utf-8"))
    assert saved["stride_m"] == pytest.approx(0.75)
    assert "stride_m" in capsys.readouterr().out


def test_calibrate_records_the_max_hr_it_used_and_later_syncs_reuse_it(env, monkeypatch):
    reference_day = [
        sample(START, STEPS, 20000, HC_SHEALTH),
        *hr_minutes(START, [60.0] * 89 + [170.0]),
    ]
    earlier_day = hr_minutes(utc(2026, 10, 10, 22), [130.0] * 90)
    use_client(monkeypatch, FakeClient([*reference_day, *earlier_day]))
    write_truth(env, "2026-10-12,20000,,,,15.0")

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


def test_calibrate_without_a_truth_file_explains_what_is_missing(env, capsys):
    assert cli.main(["calibrate"]) == 1
    assert "truth.csv" in capsys.readouterr().err


def test_check_prints_estimates_next_to_reference_values(env, monkeypatch, capsys):
    use_client(monkeypatch, FakeClient([sample(START, STEPS, 21000, HC_SHEALTH)]))
    write_truth(env, "2026-10-12,20000,,,,")

    assert cli.main(["check"]) == 0

    out = capsys.readouterr().out
    assert "steps" in out
    assert "21000" in out
    assert "+5.0" in out
