import json
from datetime import date

import pytest

from owi import cli
from owi.client import OWError
from owi.models import STEPS
from owi.store import Store
from tests.factories import HC_SHEALTH, hr_minutes, sample, utc
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
    for name in ("OWI_USER_ID", "OWI_MAX_HR", "OWI_WEIGHT_KG", "OWI_VO2MAX", "OWI_BASAL_KCAL"):
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
