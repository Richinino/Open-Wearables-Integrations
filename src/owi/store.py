"""SQLite storage for computed days and workouts."""

from __future__ import annotations

import sqlite3
from dataclasses import fields
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from owi.models import DayResult, WorkoutResult

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
"""

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

    def max_hr_recent(self, day: date, days: int = 180) -> float | None:
        """Highest stored daily maximum in the `days` up to `day`, capped against spikes."""
        since = (day - timedelta(days=days)).isoformat()
        row = self._db.execute(
            'SELECT MAX("hr_max") FROM daily WHERE "day" >= ? AND "day" <= ?',
            (since, day.isoformat()),
        ).fetchone()
        return None if row[0] is None else min(float(row[0]), MAX_PLAUSIBLE_HR)
