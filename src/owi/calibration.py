"""Tune the estimate parameters to the numbers the user copies from Samsung Health.

The formulas stay as they are; only the numbers inside them move (docs/skore.md §7):
each parameter is fitted on the entries, newer days weighing more, clamped to its bounds,
pulled toward its default while few days stand behind it, and kept at its current value
when the newest quarter of the days says the current value is better.
"""

from __future__ import annotations

import csv
import json
import math
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, fields, replace
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from owi import estimates, heart
from owi.entries import Entry
from owi.models import DayInputs, DayResult, Params, Profile, WorkoutResult

DELTA_RANGE = range(5, 61)
STRIDE_BOUNDS = (0.50, 1.10)
DELTA_BOUNDS = (5.0, 60.0)
SCALE_BOUNDS = (0.5, 1.5)
BASAL_BOUNDS = (1200.0, 2500.0)
HALF_LIFE_DAYS = 60.0
SHRINK_DAYS = 7.0  # a parameter with 7 days of weight behind it goes half way to its fit
HOLDOUT_MIN_DAYS = 6
HOLDOUT_MIN = 2
# (A) Entries older than a year weigh under 2 % and would only cost downloads.
FIT_WINDOW_DAYS = 365
# Open Wearables workout types whose distance comes from steps.
STRIDE_WORKOUT_TYPES = frozenset({"walking", "running", "trail_running", "treadmill"})
PERCENT = "%"
POINTS = "body"


@dataclass(frozen=True)
class Truth:
    """A row of the old data/truth.csv; only `owi entries import` still reads it."""

    day: date
    steps: int | None = None
    active_minutes: float | None = None
    activity_kcal: float | None = None
    total_kcal: float | None = None
    distance_km: float | None = None


@dataclass(frozen=True)
class Comparison:
    day: date
    metric: str
    estimate: float | None
    truth: float
    error_pct: float | None


@dataclass(frozen=True)
class Quality:
    """How far an estimate lands from Samsung: on the newest quarter, or every day under 6.

    `error` is the mean absolute deviation, in percent for estimates and in points for
    scores; `previous_error` is that of the previous values on the same days.
    """

    n: int
    error: float | None
    previous_error: float | None
    unit: str


@dataclass(frozen=True)
class Tuned[V]:
    value: V
    quality: Quality | None


@dataclass(frozen=True)
class FitResult:
    params: Params
    quality: dict[str, Quality]


def _number(raw: str | None) -> float | None:
    raw = (raw or "").strip()
    return float(raw) if raw else None


def load_truth(path: Path) -> list[Truth]:
    """CSV with header date,steps,active_minutes,activity_kcal,total_kcal,distance_km."""
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    truths = []
    for row in rows:
        steps = _number(row.get("steps"))
        truths.append(
            Truth(
                day=date.fromisoformat(row["date"].strip()),
                steps=None if steps is None else int(steps),
                active_minutes=_number(row.get("active_minutes")),
                activity_kcal=_number(row.get("activity_kcal")),
                total_kcal=_number(row.get("total_kcal")),
                distance_km=_number(row.get("distance_km")),
            )
        )
    return truths


def load_params(path: Path) -> Params:
    """Saved parameters; keys this version does not know are skipped."""
    if not path.is_file():
        return Params()
    known = {f.name for f in fields(Params)}
    data = json.loads(path.read_text(encoding="utf-8"))
    return Params(**{name: value for name, value in data.items() if name in known})


