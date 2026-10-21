"""Local data commands must use an intentional, fresh account after migration."""

import json
from dataclasses import replace
from datetime import date

import pytest

from owi import cli, entries, samsung_scores
from owi.accounts import Accounts
from owi.calibration import load_params, save_params
from owi.config import Settings
from owi.models import STEPS, Params
from owi.store import FitRecord, Store
from owi.users import user_paths
from tests.factories import make_features, sample, utc
from tests.fakes import FakeClient

DAY = date(2026, 10, 12)
NOW = utc(2026, 10, 16, 9)
COMMANDS = [["day", str(DAY)], ["rescore"], ["calibrate"], ["check"], ["entries", "import"]]


@pytest.fixture
def settings(tmp_path, monkeypatch):
    # No .env or process settings, real stores, or HTTP clients are read by these tests.
    value = Settings(data_dir=tmp_path / "data", user_id="ow-owner", age=40, max_hr=190)
    monkeypatch.setattr(cli, "load_settings", lambda: value)
    monkeypatch.setattr(cli, "_now", lambda: NOW)

    def no_network(*args, **kwargs):
        raise AssertionError("unexpected network access")

    monkeypatch.setattr(cli, "OWClient", no_network)
    return value


def add_account(settings, ow_user_id, **changes):
    with Accounts(settings.accounts_path) as accounts:
        account = accounts.create(
            f"{ow_user_id}@example.test",
            "Synthetic",
            None,
            "synthetic password",
            "user",
            "pending",
            NOW,
        )
        account = accounts.pair(account.id, ow_user_id)
        return accounts.update(account.id, changes) if changes else account


def seed_day(settings, monkeypatch, ow_user_id, steps):
    paths = user_paths(settings.data_dir, ow_user_id)
    monkeypatch.setattr(
        cli,
        "OWClient",
        lambda *args: FakeClient([sample(utc(2026, 10, 11, 22), STEPS, steps)], user=ow_user_id),
    )
    cli._sync_once(replace(settings, user_id=ow_user_id, paths=paths), [DAY], NOW)
    return paths


