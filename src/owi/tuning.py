"""When owi tunes itself on the user's entries, the tuning as a whole, and what the API says.

The tuning reads one entry per day: the user's, filled in with the numbers Samsung sends by
itself (auto entries). The sync loop refits when any value it would read changed since the
last fit, and otherwise once a day. New estimate parameters mean every stored day is
recomputed, at most once in 24 hours; new score weights only mean a rescore
(docs/skore.md §7).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime, timedelta
from typing import Any

from owi import calibration, entries, samsung_scores
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
# Entry fields Samsung sends by itself, and the DayFeatures that hold them.
AUTO_FIELDS = {
    "steps": "samsung_steps",
    "active_kcal": "samsung_active_kcal",
    "sleep_score": "samsung_sleep_score",
}
# Sums over the day: only a finished day's are whole. The Sleep Score is final in the morning.
WHOLE_DAY_FIELDS = frozenset({"steps", "active_kcal"})
# (A) Every finished day brings Samsung's active calories, but the calorie scale needs each
# day's heart rate downloaded again. Four weeks of them pull the scale about three quarters
# of the way (n / (n + 7)) and keep a fit's downloads to a month.
AUTO_REFERENCE_DAYS = 28


@dataclass(frozen=True)
class Tuning:
    params: Params
    models: SamsungModels
    quality: dict[str, Quality]


@dataclass(frozen=True)
class Signature:
    """What a fit sees: how many days, a digest of their values, the newest save."""

    entries: int
    digest: str
    saved_at: str | None  # newest saved_at of the user's entries, kept in the history


def estimate_params(params: Params) -> dict[str, float | None]:
    """The values the stored days' estimates depend on; max_hr is not tuned here."""
    return {name: getattr(params, name) for name in ESTIMATE_PARAMS}


# Auto entries


def auto_values(features: DayFeatures) -> dict[str, float | int | None]:
    """Samsung's own steps, active calories and Sleep Score of the day; a value outside the
    ranges of an entry is no value (an early sync once stored a distance as calories)."""
    values, _ = entries.validate(
        {name: getattr(features, source) for name, source in AUTO_FIELDS.items()}
    )
    return {name: values[name] for name in AUTO_FIELDS}


def auto_json(features: DayFeatures | None) -> dict[str, float | int | None] | None:
    """`samsung_auto` of a day in GET /v1/days: the auto values, or None without any."""
    if features is None:
        return None
    values = auto_values(features)
    return values if any(value is not None for value in values.values()) else None


def merge(manual: Sequence[Entry], features: Sequence[DayFeatures]) -> list[Entry]:
    """One entry per day as the tuning reads it, oldest first.

    A field the user entered wins. Otherwise Samsung's own number fills the Sleep Score on any
    day, and steps and active calories once the day is over. The other fields (distance,
    active time, total calories, Energy Score) come only from the user.
    """
    merged = {entry.day: entry for entry in manual}
    for day in features:
        entry = merged.get(day.day, Entry(day.day))
        filled = {
            name: value
            for name, value in auto_values(day).items()
            if value is not None
            and getattr(entry, name) is None
            and (day.complete or name not in WHOLE_DAY_FIELDS)
        }
        if filled:
            merged[day.day] = replace(entry, **filled)
    return sorted(merged.values(), key=lambda entry: entry.day)


def signature(merged: Sequence[Entry]) -> Signature:
    """Changes whenever a value the fit reads changes: an entry saved or deleted, or a number
    Samsung sent that fills in for it. Saving the same numbers again changes nothing."""
    rows = [[e.day.isoformat(), *(getattr(e, name) for name in entries.FIELDS)] for e in merged]
    digest = hashlib.sha256(json.dumps(rows).encode()).hexdigest()[:16]
    saved = [e.saved_at for e in merged if e.saved_at is not None]
    return Signature(len(merged), digest, max(saved).isoformat() if saved else None)


def reference_days(manual: Sequence[Entry], merged: Sequence[Entry], today: date) -> list[date]:
    """Days whose heart rate a fit downloads again: the user's entries with active time or
    calories, and the days of the last four weeks with Samsung's active calories."""
    days = {
        e.day
        for e in manual
        if e.active_minutes is not None or e.active_kcal is not None or e.total_kcal is not None
    }
    since = today - timedelta(days=AUTO_REFERENCE_DAYS)
    days |= {e.day for e in merged if e.active_kcal is not None and e.day > since}
    return sorted(days)


# When


def fit_due(last: FitRecord | None, signature: Signature, now: datetime) -> bool:
    if last is None or (last.entries, last.signature) != (signature.entries, signature.digest):
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


def record(result: Tuning, signature: Signature, now: datetime) -> FitRecord:
    """The params_history row of a tuning run."""
    weights = {
        SLEEP_SCORE: asdict(result.models.sleep),
        ENERGY_SCORE: asdict(result.models.energy),
    }
    return FitRecord(
        fitted_at=now,
        entries=signature.entries,
        entries_saved_at=signature.saved_at,
        params={**asdict(result.params), "score_weights": weights},
        quality={name: asdict(quality) for name, quality in result.quality.items()},
        signature=signature.digest,
    )


def summary(last: FitRecord | None, params: Params) -> dict[str, Any]:
    """The `calibration` block of GET /v1/days.

    `entries` counts the days the last fit read: those with the user's entry or an auto value
    (Sleep Score on any day, steps and active calories on finished days).
    """
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
