"""Estimates of Samsung's Sleep Score and Energy Score, tuned on the user's entries.

Samsung says what each score is built from but not how (docs/skore.md §7). owi scores each
part 0-100 from DayFeatures; the score is the weighted mean of the parts, with weights learnt
from the scores the user copies from Samsung Health. Before 10 entries of a score there is
no estimate, only how many entries it still needs.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import fmean
from zoneinfo import ZoneInfo

from owi import readiness, sleep_scores
from owi.calibration import POINTS, SHRINK_DAYS, Quality, mean_error, tune, write_atomic
from owi.score_models import DayFeatures, NightSignal, Person, Score

SLEEP_PARTS = ("duration", "deep", "rem", "efficiency", "interruptions", "latency")
ENERGY_PARTS = ("sleep", "regularity", "timing", "load", "night_hr")
SLEEP_SCORE = "samsung_sleep"
ENERGY_SCORE = "energy_score"
MIN_ENTRIES = 10
LEARNING = "learning"
ESTIMATE = "estimate"
NO_DATA = "no data"
AWAKE = "awake"

# Sleep Score parts (A unless noted)
DEEP_TARGET = 0.20  # share of sleep; Oura 15-20 %, Polar ~17 %
REM_TARGET = 0.25  # Polar's ideal REM share
WASO_GOOD, WASO_ZERO = 20.0, 60.0  # minutes; NSF (Ohayon 2017): <= 20 good, >= 41 poor
LATENCY_GOOD, LATENCY_ZERO = 15.0, 45.0  # minutes; NSF: <= 15 good, >= 46 poor

# Energy Score parts (A)
ENERGY_SLEEP_DAYS = 7
MIN_ENERGY_NIGHTS = 3
TIMING_DAYS = 14
MIN_TIMING_NIGHTS = 3
TIMING_ZERO_MINUTES = 180.0  # a midpoint three hours off the usual scores 0
LOAD_DAYS = 28
MIN_LOAD_DAYS = 14  # as the Polar status: half of the 28 days measured
LOAD_POINTS_PER_RATIO = 50.0  # yesterday at twice the usual load costs 50 points
NIGHT_HR_POINTS_PER_BPM = 12.5  # NightSignal's red line, +4 bpm, costs 50 points
# The sleep scores read at most 15 days (scoring.SLEEP_WINDOW_DAYS).
SRI_WINDOW_DAYS = 15
MIN_RIDGE_VARIANCE = 1.0  # points squared; keeps the system solvable on identical days


@dataclass(frozen=True)
class ScoreModel:
    """Learnt weights of one score and how many entries of it they come from."""

    entries: int = 0
    weights: dict[str, float] | None = None  # None: every part weighs the same


@dataclass(frozen=True)
class SamsungModels:
    sleep: ScoreModel = field(default_factory=ScoreModel)
    energy: ScoreModel = field(default_factory=ScoreModel)


@dataclass(frozen=True)
class ScoreObs:
    """One entry of a score: the day's parts and Samsung's value."""

    day: date
    weight: float
    parts: Mapping[str, float | None]
    truth: float


def _clamp(value: float) -> float:
    return readiness.clamp_score(value)


def need_minutes(person: Person) -> float:
    """8 h for teenagers (NSF, AASM), else 7.5 h: the sleep need's defaults."""
    teen = person.age is not None and person.age < 18
    baseline = sleep_scores.TEEN_BASELINE if teen else sleep_scores.ADULT_BASELINE
    return baseline[0]


# Sleep Score


def _share(minutes: float | None, total: float, target: float) -> float | None:
    if minutes is None or total <= 0:
        return None
    return 100 * min(1.0, minutes / total / target)


def _falling(value: float, good: float, zero: float) -> float:
    """100 up to `good`, then linearly down to 0 at `zero`."""
    return _clamp(100 - max(0.0, value - good) * 100 / (zero - good))


def _latency(night: DayFeatures) -> float | None:
    """Minutes from going to bed to the first sleep stage of the main sleep."""
    start, end = night.sleep_start, night.sleep_end
    if start is None or end is None:
        return None
    asleep = [
        i.start
        for i in night.sleep_intervals
        if i.stage != AWAKE and start <= i.start and i.end <= end
    ]
    if not asleep:
        return None
    return max(0.0, (min(asleep) - start).total_seconds() / 60)


def sleep_parts(night: DayFeatures, person: Person) -> dict[str, float | None]:
    """Parts of the night that ended on the day, as Samsung lists them: time asleep against
    the need, deep sleep (physical recovery), REM (mental recovery), efficiency, wake after
    sleep onset and the time it took to fall asleep."""
    total = night.sleep_minutes
    if total is None:
        return dict.fromkeys(SLEEP_PARTS)
    in_bed = night.in_bed_minutes
    latency = _latency(night)
    return {
        "duration": 100 * min(1.0, total / need_minutes(person)),
        "deep": _share(night.deep_minutes, total, DEEP_TARGET),
        "rem": _share(night.rem_minutes, total, REM_TARGET),
        "efficiency": 100 * min(1.0, total / in_bed) if in_bed else None,
        "interruptions": (
            None
            if night.awake_minutes is None
            else _falling(night.awake_minutes, WASO_GOOD, WASO_ZERO)
        ),
        "latency": None if latency is None else _falling(latency, LATENCY_GOOD, LATENCY_ZERO),
    }


