"""In-memory stand-in for OWClient."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from owi.models import Sample, SleepSession, Workout


class FakeClient:
    """Answers like the API: both ends of a range are inclusive, so callers must clip."""

    def __init__(
        self,
        samples: Sequence[Sample] = (),
        workouts: Sequence[Workout] = (),
        sleeps: Sequence[SleepSession] = (),
        user: str = "u1",
    ) -> None:
        self._samples = list(samples)
        self._workouts = list(workouts)
        self._sleeps = list(sleeps)
        self._user = user

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

    def workouts(self, user_id: str, start: datetime, end: datetime) -> list[Workout]:
        return [w for w in self._workouts if start <= w.start <= end]

    def sleeps(self, user_id: str, start: datetime, end: datetime) -> list[SleepSession]:
        return [s for s in self._sleeps if start <= s.start <= end]