def write_atomic(path: Path, text: str) -> None:
    """Write through a temporary file, so a reader never sees half of it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def save_params(path: Path, params: Params) -> None:
    write_atomic(path, json.dumps(asdict(params), indent=2) + "\n")


# Reference days


@dataclass(frozen=True)
class RefDay:
    """What the fit needs of one reference day; its raw samples are not kept."""

    minute_hr: dict[datetime, float]
    resting: float | None
    intervals: tuple[tuple[datetime, datetime], ...]
    start: datetime
    end: datetime
    profile: Profile

    @classmethod
    def of(cls, inputs: DayInputs) -> RefDay:
        minute_hr = heart.minute_series(inputs.samples)
        return cls(
            minute_hr=minute_hr,
            resting=heart.resting_hr(minute_hr),
            intervals=tuple((w.start, w.end) for w in inputs.workouts),
            start=inputs.start,
            end=inputs.end,
            profile=inputs.profile,
        )

    def active(self, delta: float) -> set[datetime]:
        return estimates.active_minutes(
            self.minute_hr, self.resting, self.intervals, self.start, self.end, delta
        )

    def kcal(self, delta: float) -> float | None:
        """Activity calories before scaling."""
        return estimates.activity_kcal(
            self.minute_hr, self.active(delta), self.resting, self.profile, 1.0
        )


@dataclass(frozen=True)
class WorkoutStride:
    """A walk or run with Samsung's distance and the phone pedometer's steps."""

    day: date
    steps: int
    distance_m: float


def stride_samples(workouts: Iterable[WorkoutResult]) -> list[WorkoutStride]:
    """Walks and runs with both a distance and phone steps, with a plausible stride.

    A stride outside the bounds means the phone missed part of the workout (A).
    """
    found = []
    for workout in workouts:
        if workout.type not in STRIDE_WORKOUT_TYPES:
            continue
        if not workout.distance_m or not workout.phone_steps:
            continue
        stride = workout.distance_m / workout.phone_steps
        if STRIDE_BOUNDS[0] <= stride <= STRIDE_BOUNDS[1]:
            found.append(WorkoutStride(workout.day, workout.phone_steps, workout.distance_m))
    return found


# The pieces of the tuning


class _Observed(Protocol):
    @property
    def day(self) -> date: ...

    @property
    def weight(self) -> float: ...


def day_weight(day: date, today: date) -> float:
    """1 today, halving every 60 days back."""
    return 0.5 ** (max(0, (today - day).days) / HALF_LIFE_DAYS)


def shrink(fitted: float, default: float, weight: float) -> float:
    """Part of the way from the default to the fit: n / (n + 7) for n days of weight."""
    return default + weight / (weight + SHRINK_DAYS) * (fitted - default)


def clamp(value: float, bounds: tuple[float, float]) -> float:
    return min(bounds[1], max(bounds[0], value))


def mean_error(pairs: Iterable[tuple[float | None, float]], percent: bool) -> float | None:
    """Mean absolute deviation of estimates from the truth, in percent of it or as is."""
    errors = [
        abs(estimate - truth) / abs(truth) * 100 if percent else abs(estimate - truth)
        for estimate, truth in pairs
        if estimate is not None and (truth != 0 or not percent)
    ]
    return sum(errors) / len(errors) if errors else None


def tune[O: _Observed, V](
    observations: Sequence[O],
    fit: Callable[[Sequence[O]], V],
    error: Callable[[Sequence[O], V], float | None],
    current: V,
    unit: str,
) -> Tuned[V]:
    """Steps 2-4 of the tuning for one parameter (docs/skore.md §7).

    `fit` fits, clamps and shrinks on the given observations. With 6 days or more it is
    first fitted without the newest quarter of the days (at least 2); if that value misses
    those days by more than `current` does, `current` stays. With fewer days there are no
    unseen days to test on, so the new value is only used when it misses the known days no
    more than `current`; without any day `current` stays as well (A: an earlier
    calibration is kept until the entries say something better).
    """
    days = sorted({o.day for o in observations})
    if not days:
        return Tuned(current, None)
    if len(days) < HOLDOUT_MIN_DAYS:
        value = fit(observations)
        new_error, old_error = error(observations, value), error(observations, current)
        if new_error is not None and old_error is not None and new_error > old_error:
            return Tuned(current, Quality(len(days), old_error, old_error, unit))
        return Tuned(value, Quality(len(days), new_error, old_error, unit))
    cutoff = days[-max(HOLDOUT_MIN, math.ceil(len(days) / 4))]
    older = [o for o in observations if o.day < cutoff]
    newest = [o for o in observations if o.day >= cutoff]
    new_error, old_error = error(newest, fit(older)), error(newest, current)
    if new_error is not None and old_error is not None and new_error > old_error:
        return Tuned(current, Quality(len(days), old_error, old_error, unit))
    return Tuned(fit(observations), Quality(len(days), new_error, old_error, unit))


def _weighted_median(pairs: Sequence[tuple[float, float]]) -> float:
    """The lower weighted median of (weight, value) pairs."""
    ordered = sorted(pairs, key=lambda pair: pair[1])
    half = sum(weight for weight, _ in ordered) / 2
    total = 0.0
    for weight, value in ordered:
        total += weight
        if total >= half:
            return value
    return ordered[-1][1]


def _shrunk(
    raw: float | None, subset: Sequence[_Observed], default: float, bounds: tuple[float, float]
) -> float:
    if raw is None:
        return default
    return shrink(clamp(raw, bounds), default, sum(o.weight for o in subset))


# The parameters


@dataclass(frozen=True)
class _StrideObs:
    day: date
    weight: float
    steps: float
    distance_m: float


def _tune_stride(obs: Sequence[_StrideObs], current: float) -> Tuned[float]:
    def fit(subset: Sequence[_StrideObs]) -> float:
        steps = sum(o.weight * o.steps for o in subset)
        raw = sum(o.weight * o.distance_m for o in subset) / steps if steps > 0 else None
        return _shrunk(raw, subset, Params.stride_m, STRIDE_BOUNDS)

    def error(subset: Sequence[_StrideObs], stride: float) -> float | None:
        return mean_error(((o.steps * stride, o.distance_m) for o in subset), percent=True)

    return tune(obs, fit, error, current, PERCENT)


@dataclass(frozen=True)
class _HeartObs:
    day: date
    weight: float
    ref: RefDay
    truth: float


def _tune_delta(obs: Sequence[_HeartObs], current: float) -> Tuned[float]:
    def fit(subset: Sequence[_HeartObs]) -> float:
        """The smallest delta with the least weighted error in active minutes."""
        if not subset:
            return Params.active_hr_delta
        raw, best = float(DELTA_RANGE[0]), math.inf
        for delta in DELTA_RANGE:
            total = sum(o.weight * abs(len(o.ref.active(delta)) - o.truth) for o in subset)
            if total < best:
                raw, best = float(delta), total
        return _shrunk(raw, subset, Params.active_hr_delta, DELTA_BOUNDS)

    def error(subset: Sequence[_HeartObs], delta: float) -> float | None:
        return mean_error(((len(o.ref.active(delta)), o.truth) for o in subset), percent=True)

    return tune(obs, fit, error, current, PERCENT)


@dataclass(frozen=True)
class _KcalObs:
    day: date
    weight: float
    unscaled: float
    truth: float


def _tune_scale(obs: Sequence[_KcalObs], current: float) -> Tuned[float]:
    def fit(subset: Sequence[_KcalObs]) -> float:
        estimate = sum(o.weight * o.unscaled for o in subset)
        raw = sum(o.weight * o.truth for o in subset) / estimate if estimate > 0 else None
        return _shrunk(raw, subset, Params.kcal_scale, SCALE_BOUNDS)

    def error(subset: Sequence[_KcalObs], scale: float) -> float | None:
        return mean_error(((o.unscaled * scale, o.truth) for o in subset), percent=True)

    return tune(obs, fit, error, current, PERCENT)


@dataclass(frozen=True)
class _BasalObs:
    day: date
    weight: float
    basal: float  # Samsung's total minus its activity calories
    total: float
    record: float | None  # the basal owi used that day, from Samsung's record or the config


def _tune_basal(obs: Sequence[_BasalObs], current: float | None) -> Tuned[float | None]:
    """Weighted median of the basal part of Samsung's total.

    The default is "no value", so there is nothing to shrink toward; it leans instead on
    the basal owi already used on those days, when there was one (A).
    """

    def fit(subset: Sequence[_BasalObs]) -> float | None:
        if not subset:
            return None
        raw = clamp(_weighted_median([(o.weight, o.basal) for o in subset]), BASAL_BOUNDS)
        known = [(o.weight, o.record) for o in subset if o.record is not None]
        if not known:
            return raw
        prior = sum(w * r for w, r in known) / sum(w for w, _ in known)
        return shrink(raw, prior, sum(o.weight for o in subset))

    def error(subset: Sequence[_BasalObs], basal: float | None) -> float | None:
        if basal is None:
            return None
        # Total calories with Samsung's own activity calories: only the basal part differs.
        return mean_error(((basal + o.total - o.basal, o.total) for o in subset), percent=True)

    return tune(obs, fit, error, current, PERCENT)


def fit(
    entries: Sequence[Entry],
    refs: Mapping[date, RefDay],
    strides: Sequence[WorkoutStride],
    current: Params,
    today: date,
) -> FitResult:
    """Tune stride, the active heart-rate delta, the calorie scale and the basal, in order.

    `refs` holds the downloaded reference days the heart-based parameters need, `strides`
    the walks and runs that teach the stride without any entry. A parameter no day informs
    is back at its default; `max_hr` stays as it is.
    """
    since = today - timedelta(days=FIT_WINDOW_DAYS)
    entries = [e for e in entries if since < e.day <= today]

    def weight(day: date) -> float:
        return day_weight(day, today)

    stride = _tune_stride(
        [
            _StrideObs(e.day, weight(e.day), e.steps, e.distance_km * 1000)
            for e in entries
            if e.steps and e.distance_km
        ]
        + [
            _StrideObs(s.day, weight(s.day), s.steps, s.distance_m)
            for s in strides
            if since < s.day <= today
        ],
        current.stride_m,
    )
    delta = _tune_delta(
        [
            _HeartObs(e.day, weight(e.day), ref, e.active_minutes)
            for e in entries
            if e.active_minutes is not None
            and (ref := refs.get(e.day)) is not None
            and ref.resting is not None
        ],
        current.active_hr_delta,
    )
    scale = _tune_scale(
        [
            _KcalObs(e.day, weight(e.day), unscaled, e.active_kcal)
            for e in entries
            if e.active_kcal is not None
            and (ref := refs.get(e.day)) is not None
            and (unscaled := ref.kcal(delta.value)) is not None
            and unscaled > 0
        ],
        current.kcal_scale,
    )
    basal = _tune_basal(
        [
            _BasalObs(
                e.day,
                weight(e.day),
                e.total_kcal - e.active_kcal,
                e.total_kcal,
                ref.profile.basal_kcal_per_day if (ref := refs.get(e.day)) else None,
            )
            for e in entries
            if e.total_kcal is not None and e.active_kcal is not None
        ],
        current.basal_kcal,
    )
    tuned = {
        "distance_km": stride,
        "active_minutes": delta,
        "active_kcal": scale,
        "total_kcal": basal,
    }
    return FitResult(
        params=replace(
            current,
            stride_m=stride.value,
            active_hr_delta=delta.value,
            kcal_scale=scale.value,
            basal_kcal=basal.value,
        ),
        quality={name: t.quality for name, t in tuned.items() if t.quality is not None},
    )


def compare(entries: Sequence[Entry], results: Mapping[date, DayResult]) -> list[Comparison]:
    rows = []
    for entry in entries:
        result = results.get(entry.day)
        if result is None:
            continue
        distance_km = None if result.distance_m_est is None else result.distance_m_est / 1000
        pairs: tuple[tuple[str, Any, float | None], ...] = (
            ("steps", result.steps, entry.steps),
            ("active_minutes", result.active_minutes_est, entry.active_minutes),
            ("active_kcal", result.activity_kcal_est, entry.active_kcal),
            ("total_kcal", result.total_kcal_est, entry.total_kcal),
            ("distance_km", distance_km, entry.distance_km),
        )
        for metric, estimate, reference in pairs:
            if reference is None:
                continue
            error = None
            if estimate is not None and reference != 0:
                error = (estimate - reference) / reference * 100
            rows.append(
                Comparison(
                    entry.day,
                    metric,
                    None if estimate is None else float(estimate),
                    float(reference),
                    error,
                )
            )
    return rows