def test_day_and_rescore_default_to_owner_and_explicit_account_is_isolated(
    settings, monkeypatch, capsys
):
    owner = add_account(settings, "ow-owner", birth_date="2009-10-13")
    other = add_account(settings, "ow-other")
    owner_paths = seed_day(settings, monkeypatch, "ow-owner", 111)
    other_paths = seed_day(settings, monkeypatch, "ow-other", 222)
    for paths, strain in ((owner_paths, 3.0), (other_paths, 7.0)):
        with Store(paths.db_path) as store:
            store.save_features(make_features(DAY, strain=strain))
    capsys.readouterr()

    assert cli.main(["day", str(DAY), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["steps"] == 111
    assert cli.main(["day", str(DAY), "--account", other.id, "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["steps"] == 222

    assert cli.main(["rescore"]) == 0
    with Store(owner_paths.db_path) as store, Store(other_paths.db_path) as other_store:
        assert store.get_scores(DAY).strain == 3.0
        assert other_store.get_scores(DAY).strain != 7.0
        owner_score = store.get_scores(DAY)
    assert cli.main(["rescore", "--account", other.id]) == 0
    with Store(owner_paths.db_path) as store, Store(other_paths.db_path) as other_store:
        assert store.get_scores(DAY) == owner_score
        assert other_store.get_scores(DAY).strain == 7.0
        # The owner's birthday affects rescore; another account has no .env age fallback.
        assert owner_score.sleep_need_minutes > other_store.get_scores(DAY).sleep_need_minutes
    assert not (settings.data_dir / "owi.db").exists()
    assert owner.id != other.id


@pytest.mark.parametrize("command", COMMANDS)
@pytest.mark.parametrize("owner_id", [None, "ow-unknown", "../invalid"])
def test_missing_unknown_or_invalid_owner_fails_before_creating_legacy_stores(
    settings, monkeypatch, capsys, command, owner_id
):
    add_account(settings, "ow-other")
    monkeypatch.setattr(cli, "load_settings", lambda: replace(settings, user_id=owner_id))
    assert cli.main(command) == 1
    code = {
        None: "owner_required_use_account",
        "ow-unknown": "owner_not_found",
        "../invalid": "invalid_owner_id",
    }[owner_id]
    assert code in capsys.readouterr().err
    assert not (settings.data_dir / "owi.db").exists()
    assert not (settings.data_dir / "users").exists()
    assert not (settings.data_dir / "zapisy").exists()


@pytest.mark.parametrize("command", COMMANDS)
@pytest.mark.parametrize("account_id", ["unknown-account", "../invalid", ""])
def test_bad_explicit_account_fails_without_creating_any_user_store(
    settings, capsys, command, account_id
):
    add_account(settings, "ow-owner")
    assert cli.main([*command, f"--account={account_id}"]) == 1
    code = "account_not_found" if account_id == "unknown-account" else "invalid_account_id"
    assert code in capsys.readouterr().err
    assert not (settings.data_dir / "owi.db").exists()
    assert not (settings.data_dir / "users").exists()
    assert not (settings.data_dir / "zapisy").exists()


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("state", ["unpaired", "suspended", "pending"])
def test_current_pairing_and_status_are_required(settings, capsys, explicit, state):
    account = add_account(settings, "ow-owner")
    with Accounts(settings.accounts_path) as accounts:
        if state == "unpaired":
            accounts.unpair(account.id)
        else:
            accounts.set_role_status(account.id, None, state)
    selector = ["--account", account.id] if explicit else []
    assert cli.main(["day", str(DAY), *selector]) == 1
    expected = (
        "account_unpaired"
        if state == "unpaired" and explicit
        else "owner_not_found"
        if state == "unpaired"
        else "account_inactive"
    )
    assert expected in capsys.readouterr().err
    assert not (settings.data_dir / "owi.db").exists()
    assert not (settings.data_dir / "users").exists()


def test_invalid_selector_does_not_initialize_accounts_store(settings, capsys):
    assert cli.main(["day", str(DAY), "--account=../bad"]) == 1
    assert "invalid_account_id" in capsys.readouterr().err
    assert not settings.data_dir.exists()
    assert cli.main(["day", str(DAY), "--account=unknown"]) == 1
    assert "accounts_unavailable" in capsys.readouterr().err
    assert not settings.data_dir.exists()


@pytest.mark.parametrize("explicit", [False, True])
def test_calibrate_checks_fresh_consent_before_accessing_entries_or_fit(settings, capsys, explicit):
    account = add_account(settings, "ow-owner", training_consent=True)
    with Accounts(settings.accounts_path) as accounts:
        accounts.update(account.id, {"training_consent": False})
    selector = ["--account", account.id] if explicit else []
    assert cli.main(["calibrate", *selector]) == 1
    assert "training_consent_required" in capsys.readouterr().err
    assert not (settings.data_dir / "owi.db").exists()
    assert not (settings.data_dir / "users").exists()
    with Accounts(settings.accounts_path) as accounts:
        assert not accounts.get(account.id).training_consent


@pytest.mark.parametrize("explicit", [False, True])
def test_check_and_calibrate_use_selected_entries_profile_and_params(
    settings, monkeypatch, capsys, explicit
):
    owner = add_account(settings, "ow-owner")
    other = add_account(settings, "ow-other", birth_date="2000-05-01", sex="female")
    account = other if explicit else owner
    paths = user_paths(settings.data_dir, account.ow_user_id)
    entries.save(paths.entries_path, DAY, {"steps": 20000, "distance_km": 15.0}, NOW)
    requested = []

    class SelectedClient(FakeClient):
        def timeseries(self, user_id, *args, **kwargs):
            requested.append(user_id)
            return super().timeseries(user_id, *args, **kwargs)

    monkeypatch.setattr(
        cli,
        "OWClient",
        lambda *args: SelectedClient([sample(utc(2026, 10, 11, 22), STEPS, 20000)]),
    )
    captured = []
    original = cli._entry_inputs

    def inputs(user, *args):
        captured.append(user)
        return original(user, *args)

    monkeypatch.setattr(cli, "_entry_inputs", inputs)
    selector = ["--account", account.id] if explicit else []
    assert cli.main(["check", *selector]) == 0
    assert "steps" in capsys.readouterr().out
    assert cli.main(["calibrate", *selector]) == 0
    assert requested and set(requested) == {account.ow_user_id}
    assert load_params(paths.params_path).stride_m > 0.74
    assert captured[0].max_hr == (None if explicit else 190)
    assert captured[0].sex == ("female" if explicit else None)
    assert captured[0].age_on(DAY) == (26 if explicit else 40)
    with Store(paths.db_path) as store:
        assert store.latest_fit().entries == 1
    unused = user_paths(settings.data_dir, "ow-owner" if explicit else "ow-other")
    assert not unused.db_path.exists() and not unused.params_path.exists()
    assert not (settings.data_dir / "owi.db").exists()
    assert not (settings.data_dir / "params.json").exists()


@pytest.mark.parametrize("explicit", [False, True])
def test_entries_import_only_writes_selected_account(settings, capsys, explicit):
    owner = add_account(settings, "ow-owner")
    other = add_account(settings, "ow-other")
    csv = settings.data_dir / "synthetic.csv"
    csv.write_text("date,steps\n2026-10-12,1234\n", encoding="utf-8")
    account = other if explicit else owner
    selector = ["--account", account.id] if explicit else []
    assert cli.main(["entries", "import", "--path", str(csv), *selector]) == 0
    paths = user_paths(settings.data_dir, account.ow_user_id)
    assert entries.load(paths.entries_path)[0].steps == 1234
    unused = user_paths(settings.data_dir, "ow-owner" if explicit else "ow-other")
    assert not unused.entries_path.exists()
    assert not entries.path_in(settings.data_dir).exists()
    assert not (settings.data_dir / "owi.db").exists()
    assert "importované dni: 1" in capsys.readouterr().out


def test_commands_keep_legacy_paths_before_accounts_database_exists(settings, monkeypatch, capsys):
    monkeypatch.setattr(
        cli,
        "OWClient",
        lambda *args: FakeClient([sample(utc(2026, 10, 11, 22), STEPS, 20000)]),
    )
    cli._sync_once(settings, [DAY], NOW)
    capsys.readouterr()
    assert cli.main(["day", str(DAY), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["steps"] == 20000
    with Store(settings.db_path) as store:
        store.save_features(make_features(DAY, strain=4.0))
    assert cli.main(["rescore"]) == 0
    with Store(settings.db_path) as store:
        assert store.get_scores(DAY).strain == 4.0
    settings.truth_path.write_text(
        "date,steps,distance_km\n2026-10-12,20000,15.0\n", encoding="utf-8"
    )
    assert cli.main(["entries", "import"]) == 0
    assert entries.load(settings.entries_path)[0].steps == 20000
    assert cli.main(["check"]) == 0
    assert cli.main(["calibrate"]) == 0
    assert load_params(settings.params_path).stride_m > 0.74
    assert not settings.accounts_path.exists()
    assert not (settings.data_dir / "users").exists()


def test_accounts_list_before_migration_is_read_only_and_keeps_legacy_dispatch(
    settings, monkeypatch, capsys
):
    assert cli.main(["accounts", "list"]) == 0
    assert capsys.readouterr().out == "email\trole\tstatus\tow_user\n"
    assert not settings.accounts_path.exists()
    assert not settings.accounts_path.parent.exists()
    synced = []
    monkeypatch.setattr(cli, "_sync_once", lambda selected, *args: synced.append(selected))
    monkeypatch.setattr(cli, "_tune", lambda *args: None)
    monkeypatch.setattr(cli, "_sync_accounts", lambda *args: pytest.fail("account mode activated"))
    assert cli.main(["sync", "--days", "1"]) == 0
    assert synced == [settings]
    assert not settings.accounts_path.exists()


@pytest.mark.parametrize("explicit", [False, True])
def test_disabling_consent_ignores_saved_fits_in_sync_and_local_rescore(
    settings, monkeypatch, explicit
):
    account = add_account(settings, "ow-owner", training_consent=True)
    paths = seed_day(settings, monkeypatch, "ow-owner", 10000)
    fitted = Params(stride_m=1.1, max_hr=155)
    models = samsung_scores.SamsungModels(
        sleep=samsung_scores.ScoreModel(30, {"duration": 1.0}),
        energy=samsung_scores.ScoreModel(30, {"load": 1.0}),
    )
    save_params(paths.params_path, fitted)
    samsung_scores.save_models(paths.score_weights_path, models)
    fit = FitRecord(NOW, 30, None, {"stride_m": 1.1}, {})
    with Store(paths.db_path) as db:
        db.save_fit(fit)
    original_files = [p.read_bytes() for p in (paths.params_path, paths.score_weights_path)]
    params_seen, models_seen = [], []
    original_compute, original_rescore = cli.compute, cli.scoring.rescore

    def compute(item, params, timezone):
        params_seen.append(params)
        return original_compute(item, params, timezone)

    def rescore(*args):
        models_seen.append(args[5])
        return original_rescore(*args)

    monkeypatch.setattr(cli, "compute", compute)
    monkeypatch.setattr(cli.scoring, "rescore", rescore)
    tuned = []
    monkeypatch.setattr(cli, "_tune", lambda *args: tuned.append(True))
    cli._sync_user(settings, account, paths, [DAY], NOW)
    assert params_seen == [fitted] and models_seen == [models] and tuned == [True]
    with Accounts(settings.accounts_path) as accounts:
        account = accounts.update(account.id, {"training_consent": False})
    params_seen.clear()
    models_seen.clear()
    tuned.clear()
    cli._sync_user(settings, account, paths, [DAY], NOW)
    selector = ["--account", account.id] if explicit else []
    assert cli.main(["rescore", *selector]) == 0
    assert params_seen == [Params()]
    assert models_seen == [samsung_scores.SamsungModels()] * 2
    assert tuned == []
    with Store(paths.db_path) as db:
        assert db.get_day(DAY).distance_m_est == 10000 * Params().stride_m
        assert db.latest_fit() == fit
    assert [p.read_bytes() for p in (paths.params_path, paths.score_weights_path)] == original_files
