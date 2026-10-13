"""Reference values from Samsung Health and the parameters fitted to them."""

from __future__ import annotations

import csv
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path

from owi import estimates, heart
from owi.models import DayInputs, DayResult, Params

DELTA_RANGE = range(5, 61)


@dataclass(frozen=True)
class Truth:
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
    if not path.is_file():
        return Params()
    return Params(**json.loads(path.read_text(encoding="utf-8")))


def save_params(path: Path, params: Params) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(params), indent=2) + "\n", encoding="utf-8")


@dataclass(frozen=True)
class _DayHeart:
    inputs: DayInputs
    minute_hr: dict[datetime, float]
    resting: float | None

    def active(self, delta: float) -> set[datetime]:
        intervals = [(w.start, w.end) for w in self.inputs.workouts]
        return estimates.active_minutes(
            self.minute_hr, self.resting, intervals, self.inputs.start, self.inputs.end, delta
        )


def _fit_stride(truths: Sequence[Truth], default: float) -> float:
    pairs = [(t.steps, t.distance_km) for t in truths if t.steps and t.distance_km]
    if not pairs:
        return default
    return sum(km for _, km in pairs) * 1000 / sum(steps for steps, _ in pairs)


def _fit_delta(days: Sequence[tuple[Truth, _DayHeart]], default: float) -> float:
    usable = [
        (truth, day)
        for truth, day in days
        if truth.active_minutes is not None and day.resting is not None
    ]
    if not usable:
        return default
    best_delta, best_error = default, None
    for delta in DELTA_RANGE:
        error = sum(
            abs(len(day.active(float(delta))) - truth.active_minutes) for truth, day in usable
        )
        if best_error is None or error < best_error:
            best_delta, best_error = float(delta), error
    return best_delta


def _fit_scale(days: Sequence[tuple[Truth, _DayHeart]], delta: float, default: float) -> float:
    truth_total = estimate_total = 0.0
    for truth, day in days:
        if truth.activity_kcal is None:
            continue
        estimate = estimates.activity_kcal(
            day.minute_hr, day.active(delta), day.resting, day.inputs.profile, 1.0
        )
        if estimate is None or estimate <= 0:
            continue
        truth_total += truth.activity_kcal
        estimate_total += estimate
    return default if estimate_total <= 0 else truth_total / estimate_total


def fit(truths: Sequence[Truth], inputs_by_day: Mapping[date, DayInputs], base: Params) -> Params:
    """Fit stride, the active heart-rate delta and the calorie scale, in that order.

    Each parameter keeps its `base` value when no reference day can inform it.
    """
    days = []
    for truth in truths:
        inputs = inputs_by_day.get(truth.day)
        if inputs is None:
            continue
        minute_hr = heart.minute_series(inputs.samples)
        days.append((truth, _DayHeart(inputs, minute_hr, heart.resting_hr(minute_hr))))

    delta = _fit_delta(days, base.active_hr_delta)
    return Params(
        stride_m=_fit_stride(truths, base.stride_m),
        active_hr_delta=delta,
        kcal_scale=_fit_scale(days, delta, base.kcal_scale),
        max_hr=base.max_hr,
    )


def compare(truths: Sequence[Truth], results: Mapping[date, DayResult]) -> list[Comparison]:
    rows = []
    for truth in truths:
        result = results.get(truth.day)
        if result is None:
            continue
        distance_km = None if result.distance_m_est is None else result.distance_m_est / 1000
        pairs = (
            ("steps", result.steps, truth.steps),
            ("active_minutes", result.active_minutes_est, truth.active_minutes),
            ("activity_kcal", result.activity_kcal_est, truth.activity_kcal),
            ("total_kcal", result.total_kcal_est, truth.total_kcal),
            ("distance_km", distance_km, truth.distance_km),
        )
        for metric, estimate, reference in pairs:
            if reference is None:
                continue
            error = None
            if estimate is not None and reference != 0:
                error = (estimate - reference) / reference * 100
            rows.append(
                Comparison(
                    truth.day,
                    metric,
                    None if estimate is None else float(estimate),
                    float(reference),
                    error,
                )
            )
    return rows
