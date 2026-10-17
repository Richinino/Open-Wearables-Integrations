"""When owi tunes itself on the user's entries, the tuning as a whole, and what the API says.

The sync loop refits when an entry was saved or deleted since the last fit, and otherwise
once a day. New estimate parameters mean every stored day is recomputed, at most once in
24 hours; new score weights only mean a rescore (docs/skore.md §7).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from typing import Any

from owi import calibration, samsung_scores
from owi.calibration import Quality, RefDay, WorkoutStride
from owi.entries import Entry
from owi.models import Params
from owi.samsung_scores import ENERGY_SCORE, SLEEP_SCORE, SamsungModels, ScoreObs
from owi.score_models import DayFeatures, Person
from owi.store import FitRecord

ESTIMATE_PARAMS = ("stride_m", "active_hr_delta", "kcal_scale", "basal_kcal")
REFIT_EVERY = timedelta(days=1)
RECOMPUTE_EVERY = timedelta(days=1)
# The longest look back of any score (scoring.HISTORY_DAYS); the score parts read no further.
HISTORY_DAYS = 180


@dataclass(frozen=True)
class Tuning:
    params: Params
    models: SamsungModels
    quality: dict[str, Quality]


def estimate_params(params: Params) -> dict[str, float | None]:
    """The values the stored days' estimates depend on; max_hr is not tuned here."""
    return {name: getattr(params, name) for name in ESTIMATE_PARAMS}


def fit_due(last: FitRecord | None, signature: tuple[int, str | None], now: datetime) -> bool:
    if last is None or (last.entries, last.entries_saved_at) != signature:
        return True
    return now - last.fitted_at >= REFIT_EVERY


def recompute_due(
    state: tuple[dict[str, Any], datetime | None] | None,
    params: Params,
    now: datetime,
    force: bool = False,
) -> bool:
    """True when the stored days were computed with other values than `params` and the last
    full recompute is 24 hours old (or never happened, or `force`)."""
    if state is None:
        return False
    computed_with, recomputed_at = state
    if computed_with == estimate_params(params):
        return False
    return force or recomputed_at is None or now - recomputed_at >= RECOMPUTE_EVERY


def score_observations(
    entries: Sequence[Entry],
    features: Sequence[DayFeatures],
    person: Person,
    timezone: str,
    today: date,
) -> tuple[list[ScoreObs], list[ScoreObs]]:
    """Sleep Score and Energy Score entries with the parts of their day, oldest first.

    Days without stored features have no parts and are left out.
    """
    ordered = sorted(features, key=lambda f: f.day)
    by_day = {f.day: index for index, f in enumerate(ordered)}
    sleep: list[ScoreObs] = []
    energy: list[ScoreObs] = []
    for entry in sorted(entries, key=lambda e: e.day):
        if entry.sleep_score is None and entry.energy_score is None:
            continue
        index = by_day.get(entry.day)
        if index is None:
            continue
        first = entry.day - timedelta(days=HISTORY_DAYS - 1)
        history = [f for f in ordered[: index + 1] if f.day >= first]
        sleep_parts, energy_parts = samsung_scores.day_parts(history, person, timezone)
        weight = calibration.day_weight(entry.day, today)
        if entry.sleep_score is not None:
            sleep.append(ScoreObs(entry.day, weight, sleep_parts, entry.sleep_score))
        if entry.energy_score is not None:
            energy.append(ScoreObs(entry.day, weight, energy_parts, entry.energy_score))
    return sleep, energy


def run(
    entries: Sequence[Entry],
    refs: Mapping[date, RefDay],
    strides: Sequence[WorkoutStride],
    features: Sequence[DayFeatures],
    person: Person,
    timezone: str,
    params: Params,
    models: SamsungModels,
    today: date,
) -> Tuning:
    """Tune the estimate parameters and the weights of both Samsung estimates."""
    since = today - timedelta(days=calibration.FIT_WINDOW_DAYS)
    entries = [e for e in entries if since < e.day <= today]
    estimates = calibration.fit(entries, refs, strides, params, today)
    sleep_obs, energy_obs = score_observations(entries, features, person, timezone, today)
    sleep, sleep_quality = samsung_scores.tune_model(
        sleep_obs, models.sleep, sum(1 for e in entries if e.sleep_score is not None)
    )
    energy, energy_quality = samsung_scores.tune_model(
        energy_obs, models.energy, sum(1 for e in entries if e.energy_score is not None)
    )
    quality = dict(estimates.quality)
    if sleep_quality is not None:
        quality["sleep_score"] = sleep_quality
    if energy_quality is not None:
        quality["energy_score"] = energy_quality
    return Tuning(estimates.params, SamsungModels(sleep, energy), quality)


def record(result: Tuning, signature: tuple[int, str | None], now: datetime) -> FitRecord:
    """The params_history row of a tuning run."""
    weights = {
        SLEEP_SCORE: asdict(result.models.sleep),
        ENERGY_SCORE: asdict(result.models.energy),
    }
    return FitRecord(
        fitted_at=now,
        entries=signature[0],
        entries_saved_at=signature[1],
        params={**asdict(result.params), "score_weights": weights},
        quality={name: asdict(quality) for name, quality in result.quality.items()},
    )


def summary(last: FitRecord | None, params: Params) -> dict[str, Any]:
    """The `calibration` block of GET /v1/days."""
    current, defaults = estimate_params(params), estimate_params(Params())
    if last is None or last.entries == 0:
        return {
            "fitted_at": None,
            "entries": 0,
            "params": current,
            "defaults": defaults,
            "quality": {},
        }
    return {
        "fitted_at": last.fitted_at.isoformat(),
        "entries": last.entries,
        "params": current,
        "defaults": defaults,
        "quality": last.quality,
    }
