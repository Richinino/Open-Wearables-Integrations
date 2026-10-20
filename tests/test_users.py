import sqlite3
import subprocess
import sys
from contextlib import closing

import pytest

from owi import cli, users
from owi.config import Settings, load_settings

OW_USER = "11111111-2222-3333-4444-555555555555"
FILES = {
    "owi.db": b"db-bytes",
    "params.json": b'{"stride_m": 0.7}',
    "score_weights.json": b"{}",
}


def make_legacy(data):
    data.mkdir(parents=True, exist_ok=True)
    for name, content in FILES.items():
        (data / name).write_bytes(content)
    (data / "zapisy").mkdir()
    (data / "zapisy" / "zapisy.db").write_bytes(b"entries-bytes")


def test_user_paths_layout(tmp_path):
    paths = users.user_paths(tmp_path, OW_USER)
    assert paths.db_path == tmp_path / "users" / OW_USER / "owi.db"
    assert paths.params_path == tmp_path / "users" / OW_USER / "params.json"
    assert paths.score_weights_path == tmp_path / "users" / OW_USER / "score_weights.json"
    assert paths.entries_path == tmp_path / "zapisy" / OW_USER / "zapisy.db"


def test_settings_expose_accounts_path(tmp_path):
    settings = load_settings({"OWI_DATA_DIR": str(tmp_path)}, env_file=None)
    assert settings.accounts_path == tmp_path / "accounts" / "accounts.db"


def test_migrate_moves_files_once_and_keeps_contents(tmp_path):
    make_legacy(tmp_path)
    moved = users.migrate_legacy(tmp_path, OW_USER)
    paths = users.user_paths(tmp_path, OW_USER)
    assert sorted(moved) == ["owi.db", "params.json", "score_weights.json", "zapisy/zapisy.db"]
    assert paths.db_path.read_bytes() == FILES["owi.db"]
    assert paths.params_path.read_bytes() == FILES["params.json"]
    assert paths.score_weights_path.read_bytes() == FILES["score_weights.json"]
    assert paths.entries_path.read_bytes() == b"entries-bytes"
    for name in FILES:
        assert not (tmp_path / name).exists()
    assert not (tmp_path / "zapisy" / "zapisy.db").exists()

    assert users.migrate_legacy(tmp_path, OW_USER) == []
    assert paths.db_path.read_bytes() == FILES["owi.db"]


def test_migrate_skips_missing_sources(tmp_path):
    tmp_path.joinpath("params.json").write_bytes(b"{}")
    assert users.migrate_legacy(tmp_path, OW_USER) == ["params.json"]


def test_migrate_refuses_to_overwrite_an_existing_target(tmp_path):
    make_legacy(tmp_path)
    target = users.user_paths(tmp_path, OW_USER).params_path
    target.parent.mkdir(parents=True)
    target.write_bytes(b"other")
    with pytest.raises(FileExistsError):
        users.migrate_legacy(tmp_path, OW_USER)
    assert target.read_bytes() == b"other"
    assert (tmp_path / "params.json").read_bytes() == FILES["params.json"]
    assert (tmp_path / "zapisy" / "zapisy.db").exists()


