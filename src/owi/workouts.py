"""Drop duplicate workouts and fill in what the API leaves empty."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import date

from owi import estimates, heart
from owi.models import DISTANCE, HEART_RATE, Params, Profile, Sample, Workout, WorkoutResult

SAME_WORKOUT_SECONDS = 120
DISTANCE_MATCH_SECONDS = 60


def dedupe(workouts: Iterable[Workout]) -> list[Workout]:
    """Same type starting within two minutes is one workout; Health Connect's copy wins."""
    ranked = sorted(workouts, key=lambda w: (0 if w.source.is_health_connect else 1, w.start))
    kept: list[Workout] = []
    for item in ranked:
        duplicate = any(
            other.type == item.type
            and abs((other.start - item.start).total_seconds()) <= SAME_WORKOUT_SECONDS
            for other in kept
        )
        if not duplicate:
            kept.append(item)
    return sorted(kept, key=lambda w: w.start)


def _matched_distance(workout: Workout, samples: Sequence[Sample]) -> float | None:
    """Samsung Health writes a workout's distance as one sample stamped at its start."""
    for item in samples:
        if (
            item.type == DISTANCE
            and item.source.is_samsung_health_app
            and abs((item.timestamp - workout.start).total_seconds()) <= DISTANCE_MATCH_SECONDS
        ):
            return item.value
    return None


def enrich(
    workout: Workout,
    samples: Sequence[Sample],
    day: date,
    resting_hr: float | None,
    profile: Profile,
    params: Params,
) -> WorkoutResult:
    in_workout = [
        item
        for item in samples
        if item.type == HEART_RATE and workout.start <= item.timestamp <= workout.end
    ]
    minute_hr = heart.minute_series(in_workout)
    stats = heart.stats(in_workout, minute_hr)
    zones = heart.zone_minutes(minute_hr, profile.max_hr)
    kcal = None
    if minute_hr:
        kcal = estimates.activity_kcal(
            minute_hr, minute_hr.keys(), resting_hr, profile, params.kcal_scale
        )
    distance = workout.distance_m
    if distance is None:
        distance = _matched_distance(workout, samples)

    return WorkoutResult(
        id=workout.id,
        day=day,
        type=workout.type,
        start=workout.start,
        end=workout.end,
        duration_s=round((workout.end - workout.start).total_seconds()),
        source=workout.source.provider,
        hr_avg=stats.avg,
        hr_max=stats.maximum,
        hr_min=stats.minimum,
        zone_light_min=zones.light,
        zone_moderate_min=zones.moderate,
        zone_vigorous_min=zones.vigorous,
        distance_m=distance,
        kcal_est=kcal,
    )
