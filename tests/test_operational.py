import json
import sqlite3
from datetime import date, timedelta

import pytest

from owi import cli, security, users
from owi.accounts import Accounts
from owi.config import Settings
from owi.models import STEPS
from owi.serve import respond
from owi.store import Store
from tests.factories import make_features, make_scores, sample, utc
from tests.fakes import FakeClient
from tests.test_store import make_day

NOW = utc(2026, 10, 19, 10)
DAY = date(2026, 10, 12)
READ = "r" * 40
WRITE = "w" * 40


@pytest.mark.parametrize("failure", ["features", "scores"])
def test_failed_publication_preserves_previous_day_features_and_scores(
    tmp_path, monkeypatch, failure
):
    settings = Settings(data_dir=tmp_path, user_id="u1")
    previous = make_day(DAY, steps=42)
    with Store(settings.db_path) as store:
        store.save_day(previous)
        store.save_features(make_features(DAY, steps=42))
        store.save_scores(make_scores(DAY))
        before_features = store.get_features(DAY)
        before_scores = store.get_scores(DAY)
    monkeypatch.setattr(
        cli, "OWClient", lambda *a, **kw: FakeClient([sample(utc(2026, 10, 12, 8), STEPS, 999)])
    )

    def broken(*args, **kwargs):
        raise RuntimeError("synthetic write failure")

    if failure == "features":
        monkeypatch.setattr(Store, "save_features", broken)
    else:
        monkeypatch.setattr(cli.scoring, "rescore", broken)
    with pytest.raises(RuntimeError):
        cli._sync_once(settings, [DAY], NOW)
    with Store(settings.db_path, readonly=True) as store:
        assert store.get_day(DAY) == previous
        assert store.get_features(DAY) == before_features
        assert store.get_scores(DAY) == before_scores


def test_recomputing_old_inputs_does_not_refresh_the_measurement_time(tmp_path):
    with Store(tmp_path / "owi.db") as store:
        measured = NOW - timedelta(days=2)
        store.record_sync(measured, NOW)
        store.record_sync(measured - timedelta(days=1), NOW + timedelta(hours=1))
        assert store.freshness() == {
            "latest_measurement_at": measured.isoformat(),
            "last_compute_success_at": (NOW + timedelta(hours=1)).isoformat(),
        }


def call(data, method, path, authorization=None, body=b""):
    return respond(
        method,
        path,
        authorization,
        db_path=data / "owi.db",
        token=READ,
        write_token=WRITE,
        timezone="Europe/Bratislava",
        body=body,
        now=NOW,
    )


def test_readiness_checks_data_without_loading_the_whole_history(tmp_path, monkeypatch):
    assert call(tmp_path, "GET", "/health").status == 200
    assert call(tmp_path, "GET", "/ready").status == 503
    with Store(tmp_path / "owi.db") as store:
        store.save_day(make_day())
    monkeypatch.setattr(Store, "days", lambda *args: pytest.fail("readiness loaded history"))
    assert call(tmp_path, "GET", "/ready").status == 200


def test_shared_login_quota_requires_write_token_and_does_not_enable_accounts(tmp_path):
    body = json.dumps({"client_key": "a" * 64}).encode()
    assert call(tmp_path, "POST", "/v1/auth/attempt", f"Bearer {READ}", body).status == 401
    assert not (tmp_path / "zapisy").exists()
    for _ in range(security.LOGIN_LIMIT):
        assert call(tmp_path, "POST", "/v1/auth/attempt", f"Bearer {WRITE}", body).status == 200
    denied = call(tmp_path, "POST", "/v1/auth/attempt", f"Bearer {WRITE}", body)
    assert denied.status == 429
    assert denied.body["retry_after_s"] > 0
    assert not (tmp_path / "accounts" / "accounts.db").exists()
    assert (
        security.reserve_login(
            tmp_path / "zapisy" / "security.db",
            "a" * 64,
            NOW + security.WINDOW + timedelta(seconds=1),
        )
        == 0
    )


def test_sqlite_backup_includes_committed_wal_data_without_copying_sidecars(tmp_path):
    source, target = tmp_path / "data", tmp_path / "backup"
    source.mkdir()
    with sqlite3.connect(source / "owi.db") as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("CREATE TABLE example (value INTEGER)")
        db.execute("INSERT INTO example VALUES (123)")
        db.commit()
        assert (source / "owi.db-wal").exists()
        users.snapshot_data(source, target)
    with sqlite3.connect(target / "owi.db") as backup:
        assert backup.execute("SELECT value FROM example").fetchall() == [(123,)]
        assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not list(target.glob("*-wal"))
    assert not list(target.glob("*-shm"))


def test_failed_directory_removal_stays_queued(tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path)
    folder = tmp_path / "users" / "gone"
    folder.mkdir(parents=True)
    accounts = Accounts(settings.accounts_path)
    accounts.deletions_add("gone", NOW)

    def locked(*args, **kwargs):
        raise PermissionError("synthetic locked folder")

    monkeypatch.setattr(cli.shutil, "rmtree", locked)
    with pytest.raises(PermissionError):
        cli._delete_queued_folders(settings, accounts)
    assert accounts.deletions_pending() == ["gone"]
