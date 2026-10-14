"""Sleep scores: WHOOP sleep need and Sleep Performance, Apple Sleep Score, Sleep Regularity Index.

Every function reads `history` oldest first and scores its last day D. The night of D is the
main sleep that ended on D. Formulas and sources: docs/skore.md, sections 1 and 3.

Minute-level comparisons (consistency, regularity) use noon-to-noon local days: the day of D
runs from noon on D-1 to noon on D, so it holds the whole night of D, while the night after D
is not known yet. Minutes are indexed by local clock time from noon, so days line up across
DST changes: on the 25-hour day the repeated hour keeps its first pass and the second is
dropped; on the 23-hour day the skipped hour stays unknown and is left out of comparisons.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import date, datetime, time, timedelta
from statistics import median
from zoneinfo import ZoneInfo

from owi.score_models import DayFeatures, Person, Score

AWAKE = "awake"
DAY_MINUTES = 1440
NOON_MINUTE = 720

# Sleep need (WHOOP), minutes: (default, lowest, highest) baseline
ADULT_BASELINE = (450.0, 420.0, 540.0)
TEEN_BASELINE = (480.0, 480.0, 600.0)  # 8-10 h for 13-18 year olds (NSF, AASM)
BASELINE_NIGHTS = 60
LOW_STRAIN = 10.0
BASELINE_PERCENTILE = 0.75
MAX_DEBT = 120.0

PERFORMANCE_WEIGHTS = {"hours_vs_needed": 0.70, "consistency": 0.15, "efficiency": 0.15}
CONSISTENCY_DAYS = 4

APPLE_MAX = {"duration": 50.0, "bedtime": 30.0, "interruptions": 20.0}
BEDTIME_NIGHTS = 13
MIN_BEDTIME_NIGHTS = 3

MIN_SRI_DAY_PAIRS = 5


def sleep_need_minutes(
    history: Sequence[DayFeatures], person: Person, previous_need: float | None
) -> float | None:
    """Minutes of sleep needed the night after D (WHOOP, US12318226B2 as reconstructed)."""
    if not history:
        return None
    day = history[-1]
    debt = 0.0
    if previous_need is not None and day.sleep_minutes is not None:
        debt = min(MAX_DEBT, 0.5 * max(0.0, previous_need - day.sleep_minutes))
    need = _baseline(history, person) + _strain_minutes(day.strain) + debt - day.nap_minutes
    # Only an implausibly long nap gets here; a negative need would break the ratio downstream.
    return max(0.0, need)


def _baseline(history: Sequence[DayFeatures], person: Person) -> float:
    teen = person.age is not None and person.age < 18
    default, lowest, highest = TEEN_BASELINE if teen else ADULT_BASELINE
    nights = [f for f in history if f.sleep_minutes is not None]
    if len(nights) < BASELINE_NIGHTS:
        return default
    strain_by_day = {f.day: f.strain for f in history}
    rested = [
        f.sleep_minutes
        for f in nights
        if (strain := strain_by_day.get(f.day - timedelta(days=1))) is not None
        and strain < LOW_STRAIN
    ]
    if not rested:
        return default
    return min(highest, max(lowest, _percentile(rested, BASELINE_PERCENTILE)))


def _strain_minutes(strain: float | None) -> float:
    if strain is None:
        return 0.0
    return 60 * 1.7 / (1 + math.exp((17 - strain) / 3.5))


def _percentile(values: Sequence[float], q: float) -> float:
    """Linear interpolation between closest ranks (numpy's default)."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low = math.floor(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def sleep_performance(
    history: Sequence[DayFeatures], need_minutes: float | None, timezone: str
) -> Score:
    """WHOOP Sleep Performance: the night of D against the need set the day before."""
    if not history:
        return Score(None, note="no data")
    day = history[-1]
    sleep = day.sleep_minutes
    components = {
        "hours_vs_needed": _hours_vs_needed(sleep, need_minutes),
        "consistency": _consistency(history, ZoneInfo(timezone)),
        "efficiency": _efficiency(sleep, day.in_bed_minutes),
    }
    if sleep is None:
        return Score(None, components, "no sleep recorded")
    if need_minutes is None:
        return Score(None, components, "no sleep need from the day before")
    available = {k: v for k, v in components.items() if v is not None}
    total_weight = sum(PERFORMANCE_WEIGHTS[k] for k in available)
    value = sum(PERFORMANCE_WEIGHTS[k] * v for k, v in available.items()) / total_weight
    return Score(round(value, 1), components, _missing_note(components))


