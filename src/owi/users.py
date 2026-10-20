"""Where each user's files live, and the one-off move of the single-user layout."""

from __future__ import annotations

import os
import re
import shutil
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

USERS_DIR = "users"
ENTRIES_DIR = "zapisy"
ENTRIES_FILE = "zapisy.db"
FOLDER_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")


@dataclass(frozen=True)
class UserPaths:
    ow_user_id: str
    data_dir: Path

    @property
    def folder(self) -> Path:
        return self.data_dir / USERS_DIR / self.ow_user_id

    @property
    def db_path(self) -> Path:
        return self.folder / "owi.db"

    @property
    def params_path(self) -> Path:
        return self.folder / "params.json"

    @property
    def score_weights_path(self) -> Path:
        return self.folder / "score_weights.json"

    @property
    def entries_path(self) -> Path:
        return self.data_dir / ENTRIES_DIR / self.ow_user_id / ENTRIES_FILE


def user_paths(data_dir: Path, ow_user_id: str) -> UserPaths:
    return UserPaths(ow_user_id, data_dir)


def _checkpoint_sqlite(path: Path) -> None:
    """Put committed WAL pages in the main file before moving it; writers must be stopped."""
    with path.open("rb") as stream:
        if stream.read(16) != b"SQLite format 3\0":
            return
    try:
        with closing(
            sqlite3.connect(f"{path.resolve().as_uri()}?mode=rw", uri=True, timeout=0)
        ) as db:
            result = db.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if result is None or result[0] != 0 or result[1] != result[2]:
                raise OSError(f"SQLite checkpoint busy or incomplete: {path}")
    except sqlite3.Error as exc:
        raise OSError(f"SQLite checkpoint failed: {path}") from exc


def migrate_legacy(data_dir: Path, ow_user_id: str) -> list[str]:
    """Move the single-user files into the user's folders and return what was moved.

    A missing source is skipped. If any target already exists, nothing is moved and
    FileExistsError is raised, so a rerun or a half-done earlier run never overwrites.
    Stop all writers first. SQLite sources are checkpointed before any move; a busy or
    failed checkpoint raises OSError with every source still in its original location.
    """
    paths = user_paths(data_dir, ow_user_id)
    plan = [
        (Path("owi.db"), paths.db_path),
        (Path("params.json"), paths.params_path),
        (Path("score_weights.json"), paths.score_weights_path),
        (Path(ENTRIES_DIR) / ENTRIES_FILE, paths.entries_path),
    ]
    todo = [(data_dir / source, target) for source, target in plan if (data_dir / source).is_file()]
    for _, target in todo:
        if target.exists():
            raise FileExistsError(f"{target} už existuje, nič sa nepresunulo")
    for source, _ in todo:
        _checkpoint_sqlite(source)
    moved: list[str] = []
    for source, target in todo:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(source, target)
        moved.append(source.relative_to(data_dir).as_posix())
    return moved


def backup_data(data_dir: Path, now: datetime, backup_dir: Path | None = None) -> Path:
    """Copy the whole data folder into `backup_dir`, by default next to the repository.

    The default is only used where it is safe; otherwise OSError says to pass backup_dir.
    """
    data = data_dir.resolve()
    parent = (backup_dir if backup_dir is not None else data.parent.parent).resolve()
    if backup_dir is None and (parent == parent.parent or not os.access(parent, os.W_OK)):
        raise OSError(f"{parent} nie je vhodné miesto na zálohu, zadaj --backup-dir")
    if parent == data or data in parent.parents:
        raise OSError(f"{parent} je vnútri {data}, zadaj iný --backup-dir")
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / f"data-backup-{now:%Y%m%d-%H%M%S}"
    snapshot_data(data, target)
    return target


def snapshot_data(data: Path, target: Path) -> None:
    """Copy data, taking consistent online snapshots of SQLite files."""

    def copy_file(source: str, destination: str) -> str:
        path = Path(source)
        with path.open("rb") as stream:
            sqlite = stream.read(16) == b"SQLite format 3\0"
        if not sqlite:
            return shutil.copy2(source, destination)
        with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as reader:
            with closing(sqlite3.connect(destination)) as writer:
                reader.backup(writer, pages=256, sleep=0.05)
                writer.execute("PRAGMA journal_mode=DELETE")
                if writer.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise OSError("SQLite backup failed integrity_check")
        return destination

    shutil.copytree(
        data,
        target,
        copy_function=copy_file,
        ignore=shutil.ignore_patterns("*-journal", "*-wal", "*-shm", "*.tmp"),
    )
