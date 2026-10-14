"""Long-term markers: VO2max from heart rates (Uth-Sorensen) and a WHOOP Age estimate.

WHOOP Age follows the WHOOP 2025 Healthspan white paper ("WP", PDF revised 4 Sep 2025,
page numbers as printed). Each metric's average over the last 180 days gets an age impact of
10 * ln(HR) years, HR being its hazard ratio against WHOOP's target (WP p. 12), and WHOOP Age
is the person's age plus the impacts (WP p. 18). WHOOP also shrinks the hazard ratios for
overlap between correlated metrics with factors it does not publish (WP p. 15); this estimate
cannot, so it lands further from the real age than WHOOP would. Values marked (A) are our
assumptions where WP gives no figure.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import timedelta
from itertools import pairwise
from statistics import fmean, pstdev

from owi.score_models import FEMALE, MALE, DayFeatures, Person, Score

ESTIMATE = "estimate"
TOO_LITTLE_HISTORY = "too little history"

UTH_FACTOR = 15.3  # Uth et al. 2004

WINDOW_DAYS = 180  # "the last 6 months of WHOOP data" (WP p. 18)
MIN_WORN_DAYS = 30
MIN_WEAR_MINUTES = 1000  # less worn days undercount activity (docs/skore.md §6)
MIN_METRIC_DAYS = 7
YEARS_PER_LOG_HR = 10.0  # all-cause mortality rises about 10 % per year of age (WP p. 12)
OLDER_ADULT_AGE = 60  # WP p. 25 cites Paluch 2022, which splits at 60
DAY_MINUTES = 1440

# Sleep duration (WP p. 22): under 7 h adds years, short sleep HR 1.12 (Itani 2017). (A): that
# HR per hour short of 7 h, not extrapolated below 5 h. WP's "minor reduction" for 7-9 h has
# no figure and was not significant, so nothing is subtracted; over 9 h has no effect.
SLEEP_TARGET_HOURS = 7.0
SLEEP_POINTS = ((5.0, 1.12**2), (7.0, 1.0))

# Sleep consistency (WP p. 21): target 70 %, Windred 2024 cited for 20-48 % lower mortality.
# Points: Windred's fully adjusted HRs at each SRI quintile's median, against the least
# regular quintile (the adjustment includes physical activity, which limits double counting).
CONSISTENCY_TARGET = 70.0
CONSISTENCY_POINTS = ((65.10, 1.0), (75.62, 0.80), (80.99, 0.75), (85.22, 0.72), (89.80, 0.70))

# Steps (WP p. 25, Table 1 p. 29): HR 0.77 per 1,000 steps a day; target 8,000, or 5,600 for
# older adults. Benefits level off over 8,000-10,000 (6,000-8,000 past 60, Paluch 2022); the
# full slope up to the middle of that band equals one tapering to zero across it (A). Lower
# end 2,200 steps, the reference level of Stens 2023 (WP ref. 59).
STEPS_HR_PER_1000 = 0.77
STEPS_FLOOR = 2200.0
STEPS_TARGET = (8000.0, 5600.0)  # (younger, older adult)
STEPS_PLATEAU = (9000.0, 7000.0)

# Zones 1-3 (WP p. 23, p. 29): target 100 min a week, 70 for older adults. (A) from WP's
# "20 % to nearly 50 %" lower mortality with 5-7 h of activity a week (Lee 2022): HR 0.65 at
# 360 min, log-linear from none up to 600 min, where WP says the benefit stops growing.
ZONE_LOW_TARGET = (100.0, 70.0)
ZONE_LOW_HR, ZONE_LOW_HR_MINUTES, ZONE_LOW_CAP = 0.65, 360.0, 600.0

# Zones 4-5 (same pages): target 10 min a week, 7 for older adults. (A) from WP's 15-20 min of
# vigorous activity a week with 18-24 % lower mortality (Ahmadi 2022): HR 0.79 at 17.5 min,
# not extrapolated past 20 min (WP p. 38 avoids going beyond the evidence).
ZONE_HIGH_TARGET = (10.0, 7.0)
ZONE_HIGH_HR, ZONE_HIGH_HR_MINUTES, ZONE_HIGH_CAP = 0.79, 17.5, 20.0

# Strength (WP p. 24): target 40 min a week. (A) from WP's 30-60 min a week with 10-30 % lower
# mortality (Momma 2022): HR 0.80 at 45 min. Momma's lowest risk lies at 30-60 min, so nothing
# more past 60 min (WP: nothing more past 2 h).
STRENGTH_TARGET = 40.0
STRENGTH_HR, STRENGTH_HR_MINUTES, STRENGTH_CAP = 0.80, 45.0, 60.0

# VO2max (WP p. 26): HR 0.87 per MET of 3.5 ml/kg/min; minimum targets from Figure 4.
VO2MAX_HR_PER_MET = 0.87
ML_PER_MET = 3.5
VO2MAX_TARGET_AGES = tuple(range(20, 101, 5))
VO2MAX_TARGETS = {
    MALE: (46, 46, 44, 42, 40, 37, 36, 34, 32, 30, 29, 27, 26, 25, 23, 22, 21),
    FEMALE: (40, 40, 38, 36, 34, 32, 30, 29, 27, 26, 25, 23, 22, 21, 20, 19, 18),
}

# Resting heart rate (WP p. 27): HR 1.09 per 10 bpm (Zhang 2016); neutral at 60 / 64 bpm.
RHR_HR_PER_10 = 1.09
RHR_TARGET = {MALE: 60.0, FEMALE: 64.0}

# Lean mass (WP p. 28): HR 1.11 per 10 points of body fat (Jayedi 2022); target 80 % for men
# and 67 % for women of 30. WP says the target changes with age but gives no other values, so
# these apply at every age (A). Without body fat the metric has no effect (WP p. 28).
BODY_FAT_HR_PER_10 = 1.11
LEAN_TARGET = {MALE: 80.0, FEMALE: 67.0}


def vo2max_uth(max_hr: float | None, resting_hr: float | None) -> float | None:
    """Uth-Sorensen VO2max in ml/kg/min: 15.3 * HRmax / HRrest."""
    if max_hr is None or resting_hr is None or resting_hr <= 0:
        return None
    return UTH_FACTOR * max_hr / resting_hr


def vo2max_target(age: int, sex: str | None) -> float:
    """WHOOP's minimum VO2max for an age (WP Figure 4); without a sex the male one."""
    targets = VO2MAX_TARGETS[FEMALE if sex == FEMALE else MALE]
    return _interpolate(list(zip(VO2MAX_TARGET_AGES, targets, strict=True)), age)