def _hours_vs_needed(sleep: float | None, need: float | None) -> float | None:
    if sleep is None or need is None:
        return None
    if need <= 0:
        return 100.0
    return 100 * min(1.0, sleep / need)


def _efficiency(sleep: float | None, in_bed: float | None) -> float | None:
    if sleep is None or in_bed is None or in_bed <= 0:
        return None
    return 100 * min(1.0, sleep / in_bed)


def _consistency(history: Sequence[DayFeatures], tz: ZoneInfo) -> float | None:
    """Minutes asleep on all of the last 4 days over minutes asleep on any of them, x100."""
    last = history[-1].day
    days = [last - timedelta(days=i) for i in range(CONSISTENCY_DAYS - 1, -1, -1)]
    with_sleep = _days_with_sleep(history)
    if any(d not in with_sleep for d in days):
        return None
    asleep = _asleep_minutes(history)
    windows = [_local_day(d, tz, asleep) for d in days]
    known = [slot for slot in zip(*windows, strict=True) if None not in slot]
    on_all = sum(1 for slot in known if all(slot))
    on_any = sum(1 for slot in known if any(slot))
    if on_any == 0:
        return None
    return 100 * on_all / on_any


def apple_sleep_score(history: Sequence[DayFeatures], timezone: str) -> Score:
    """Apple Sleep Score for the night of D: duration 50, bedtime 30, interruptions 20."""
    if not history or history[-1].sleep_minutes is None:
        return Score(None, note="no sleep recorded")
    night = history[-1]
    notes: list[str] = []
    bedtime, bedtime_note = _apple_bedtime(history, ZoneInfo(timezone))
    if bedtime_note:
        notes.append(bedtime_note)
    if night.deep_minutes is None or night.rem_minutes is None:
        notes.append("no sleep stages, no stage deductions")
    components = {
        "duration": _apple_duration(night),
        "bedtime": bedtime,
        "interruptions": _apple_interruptions(night),
    }
    available = {k: v for k, v in components.items() if v is not None}
    value = sum(available.values())
    if len(available) < len(components):
        # Scale what is known to the 0-100 range rather than counting missing parts as 0.
        value = 100 * value / sum(APPLE_MAX[k] for k in available)
        notes.append(_missing_note(components))
    return Score(round(value, 1), components, "; ".join(notes) or None)


def _apple_duration(night: DayFeatures) -> float:
    sleep = night.sleep_minutes or 0.0
    short = max(0.0, 470 - sleep)
    points = 50 - min(50.0, 13 * (short / 120) ** 2.4)
    if sleep > 0:
        if night.deep_minutes is not None and night.deep_minutes < 0.10 * sleep:
            points -= 5
        if night.rem_minutes is not None and night.rem_minutes < 0.15 * sleep:
            points -= 5
    return max(0.0, points)


def _apple_bedtime(history: Sequence[DayFeatures], tz: ZoneInfo) -> tuple[float | None, str | None]:
    night = history[-1]
    if night.sleep_start is None:
        return None, None
    # Only the 13 calendar days before D, so a gap in the data can't pull in stale bedtimes.
    first = night.day - timedelta(days=BEDTIME_NIGHTS)
    previous = [
        _clock_minutes(f.sleep_start, tz)
        for f in history[:-1]
        if f.sleep_start is not None and first <= f.day < night.day
    ]
    if len(previous) < MIN_BEDTIME_NIGHTS:
        return APPLE_MAX["bedtime"], f"bedtime needs {MIN_BEDTIME_NIGHTS} earlier nights"
    delta = _signed_clock_difference(
        _clock_minutes(night.sleep_start, tz), _circular_median(previous)
    )
    late = min(30.0, (delta - 15) / 4.5) if delta > 15 else 0.0
    early = min(6.0, (-delta - 60) / 30) if delta < -60 else 0.0
    return 30 - late - early, None