# Energy Score


def _midpoint(day: DayFeatures) -> datetime | None:
    if day.sleep_start is None or day.sleep_end is None:
        return None
    return day.sleep_start + (day.sleep_end - day.sleep_start) / 2


def _energy_sleep(history: Sequence[DayFeatures], day: date, person: Person) -> float | None:
    first = day - timedelta(days=ENERGY_SLEEP_DAYS - 1)
    nights = [
        f.sleep_minutes + f.nap_minutes
        for f in history
        if first <= f.day <= day and f.sleep_minutes is not None
    ]
    if len(nights) < MIN_ENERGY_NIGHTS:
        return None
    return 100 * min(1.0, fmean(nights) / need_minutes(person))


def _timing(history: Sequence[DayFeatures], today: DayFeatures, tz: ZoneInfo) -> float | None:
    """The night's midpoint against the circular median of the 14 nights before."""
    middle = _midpoint(today)
    if middle is None:
        return None
    first = today.day - timedelta(days=TIMING_DAYS)
    earlier = [
        sleep_scores._clock_minutes(m, tz)
        for f in history
        if first <= f.day < today.day and (m := _midpoint(f)) is not None
    ]
    if len(earlier) < MIN_TIMING_NIGHTS:
        return None
    delta = sleep_scores._signed_clock_difference(
        sleep_scores._clock_minutes(middle, tz), sleep_scores._circular_median(earlier)
    )
    return _clamp(100 - abs(delta) * 100 / TIMING_ZERO_MINUTES)


def _load(history: Sequence[DayFeatures], day: date) -> float | None:
    """Yesterday's TRIMP against the mean of the 28 days up to it, like an ACWR."""
    yesterday = day - timedelta(days=1)
    first = yesterday - timedelta(days=LOAD_DAYS - 1)
    measured = {
        f.day: f.trimp
        for f in history
        if first <= f.day <= yesterday
        and f.trimp is not None
        and f.wear_minutes >= readiness.MIN_WEAR_MINUTES
    }
    if yesterday not in measured or len(measured) < MIN_LOAD_DAYS:
        return None
    usual = fmean(measured.values())
    if usual <= 0:
        return None
    ratio = measured[yesterday] / usual
    return _clamp(100 - LOAD_POINTS_PER_RATIO * max(0.0, ratio - 1))


def energy_parts(
    history: Sequence[DayFeatures],
    person: Person,
    timezone: str,
    regularity: float | None,
    night: NightSignal,
) -> dict[str, float | None]:
    """Parts of the morning of the last day of `history`, from Samsung's list: sleep over
    7 days, its regularity and timing, yesterday's load and the night's heart rate.
    Samsung also uses HRV, which owi does not have."""
    today = history[-1]
    return {
        "sleep": _energy_sleep(history, today.day, person),
        "regularity": (
            None if regularity is None else readiness.sleep_regularity_score(regularity)
        ),
        "timing": _timing(history, today, ZoneInfo(timezone)),
        "load": _load(history, today.day),
        "night_hr": (
            None
            if night.delta is None
            else _clamp(100 - NIGHT_HR_POINTS_PER_BPM * max(0.0, night.delta))
        ),
    }


def day_parts(
    history: Sequence[DayFeatures], person: Person, timezone: str
) -> tuple[dict[str, float | None], dict[str, float | None]]:
    """Sleep and Energy parts of the last day of `history`, oldest first."""
    today = history[-1]
    recent = [f for f in history if f.day > today.day - timedelta(days=SRI_WINDOW_DAYS)]
    regularity = sleep_scores.sleep_regularity_index(recent, timezone)
    night = readiness.night_signal(history)
    return sleep_parts(today, person), energy_parts(history, person, timezone, regularity, night)


# The estimate


def predict(parts: Mapping[str, float | None], weights: Mapping[str, float]) -> float | None:
    """Weighted mean of the known parts, the weights renormalised over them, clamped."""
    known = {name: value for name, value in parts.items() if value is not None}
    if not known:
        return None
    total = sum(weights.get(name, 0.0) for name in known)
    if total <= 0:
        return _clamp(fmean(known.values()))
    return _clamp(sum(weights.get(name, 0.0) * value for name, value in known.items()) / total)


def _equal(names: Sequence[str]) -> dict[str, float]:
    return dict.fromkeys(names, 1 / len(names))


