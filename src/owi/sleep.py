"""Choose the day's main sleep and drop duplicates reported by several sources."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from owi.models import SleepSession, source_order


@dataclass(frozen=True)
class SleepSummary:
    main: SleepSession
    nap_minutes: float


def minutes_asleep(session: SleepSession) -> float:
    if session.sleep_minutes is not None:
        return session.sleep_minutes
    if session.intervals:
        return sum(
            (i.end - i.start).total_seconds() / 60 for i in session.intervals if i.stage != "awake"
        )
    return (session.end - session.start).total_seconds() / 60


def stage_minutes(session: SleepSession, stage: str) -> float | None:
    """Reported stage duration, else the normalized stage intervals; unknown stays missing."""
    reported = getattr(session, f"{stage}_minutes")
    if reported is not None:
        return reported
    if not any(i.stage in ("deep", "rem", "light") for i in session.intervals):
        return None
    return sum(
        (i.end - i.start).total_seconds() / 60 for i in session.intervals if i.stage == stage
    )


def _overlap(a: SleepSession, b: SleepSession) -> bool:
    return a.start < b.end and b.start < a.end


def dedupe(sessions: Iterable[SleepSession]) -> list[SleepSession]:
    """Of overlapping sessions keep the preferred provider/device, then the longer one."""
    ranked = sorted(sessions, key=lambda s: (source_order(s.source), -minutes_asleep(s), s.id))
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
