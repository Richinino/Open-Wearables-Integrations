"""Numbers the user copies from Samsung Health, one entry per day: data/zapisy/zapisy.db.

Two containers share the file through a folder on Windows: owi serve writes it, owi sync
reads it. WAL needs shared memory that such a folder cannot provide, so the store keeps
SQLite's rollback journal, opens a connection per call and retries briefly while the other
side holds the lock.
"""

from __future__ import annotations

import math
import sqlite3
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, fields
from datetime import date, datetime
from pathlib import Path
from typing import Any

ENTRIES_DIR = "zapisy"
ENTRIES_FILE = "zapisy.db"
FIELDS = (
    "steps",
    "distance_km",
    "active_minutes",
    "active_kcal",
    "total_kcal",
    "sleep_score",
    "energy_score",
)
# Inclusive ranges a value must fall in (docs/superpowers/specs/2026-10-16-...).
RANGES = {
    "steps": (0, 100_000),
    "distance_km": (0, 150),
    "active_minutes": (0, 1440),
    "active_kcal": (0, 10_000),
    "total_kcal": (500, 15_000),
    "sleep_score": (0, 100),
    "energy_score": (0, 100),
}
INTEGER_FIELDS = frozenset({"steps"})
CONNECT_TIMEOUT_S = 2.0
RETRIES = 5
RETRY_PAUSE_S = 0.2

_SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    "day" TEXT PRIMARY KEY,
    "steps" INTEGER,
    "distance_km" REAL,
    "active_minutes" REAL,
    "active_kcal" REAL,
    "total_kcal" REAL,
    "sleep_score" REAL,
    "energy_score" REAL,
    "saved_at" TEXT
);
"""


@dataclass(frozen=True)
class Entry:
    day: date
    steps: int | None = None
    distance_km: float | None = None
    active_minutes: float | None = None
    active_kcal: float | None = None
    total_kcal: float | None = None
    sleep_score: float | None = None
    energy_score: float | None = None
    saved_at: datetime | None = None


def path_in(data_dir: Path) -> Path:
    return data_dir / ENTRIES_DIR / ENTRIES_FILE


def _thousands(value: int) -> str:
    return f"{value:,}".replace(",", " ")


def _range_text(name: str) -> str:
    low, high = RANGES[name]
    return f"{_thousands(low)}–{_thousands(high)}"


def _number(name: str, raw: Any) -> tuple[float | int | None, str | None]:
    """The value as int or float, or the short Slovak reason it is not acceptable."""
    if raw is None:
        return None, None
    integer = name in INTEGER_FIELDS
    kind = "celé číslo" if integer else "číslo"
    if isinstance(raw, bool) or not isinstance(raw, int | float) or not math.isfinite(raw):
        return None, kind
    if integer and isinstance(raw, float) and not raw.is_integer():
        return None, kind
    low, high = RANGES[name]
    if not low <= raw <= high:
        return None, _range_text(name)
    return (int(raw) if integer else float(raw)), None


def validate(body: Any) -> tuple[dict[str, float | int | None], dict[str, str]]:
    """Typed values of the seven fields (missing ones None) and the fields that failed."""
    if not isinstance(body, Mapping):
        return dict.fromkeys(FIELDS), {"body": "objekt JSON"}
    values: dict[str, float | int | None] = {}
    problems: dict[str, str] = {}
    for name in FIELDS:
        value, problem = _number(name, body.get(name))
        values[name] = value
        if problem:
            problems[name] = problem
    return values, problems


def as_json(entry: Entry) -> dict[str, Any]:
    """The Entry shape of the API: every field, dates as ISO text."""
    data = {f.name: getattr(entry, f.name) for f in fields(entry)}
    data["day"] = entry.day.isoformat()
    data["saved_at"] = None if entry.saved_at is None else entry.saved_at.isoformat()
    return data


def _connect(path: Path, readonly: bool) -> sqlite3.Connection:
    if readonly:
        db = sqlite3.connect(
            f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=CONNECT_TIMEOUT_S
        )
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path, timeout=CONNECT_TIMEOUT_S)
        db.execute("PRAGMA journal_mode=DELETE")
        db.executescript(_SCHEMA)
    db.row_factory = sqlite3.Row
    return db


def _locked(error: sqlite3.OperationalError) -> bool:
    message = str(error).lower()
    return "locked" in message or "busy" in message


def _run[T](path: Path, readonly: bool, work: Callable[[sqlite3.Connection], T]) -> T:
    """One short transaction, retried a few times while the database is locked."""
    for attempt in range(RETRIES):
        try:
            db = _connect(path, readonly)
            try:
                with db:
                    return work(db)
            finally:
                db.close()
        except sqlite3.OperationalError as error:
            if not _locked(error) or attempt == RETRIES - 1:
                raise
            time.sleep(RETRY_PAUSE_S)
    raise AssertionError("unreachable")


def _entry(row: sqlite3.Row) -> Entry:
    saved = row["saved_at"]
    return Entry(
        day=date.fromisoformat(row["day"]),
        **{name: row[name] for name in FIELDS},
        saved_at=None if saved is None else datetime.fromisoformat(saved),
    )


def load(path: Path, first: date | None = None, last: date | None = None) -> list[Entry]:
    """Entries from `first` to `last` inclusive (open ends allowed), oldest first.

    A store that does not exist yet reads as empty and is not created.
    """
    if not path.is_file():
        return []
    low = (first or date.min).isoformat()
    high = (last or date.max).isoformat()

    def read(db: sqlite3.Connection) -> list[Entry]:
        rows = db.execute(
            'SELECT * FROM entries WHERE "day" >= ? AND "day" <= ? ORDER BY "day"', (low, high)
        )
        return [_entry(row) for row in rows]

    return _run(path, True, read)


def save(
    path: Path, day: date, values: Mapping[str, float | int | None], saved_at: datetime
) -> Entry:
    """Store the day's entry, replacing any earlier one; fields not given are None."""
    entry = Entry(day=day, **{name: values.get(name) for name in FIELDS}, saved_at=saved_at)
    row = as_json(entry)
    names = ", ".join(f'"{name}"' for name in row)
    marks = ", ".join(f":{name}" for name in row)

    def write(db: sqlite3.Connection) -> None:
        db.execute(f"INSERT OR REPLACE INTO entries ({names}) VALUES ({marks})", row)

    _run(path, False, write)
    return entry


def delete(path: Path, day: date) -> None:
    def remove(db: sqlite3.Connection) -> None:
        db.execute('DELETE FROM entries WHERE "day" = ?', (day.isoformat(),))

    _run(path, False, remove)


def signature(path: Path) -> tuple[int, str | None]:
    """Row count and newest saved_at: changes whenever an entry is saved or deleted."""
    if not path.is_file():
        return 0, None

    def read(db: sqlite3.Connection) -> tuple[int, str | None]:
        count, newest = db.execute('SELECT COUNT(*), MAX("saved_at") FROM entries').fetchone()
        return int(count), newest

    return _run(path, True, read)