def estimate(parts: dict[str, float | None], model: ScoreModel) -> Score:
    if model.entries < MIN_ENTRIES:
        return Score(None, {"entries": model.entries, "needed": MIN_ENTRIES}, LEARNING)
    value = predict(parts, model.weights or _equal(tuple(parts)))
    if value is None:
        return Score(None, parts, NO_DATA)
    return Score(round(value, 1), parts, ESTIMATE)


# Learning the weights


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting; the matrix is small and positive definite."""
    size = len(vector)
    rows = [[*matrix[i], vector[i]] for i in range(size)]
    for col in range(size):
        pivot = max(range(col, size), key=lambda r: abs(rows[r][col]))
        rows[col], rows[pivot] = rows[pivot], rows[col]
        for r in range(col + 1, size):
            factor = rows[r][col] / rows[col][col]
            for c in range(col, size + 1):
                rows[r][c] -= factor * rows[col][c]
    result = [0.0] * size
    for r in range(size - 1, -1, -1):
        known = sum(rows[r][c] * result[c] for c in range(r + 1, size))
        result[r] = (rows[r][size] - known) / rows[r][r]
    return result


def ridge_weights(
    rows: Sequence[tuple[float, Mapping[str, float | None], float]], names: Sequence[str]
) -> dict[str, float]:
    """Weights of the parts from (day weight, parts, Samsung's score) rows.

    Weighted ridge regression pulled toward equal weights, with a pull worth 7 days of the
    parts' variance, the same n / (n + 7) as the estimate parameters (A). A missing part is
    filled with the mean of the day's known parts. The weights are then clipped at 0 and
    scaled to sum to 1.
    """
    prior = _equal(names)
    data = []
    for weight, parts, truth in rows:
        known = [parts.get(name) for name in names if parts.get(name) is not None]
        if not known:
            continue
        fill = fmean(known)
        values = [v if (v := parts.get(name)) is not None else fill for name in names]
        data.append((weight, values, truth))
    total = sum(weight for weight, _, _ in data)
    if total <= 0:
        return prior

    size = len(names)
    means = [sum(w * x[i] for w, x, _ in data) / total for i in range(size)]
    variance = fmean(
        sum(w * (x[i] - means[i]) ** 2 for w, x, _ in data) / total for i in range(size)
    )
    pull = SHRINK_DAYS * max(variance, MIN_RIDGE_VARIANCE)
    matrix = [
        [sum(w * x[i] * x[j] for w, x, _ in data) + (pull if i == j else 0.0) for j in range(size)]
        for i in range(size)
    ]
    vector = [sum(w * x[i] * y for w, x, y in data) + pull * prior[names[i]] for i in range(size)]
    clipped = [max(0.0, beta) for beta in _solve(matrix, vector)]
    if sum(clipped) <= 0:
        return prior
    return {name: beta / sum(clipped) for name, beta in zip(names, clipped, strict=True)}


def tune_model(
    observations: Sequence[ScoreObs], current: ScoreModel, entries: int
) -> tuple[ScoreModel, Quality | None]:
    """New weights for one score from its entries, with the holdout check of the parameters.

    `entries` counts every entry of the score, also those of days without features. The
    quality is reported once the estimate is shown; the previous error only when the previous
    weights were shown too.
    """
    names = tuple(observations[0].parts) if observations else ()
    if not names:
        return ScoreModel(entries, current.weights), None

    def fit(subset: Sequence[ScoreObs]) -> dict[str, float]:
        return ridge_weights([(o.weight, o.parts, o.truth) for o in subset], names)

    def error(subset: Sequence[ScoreObs], weights: dict[str, float]) -> float | None:
        return mean_error(((predict(o.parts, weights), o.truth) for o in subset), percent=False)

    tuned = tune(observations, fit, error, current.weights or _equal(names), POINTS)
    model = ScoreModel(entries, tuned.value)
    quality = tuned.quality
    if entries < MIN_ENTRIES or quality is None:
        return model, None
    if current.entries < MIN_ENTRIES:
        quality = Quality(quality.n, quality.error, None, quality.unit)
    return model, quality


# The weights file


def _model(data: Mapping[str, object] | None) -> ScoreModel:
    if not data:
        return ScoreModel()
    weights = data.get("weights")
    return ScoreModel(int(data.get("entries") or 0), dict(weights) if weights else None)


def load_models(path: Path) -> SamsungModels:
    if not path.is_file():
        return SamsungModels()
    data = json.loads(path.read_text(encoding="utf-8"))
    return SamsungModels(sleep=_model(data.get(SLEEP_SCORE)), energy=_model(data.get(ENERGY_SCORE)))


def save_models(path: Path, models: SamsungModels) -> None:
    data = {
        SLEEP_SCORE: {"entries": models.sleep.entries, "weights": models.sleep.weights},
        ENERGY_SCORE: {"entries": models.energy.entries, "weights": models.energy.weights},
    }
    write_atomic(path, json.dumps(data, indent=2) + "\n")