def whoop_age(history: Sequence[DayFeatures], person: Person) -> Score:
    """WHOOP Age from the last 180 days; components are each metric's impact in years."""
    if person.age is None:
        return Score(None, note="age missing")
    if not history:
        return Score(None, note=TOO_LITTLE_HISTORY)
    last = history[-1].day
    window = [d for d in history if last - timedelta(days=WINDOW_DAYS) < d.day <= last]
    worn = [d for d in window if d.wear_minutes >= MIN_WEAR_MINUTES]
    components = _impacts(window, worn, person, person.age)
    if len(worn) < MIN_WORN_DAYS:
        return Score(None, components, TOO_LITTLE_HISTORY)
    impacts = [v for v in components.values() if v is not None]
    if not impacts:
        return Score(None, components, "no data")
    return Score(round(person.age + sum(impacts), 1), components, ESTIMATE)


def _impacts(
    window: Sequence[DayFeatures], worn: Sequence[DayFeatures], person: Person, age: int
) -> dict[str, float | None]:
    sex = FEMALE if person.sex == FEMALE else MALE
    group = 1 if age >= OLDER_ADULT_AGE else 0
    sleep = _mean([d.sleep_minutes for d in window], MIN_METRIC_DAYS)
    steps = _mean([d.steps for d in worn], MIN_METRIC_DAYS)
    vo2max = _mean([d.vo2max for d in window], 1)
    resting = _mean([d.resting_hr for d in window], MIN_METRIC_DAYS)
    body_fat = _mean([d.body_fat_pct for d in window], 1)
    if body_fat is None:
        body_fat = person.body_fat_pct
    steps_points = _slope_points(STEPS_FLOOR, STEPS_PLATEAU[group], STEPS_HR_PER_1000, 1000.0)
    return {
        "sleep_duration": _impact(
            SLEEP_POINTS, None if sleep is None else sleep / 60, SLEEP_TARGET_HOURS
        ),
        "sleep_consistency": _impact(
            CONSISTENCY_POINTS, _onset_consistency(window), CONSISTENCY_TARGET
        ),
        "steps": _impact(steps_points, steps, STEPS_TARGET[group]),
        "zone_1_3": _impact(
            _slope_points(0.0, ZONE_LOW_CAP, ZONE_LOW_HR, ZONE_LOW_HR_MINUTES),
            _weekly([d.zone_low_minutes for d in worn]),
            ZONE_LOW_TARGET[group],
        ),
        "zone_4_5": _impact(
            _slope_points(0.0, ZONE_HIGH_CAP, ZONE_HIGH_HR, ZONE_HIGH_HR_MINUTES),
            _weekly([d.zone_high_minutes for d in worn]),
            ZONE_HIGH_TARGET[group],
        ),
        "strength": _impact(
            _slope_points(0.0, STRENGTH_CAP, STRENGTH_HR, STRENGTH_HR_MINUTES),
            _weekly([d.strength_minutes for d in worn]),
            STRENGTH_TARGET,
        ),
        "vo2max": _linear_impact(vo2max, vo2max_target(age, sex), VO2MAX_HR_PER_MET, ML_PER_MET),
        "resting_hr": _linear_impact(resting, RHR_TARGET[sex], RHR_HR_PER_10, 10.0),
        # More body fat is the exposure, so lean mass below target counts as excess fat.
        "lean_mass": _linear_impact(body_fat, 100.0 - LEAN_TARGET[sex], BODY_FAT_HR_PER_10, 10.0),
    }


