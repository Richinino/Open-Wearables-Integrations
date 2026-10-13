"""Choose the day's main sleep and drop duplicates reported by several sources."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from owi.models import SleepSession


@dataclass(frozen=True)
class SleepSummary:
    main: SleepSession
    nap_minutes: float


def minutes_asleep(session: SleepSession) -> float:
    if session.sleep_minutes is not None:
        return session.sleep_minutes
    return (session.end - session.start).total_seconds() / 60


def _overlap(a: SleepSession, b: SleepSession) -> bool:
    return a.start < b.end and b.start < a.end


def dedupe(sessions: Iterable[SleepSession]) -> list[SleepSession]:
    """Of overlapping sessions keep Health Connect's, then the longer one."""
    ranked = sorted(
        sessions, key=lambda s: (0 if s.source.is_health_connect else 1, -minutes_asleep(s))
    )
    kept: list[SleepSession] = []
    for session in ranked:
        if not any(_overlap(session, other) for other in kept):
            kept.append(session)
    return sorted(kept, key=lambda s: s.start)


def summarize(sessions: Iterable[SleepSession]) -> SleepSummary | None:
    unique = dedupe(sessions)
    if not unique:
        return None
    main = max(unique, key=minutes_asleep)
    naps = sum(minutes_asleep(s) for s in unique if s is not main)
    return SleepSummary(main=main, nap_minutes=naps)
