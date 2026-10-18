"""Where each user's files live, and the one-off move of the single-user layout."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

USERS_DIR = "users"
ENTRIES_DIR = "zapisy"
ENTRIES_FILE = "zapisy.db"


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


def migrate_legacy(data_dir: Path, ow_user_id: str) -> list[str]:
    """Move the single-user files into the user's folders and return what was moved.

    A missing source is skipped. If any target already exists, nothing is moved and
    FileExistsError is raised, so a rerun or a half-done earlier run never overwrites.
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
    moved: list[str] = []
    for source, target in todo:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(source, target)
        moved.append(source.relative_to(data_dir).as_posix())
    return moved


def backup_data(data_dir: Path, now: datetime) -> Path:
    """Copy the whole data folder next to the repository, outside git."""
    root = data_dir.resolve().parent
    target = root.parent / f"data-backup-{now:%Y%m%d-%H%M%S}"
    shutil.copytree(data_dir, target)
    return target