def _mean(values: Sequence[float | None], minimum: int) -> float | None:
    present = [v for v in values if v is not None]
    return fmean(present) if len(present) >= minimum else None


def _weekly(daily_minutes: Sequence[float | None]) -> float | None:
    mean = _mean(daily_minutes, MIN_METRIC_DAYS)
    return None if mean is None else 7 * mean


def _onset_consistency(window: Sequence[DayFeatures]) -> float | None:
    """100 minus the SD of sleep onset in minutes, kept within 0-100 (A).

    WHOOP compares sleep and wake times with the 4 days before (WP p. 21), which needs
    per-night timing DayFeatures does not keep; an onset SD of 30 minutes meets its 70 %.
    Clock times are circular, so the SD is taken around the circular mean.
    """
    onsets = [
        s.hour * 60 + s.minute + s.second / 60 for d in window if (s := d.sleep_start) is not None
    ]
    if len(onsets) < MIN_METRIC_DAYS:
        return None
    angles = [2 * math.pi * m / DAY_MINUTES for m in onsets]
    centre = math.atan2(fmean(map(math.sin, angles)), fmean(map(math.cos, angles)))
    centre_minutes = centre * DAY_MINUTES / (2 * math.pi)
    half = DAY_MINUTES / 2
    deviations = [(m - centre_minutes + half) % DAY_MINUTES - half for m in onsets]
    return min(100.0, max(0.0, 100 - pstdev(deviations)))


def _slope_points(
    low: float, high: float, hr: float, per: float
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Points for a hazard ratio of `hr` per `per` units between `low` and `high`."""
    return ((low, 1.0), (high, hr ** ((high - low) / per)))


def _impact(
    points: Sequence[tuple[float, float]], value: float | None, target: float
) -> float | None:
    """Years for `value` against `target`, ln(HR) linear between points and flat outside."""
    if value is None:
        return None
    log_points = [(x, math.log(hr)) for x, hr in points]
    return YEARS_PER_LOG_HR * (_interpolate(log_points, value) - _interpolate(log_points, target))


def _linear_impact(
    value: float | None, target: float, hr_per_unit: float, unit: float
) -> float | None:
    if value is None:
        return None
    return YEARS_PER_LOG_HR * math.log(hr_per_unit) * (value - target) / unit


def _interpolate(points: Sequence[tuple[float, float]], x: float) -> float:
    """Piecewise-linear through `points` (ascending x), flat beyond the ends."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in pairwise(points):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return points[-1][1]
