"""SQLite storage for computed days, workouts, score features and scores."""

from __future__ import annotations

import json
import sqlite3
import types
from dataclasses import fields, is_dataclass
from datetime import UTC, date, datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any, TypeVar, Union, get_args, get_origin, get_type_hints

from owi.models import DayResult, WorkoutResult
from owi.score_models import DayFeatures, DayScores

MAX_PLAUSIBLE_HR = 210.0

_SCHEMA = """
CREATE TABLE IF NOT EXISTS daily (
    "day" TEXT PRIMARY KEY,
    "timezone" TEXT NOT NULL,
    "complete" INTEGER NOT NULL,
    "steps" INTEGER,
    "steps_source" TEXT,
    "distance_m_est" REAL,
    "active_minutes_est" INTEGER,
    "activity_kcal_est" REAL,
    "basal_kcal" REAL,
    "total_kcal_est" REAL,
    "hr_resting" REAL,
    "hr_avg" REAL,
    "hr_max" REAL,
    "hr_min" REAL,
    "zone_light_min" INTEGER,
    "zone_moderate_min" INTEGER,
    "zone_vigorous_min" INTEGER,
    "sleep_start" TEXT,
    "sleep_end" TEXT,
    "sleep_minutes" REAL,
    "sleep_deep_min" REAL,
    "sleep_rem_min" REAL,
    "sleep_light_min" REAL,
    "sleep_awake_min" REAL,
    "nap_minutes" REAL,
    "computed_at" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workouts (
    "id" TEXT PRIMARY KEY,
    "day" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "duration_s" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "hr_avg" REAL,
    "hr_max" REAL,
    "hr_min" REAL,
    "zone_light_min" INTEGER NOT NULL,
    "zone_moderate_min" INTEGER NOT NULL,
    "zone_vigorous_min" INTEGER NOT NULL,
    "distance_m" REAL,
    "kcal_est" REAL
);
CREATE INDEX IF NOT EXISTS workouts_day ON workouts ("day");
CREATE TABLE IF NOT EXISTS day_features (
    "day" TEXT PRIMARY KEY,
    "data" TEXT NOT NULL,
    "computed_at" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_scores (
    "day" TEXT PRIMARY KEY,
    "data" TEXT NOT NULL,
    "computed_at" TEXT NOT NULL
);
"""
FEATURES_TABLE = "day_features"
SCORES_TABLE = "day_scores"

T = TypeVar("T")

_DAY_FIELDS = tuple(f.name for f in fields(DayResult) if f.name != "workouts")
_WORKOUT_FIELDS = tuple(f.name for f in fields(WorkoutResult))


def _encode(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, date):  # datetime is a date too
        return value.isoformat()
    return value


def _time(value: str | None) -> datetime | None:
    return None if value is None else datetime.fromisoformat(value)


def jsonable(value: Any) -> Any:
    """Dataclasses as dicts, dates and datetimes as ISO text, tuples as lists."""
    if is_dataclass(value) and not isinstance(value, type):
        return {f.name: jsonable(getattr(value, f.name)) for f in fields(value)}
    if isinstance(value, date):  # datetime is a date too
        return value.isoformat()
    if isinstance(value, list | tuple):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    return value


@cache
def _hints(cls: type) -> dict[str, Any]:
    return get_type_hints(cls)


def _from_json(hint: Any, value: Any) -> Any:
    """Rebuild a value of type `hint` from what jsonable() produced."""
    if value is None:
        return None
    origin = get_origin(hint)
    if origin in (Union, types.UnionType):
        (inner,) = [arg for arg in get_args(hint) if arg is not type(None)]
        return _from_json(inner, value)
    if origin is tuple:
        return tuple(_from_json(get_args(hint)[0], item) for item in value)
    if origin is dict:
        item_hint = get_args(hint)[1]
        return {key: _from_json(item_hint, item) for key, item in value.items()}
    if isinstance(hint, type) and is_dataclass(hint):
        # Fields added later take their defaults; fields since removed are skipped.
        hints = _hints(hint)
        known = {name: item for name, item in value.items() if name in hints}
        return hint(**{name: _from_json(hints[name], item) for name, item in known.items()})
    if hint is datetime:
        return datetime.fromisoformat(value)
    if hint is date:
        return date.fromisoformat(value)
    if hint is float:
        return float(value)
    return value


def _insert(table: str, columns: tuple[str, ...]) -> str:
    names = ", ".join(f'"{column}"' for column in columns)
    marks = ", ".join(f":{column}" for column in columns)
    return f"INSERT OR REPLACE INTO {table} ({names}) VALUES ({marks})"