def _apple_interruptions(night: DayFeatures) -> float | None:
    if night.awake_minutes is None and night.awake_bouts is None:
        return None
    waso = night.awake_minutes or 0.0
    bouts = night.awake_bouts or 0
    return 20 - min(20.0, max(0.0, waso - 11) / 4 + max(0, bouts - 2) / 2)


def _clock_minutes(moment: datetime, tz: ZoneInfo) -> float:
    local = moment.astimezone(tz)
    return local.hour * 60 + local.minute + local.second / 60


def _signed_clock_difference(a: float, b: float) -> float:
    """a - b on the 24-hour circle, in [-720, 720)."""
    return (a - b + NOON_MINUTE) % DAY_MINUTES - NOON_MINUTE


def _circular_median(clock_minutes: Sequence[float]) -> float:
    """Median clock time. The circle is cut at its widest empty gap and the times are read
    as a line from there, so 23:50 and 00:10 stay ten minutes apart."""
    ordered = sorted(m % DAY_MINUTES for m in clock_minutes)
    gaps = [b - a for a, b in zip(ordered, ordered[1:], strict=False)]
    gaps.append(ordered[0] + DAY_MINUTES - ordered[-1])
    cut = gaps.index(max(gaps)) + 1
    line = ordered[cut:] + [m + DAY_MINUTES for m in ordered[:cut]]
    return median(line) % DAY_MINUTES


def sleep_regularity_index(
    history: Sequence[DayFeatures], timezone: str, days: int = 14
) -> float | None:
    """Phillips et al. 2017: how often a minute's sleep/wake state matches 24 h later."""
    if not history:
        return None
    tz = ZoneInfo(timezone)
    last = history[-1].day
    span = [last - timedelta(days=i) for i in range(days - 1, -1, -1)]
    with_sleep = _days_with_sleep(history)
    asleep = _asleep_minutes(history)
    windows = {d: _local_day(d, tz, asleep) for d in span if d in with_sleep}
    day_pairs = pairs = concordant = 0
    for d in span[:-1]:
        today, tomorrow = windows.get(d), windows.get(d + timedelta(days=1))
        if today is None or tomorrow is None:
            continue
        day_pairs += 1
        for a, b in zip(today, tomorrow, strict=True):
            if a is not None and b is not None:
                pairs += 1
                concordant += a == b
    if day_pairs < MIN_SRI_DAY_PAIRS:
        return None
    return round(200 * concordant / pairs - 100, 1)


def _days_with_sleep(history: Sequence[DayFeatures]) -> set[date]:
    """Days with sleep data. Days without any are unknown, not a day spent awake."""
    return {f.day for f in history if any(i.stage != AWAKE for i in f.sleep_intervals)}


def _asleep_minutes(history: Sequence[DayFeatures]) -> set[int]:
    """Epoch minutes covered by a non-awake stage (main sleep or nap) and no awake stage."""
    asleep: set[int] = set()
    awake: set[int] = set()
    for features in history:
        for interval in features.sleep_intervals:
            first = math.ceil(interval.start.timestamp() / 60)
            end = math.ceil(interval.end.timestamp() / 60)
            (awake if interval.stage == AWAKE else asleep).update(range(first, end))
    return asleep - awake


def _local_day(day: date, tz: ZoneInfo, asleep: set[int]) -> list[bool | None]:
    """Asleep or not per local clock minute from noon on the day before to noon on `day`,
    slot 0 = 12:00. None where the clock skipped (see the module docstring)."""
    start = datetime.combine(day - timedelta(days=1), time(12), tzinfo=tz)
    end = datetime.combine(day, time(12), tzinfo=tz)
    slots: list[bool | None] = [None] * DAY_MINUTES
    for minute in range(int(start.timestamp()) // 60, int(end.timestamp()) // 60):
        local = datetime.fromtimestamp(minute * 60, tz)
        slot = (local.hour * 60 + local.minute - NOON_MINUTE) % DAY_MINUTES
        if slots[slot] is None:
            slots[slot] = minute in asleep
    return slots


def _missing_note(components: dict[str, float | None]) -> str | None:
    missing = [k for k, v in components.items() if v is None]
    return f"without {', '.join(missing)}" if missing else None