def test_migrate_cli_makes_a_backup_first(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    data = repo / "data"
    make_legacy(data)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("OWI_DATA_DIR", str(data))

    assert cli.main(["users", "migrate", "--ow-user", OW_USER]) == 0

    backups = list(tmp_path.glob("data-backup-*"))
    assert len(backups) == 1
    assert (backups[0] / "owi.db").read_bytes() == FILES["owi.db"]
    assert (backups[0] / "zapisy" / "zapisy.db").read_bytes() == b"entries-bytes"
    assert users.user_paths(data, OW_USER).db_path.read_bytes() == FILES["owi.db"]
    assert not list(repo.glob("data-backup-*"))


def test_migrate_cli_reports_existing_target_without_overwriting(tmp_path, monkeypatch):
    data = tmp_path / "repo" / "data"
    make_legacy(data)
    target = users.user_paths(data, OW_USER).db_path
    target.parent.mkdir(parents=True)
    target.write_bytes(b"other")
    monkeypatch.setenv("OWI_DATA_DIR", str(data))
    assert cli.main(["users", "migrate", "--ow-user", OW_USER]) == 1
    assert target.read_bytes() == b"other"


def test_migrate_cli_refuses_an_unsafe_default_backup_place(tmp_path, monkeypatch, capsys):
    data = tmp_path / "data"
    make_legacy(data)
    monkeypatch.setenv("OWI_DATA_DIR", str(data))
    monkeypatch.setattr(users.os, "access", lambda *args: False)
    assert cli.main(["users", "migrate", "--ow-user", OW_USER]) == 1
    assert "--backup-dir" in capsys.readouterr().err
    assert (data / "owi.db").exists()
    assert not users.user_paths(data, OW_USER).db_path.exists()


def test_migrate_cli_uses_backup_dir(tmp_path, monkeypatch):
    data = tmp_path / "data"
    make_legacy(data)
    elsewhere = tmp_path / "elsewhere"
    monkeypatch.setenv("OWI_DATA_DIR", str(data))
    code = cli.main(["users", "migrate", "--ow-user", OW_USER, "--backup-dir", str(elsewhere)])
    assert code == 0
    [backup] = elsewhere.glob("data-backup-*")
    assert (backup / "owi.db").read_bytes() == FILES["owi.db"]


def test_migrate_cli_failed_backup_moves_nothing(tmp_path, monkeypatch, capsys):
    from datetime import UTC, datetime

    data = tmp_path / "repo" / "data"
    make_legacy(data)
    moment = datetime(2026, 10, 18, 12, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(cli, "_now", lambda: moment)
    monkeypatch.setenv("OWI_DATA_DIR", str(data))
    (tmp_path / "data-backup-20261018-120000").mkdir()
    assert cli.main(["users", "migrate", "--ow-user", OW_USER]) == 1
    assert "záloha zlyhala" in capsys.readouterr().err
    assert (data / "owi.db").exists()
    assert not users.user_paths(data, OW_USER).db_path.exists()


@pytest.mark.parametrize("relative", ["owi.db", "zapisy/zapisy.db"])
def test_migrate_checkpoints_wal_left_by_a_crashed_writer(tmp_path, relative):
    source = tmp_path / relative
    source.parent.mkdir(parents=True, exist_ok=True)
    # A normal connection close checkpoints its WAL. Exit without closing to reproduce
    # committed pages left behind by a crashed service, while releasing Windows handles.
    script = """
import os
import sqlite3
import sys
db = sqlite3.connect(sys.argv[1])
db.execute("PRAGMA journal_mode=WAL")
db.execute("CREATE TABLE synthetic (value INTEGER)")
db.execute("INSERT INTO synthetic VALUES (12345)")
db.commit()
os._exit(0)
"""
    subprocess.run([sys.executable, "-c", script, str(source)], check=True)
    wal = source.with_name(source.name + "-wal")
    assert wal.is_file() and wal.stat().st_size > 32
    # Reading the main file alone demonstrates that the committed schema/row is in WAL.
    with closing(sqlite3.connect(f"{source.as_uri()}?immutable=1", uri=True)) as db:
        assert (
            db.execute("SELECT name FROM sqlite_master WHERE name = 'synthetic'").fetchone() is None
        )

    assert users.migrate_legacy(tmp_path, OW_USER) == [relative]

    paths = users.user_paths(tmp_path, OW_USER)
    target = paths.db_path if relative == "owi.db" else paths.entries_path
    with closing(sqlite3.connect(target)) as db:
        assert db.execute("SELECT value FROM synthetic").fetchall() == [(12345,)]
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not source.exists()


def test_migrate_busy_checkpoint_refuses_before_moving_any_source(tmp_path):
    make_legacy(tmp_path)
    # Make the final source busy so preceding DB/JSON sources would move first if the
    # helper checkpointed and moved each file separately.
    source = tmp_path / "zapisy" / "zapisy.db"
    source.unlink()
    with closing(sqlite3.connect(source)) as writer, closing(sqlite3.connect(source)) as reader:
        writer.execute("PRAGMA journal_mode=WAL")
        writer.execute("CREATE TABLE synthetic (value INTEGER)")
        writer.commit()
        reader.execute("BEGIN")
        assert reader.execute("SELECT * FROM synthetic").fetchall() == []
        writer.execute("INSERT INTO synthetic VALUES (12345)")
        writer.commit()
        with pytest.raises(OSError, match="checkpoint busy or incomplete"):
            users.migrate_legacy(tmp_path, OW_USER)
        for name, content in FILES.items():
            assert (tmp_path / name).read_bytes() == content
        assert source.is_file()
        assert not users.user_paths(tmp_path, OW_USER).folder.exists()
        assert not users.user_paths(tmp_path, OW_USER).entries_path.exists()
        reader.rollback()
    assert users.migrate_legacy(tmp_path, OW_USER)
    with closing(sqlite3.connect(users.user_paths(tmp_path, OW_USER).entries_path)) as db:
        assert db.execute("SELECT value FROM synthetic").fetchall() == [(12345,)]


def test_migrate_failed_sqlite_checkpoint_preserves_all_sources(tmp_path):
    make_legacy(tmp_path)
    source = tmp_path / "owi.db"
    source.write_bytes(b"SQLite format 3\0" + b"invalid database contents")
    with pytest.raises(OSError, match="SQLite checkpoint failed"):
        users.migrate_legacy(tmp_path, OW_USER)
    assert source.exists()
    assert (tmp_path / "params.json").read_bytes() == FILES["params.json"]
    assert (tmp_path / "zapisy" / "zapisy.db").exists()
    assert not users.user_paths(tmp_path, OW_USER).folder.exists()


def test_migrate_checks_all_target_collisions_before_checkpointing(tmp_path, monkeypatch):
    make_legacy(tmp_path)
    target = users.user_paths(tmp_path, OW_USER).entries_path
    target.parent.mkdir(parents=True)
    target.write_bytes(b"existing target")

    def no_checkpoint(path):
        raise AssertionError("checkpoint ran before target collision preflight")

    monkeypatch.setattr(users, "_checkpoint_sqlite", no_checkpoint)
    with pytest.raises(FileExistsError):
        users.migrate_legacy(tmp_path, OW_USER)
    assert target.read_bytes() == b"existing target"
    for name, content in FILES.items():
        assert (tmp_path / name).read_bytes() == content


def test_migrate_cli_reports_checkpoint_failure_without_moving_sources(
    tmp_path, monkeypatch, capsys
):
    data = tmp_path / "data"
    make_legacy(data)
    monkeypatch.setattr(cli, "load_settings", lambda: Settings(data_dir=data))

    def busy(path):
        raise OSError("SQLite checkpoint busy or incomplete")

    monkeypatch.setattr(users, "_checkpoint_sqlite", busy)
    assert (
        cli.main(
            ["users", "migrate", "--ow-user", OW_USER, "--backup-dir", str(tmp_path / "backups")]
        )
        == 1
    )
    assert "chyba: SQLite checkpoint busy or incomplete" in capsys.readouterr().err
    assert (data / "owi.db").exists()
    assert not users.user_paths(data, OW_USER).db_path.exists()