class Store:
    def __init__(self, path: Path, readonly: bool = False) -> None:
        """`readonly` opens an existing database without creating or changing anything."""
        if readonly:
            self._db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._db = sqlite3.connect(path)
            self._db.executescript(_SCHEMA)
        self._db.row_factory = sqlite3.Row

    def __enter__(self) -> Store:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._db.close()

    def save_day(self, result: DayResult, computed_at: datetime | None = None) -> None:
        """Replace the day's row and all of its workouts in one transaction."""
        row = {name: _encode(getattr(result, name)) for name in _DAY_FIELDS}
        row["computed_at"] = (computed_at or datetime.now(UTC)).isoformat()
        with self._db:
            self._db.execute(_insert("daily", (*_DAY_FIELDS, "computed_at")), row)
            self._db.execute('DELETE FROM workouts WHERE "day" = ?', (result.day.isoformat(),))
            for workout in result.workouts:
                values = {name: _encode(getattr(workout, name)) for name in _WORKOUT_FIELDS}
                self._db.execute(_insert("workouts", _WORKOUT_FIELDS), values)

    def get_day(self, day: date) -> DayResult | None:
        return next(iter(self.days(day, day)), None)

    def days(self, first: date, last: date) -> list[DayResult]:
        """Stored days from `first` to `last` inclusive, oldest first, with their workouts."""
        bounds = (first.isoformat(), last.isoformat())
        workouts: dict[str, list[WorkoutResult]] = {}
        for row in self._db.execute(
            'SELECT * FROM workouts WHERE "day" >= ? AND "day" <= ? ORDER BY "start"', bounds
        ):
            workouts.setdefault(row["day"], []).append(self._workout(row))
        rows = self._db.execute(
            'SELECT * FROM daily WHERE "day" >= ? AND "day" <= ? ORDER BY "day"', bounds
        )
        return [self._day(row, workouts.get(row["day"], [])) for row in rows]

    def span(self) -> tuple[date, date, datetime] | None:
        """First day, last day and the newest computation time; None when nothing is stored."""
        first, last, computed = self._db.execute(
            'SELECT MIN("day"), MAX("day"), MAX("computed_at") FROM daily'
        ).fetchone()
        if first is None:
            return None
        return date.fromisoformat(first), date.fromisoformat(last), datetime.fromisoformat(computed)

    @staticmethod
    def _day(row: sqlite3.Row, workouts: list[WorkoutResult]) -> DayResult:
        data = {name: row[name] for name in _DAY_FIELDS}
        data["day"] = date.fromisoformat(data["day"])
        data["complete"] = bool(data["complete"])
        data["sleep_start"] = _time(data["sleep_start"])
        data["sleep_end"] = _time(data["sleep_end"])
        return DayResult(**data, workouts=tuple(workouts))

    @staticmethod
    def _workout(row: sqlite3.Row) -> WorkoutResult:
        data = {name: row[name] for name in _WORKOUT_FIELDS}
        data["day"] = date.fromisoformat(data["day"])
        data["start"] = datetime.fromisoformat(data["start"])
        data["end"] = datetime.fromisoformat(data["end"])
        return WorkoutResult(**data)

    def save_features(self, features: DayFeatures, computed_at: datetime | None = None) -> None:
        self._save_json(FEATURES_TABLE, features.day, features, computed_at)

    def save_scores(self, scores: DayScores, computed_at: datetime | None = None) -> None:
        self._save_json(SCORES_TABLE, scores.day, scores, computed_at)

    def get_features(self, day: date) -> DayFeatures | None:
        return next(iter(self.features(day, day)), None)

    def get_scores(self, day: date) -> DayScores | None:
        return next(iter(self.scores(day, day)), None)

    def features(self, first: date, last: date) -> list[DayFeatures]:
        """Stored features from `first` to `last` inclusive, oldest first."""
        return self._load_json(FEATURES_TABLE, DayFeatures, first, last)

    def scores(self, first: date, last: date) -> list[DayScores]:
        """Stored scores from `first` to `last` inclusive, oldest first."""
        return self._load_json(SCORES_TABLE, DayScores, first, last)

    def features_span(self) -> tuple[date, date] | None:
        """First and last day with stored features; None when there are none."""
        if not self._has_table(FEATURES_TABLE):
            return None
        first, last = self._db.execute(
            f'SELECT MIN("day"), MAX("day") FROM {FEATURES_TABLE}'
        ).fetchone()
        return None if first is None else (date.fromisoformat(first), date.fromisoformat(last))

    def _save_json(self, table: str, day: date, value: Any, computed_at: datetime | None) -> None:
        row = {
            "day": day.isoformat(),
            "data": json.dumps(jsonable(value)),
            "computed_at": (computed_at or datetime.now(UTC)).isoformat(),
        }
        with self._db:
            self._db.execute(_insert(table, ("day", "data", "computed_at")), row)

    def _load_json(self, table: str, cls: type[T], first: date, last: date) -> list[T]:
        # A read-only store over a database from before these tables has nothing to read.
        if not self._has_table(table):
            return []
        rows = self._db.execute(
            f'SELECT "data" FROM {table} WHERE "day" >= ? AND "day" <= ? ORDER BY "day"',
            (first.isoformat(), last.isoformat()),
        )
        return [_from_json(cls, json.loads(row["data"])) for row in rows]

    def _has_table(self, name: str) -> bool:
        found = self._db.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
        ).fetchone()
        return found is not None

    def max_hr_recent(self, day: date, days: int = 180) -> float | None:
        """Highest stored daily maximum in the `days` up to `day`, capped against spikes."""
        since = (day - timedelta(days=days)).isoformat()
        row = self._db.execute(
            'SELECT MAX("hr_max") FROM daily WHERE "day" >= ? AND "day" <= ?',
            (since, day.isoformat()),
        ).fetchone()
        return None if row[0] is None else min(float(row[0]), MAX_PLAUSIBLE_HR)
