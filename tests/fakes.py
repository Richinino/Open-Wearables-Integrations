"""In-memory stand-in for OWClient."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime
from typing import Any

from owi.models import HealthScore, Sample, SleepSession, Workout


class FakeClient:
    """Answers like the API: both ends of a range are inclusive, so callers must clip."""

    def __init__(
        self,
        samples: Sequence[Sample] = (),
        workouts: Sequence[Workout] = (),
        sleeps: Sequence[SleepSession] = (),
        user: str = "u1",
        health_scores: Sequence[HealthScore] = (),
        ow_users: Sequence[dict[str, Any]] = (),
        connections: Sequence[dict[str, Any]] = (),
        summary: dict[str, Any] | None = None,
    ) -> None:
        self._ow_users = list(ow_users)
        self._connections = list(connections)
        self._summary = summary or {"by_provider": []}
        self.head_calls: list[str] = []
        self._samples = list(samples)
        self._workouts = list(workouts)
        self._sleeps = list(sleeps)
        self._user = user
        self._health_scores = list(health_scores)

    def __enter__(self) -> FakeClient:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def close(self) -> None:
        return None

    def user_id(self) -> str:
        return self._user

    def timeseries(
        self, user_id: str, types: Sequence[str], start: datetime, end: datetime
    ) -> list[Sample]:
        return [s for s in self._samples if s.type in types and start <= s.timestamp <= end]

    def users(self) -> list[dict[str, Any]]:
        return list(self._ow_users)

    def connections(self, user_id: str) -> list[dict[str, Any]]:
        return list(self._connections)

    def data_summary(self, user_id: str) -> dict[str, Any]:
        return self._summary

    def sample_head(self, user_id: str, type_: str, start: datetime, end: datetime) -> list[Sample]:
        self.head_calls.append(type_)
        return self.timeseries(user_id, [type_], start, end)[:1]

    def workouts(self, user_id: str, start: datetime, end: datetime) -> list[Workout]:
        return [w for w in self._workouts if start <= w.start <= end]

    def sleeps(self, user_id: str, start: datetime, end: datetime) -> list[SleepSession]:
        return [s for s in self._sleeps if start <= s.start <= end]

    def health_scores(
        self, user_id: str, category: str, provider: str, first: date, last: date
    ) -> list[HealthScore]:
        """Scores whose UTC date of recorded_at falls between `first` and `last`."""
        return [
            s
            for s in self._health_scores
            if s.category == category
            and s.provider == provider
            and first <= s.recorded_at.date() <= last
        ]
