"""Command line entry point: owi sync | rescore | day | calibrate | check | serve."""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict, replace
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from owi import scoring
from owi.calibration import Truth, compare, fit, load_params, load_truth, save_params
from owi.client import OWClient, OWError
from owi.config import Settings, load_settings
from owi.days import day_window, today
from owi.models import DEFAULT_MAX_HR, HEART_RATE, DayInputs, DayResult, Params, Profile
from owi.pipeline import (
    compute,
    day_features,
    fetch_day,
    has_data,
    load_profile_samples,
    profile_for,
)
from owi.score_models import Person
from owi.serve import MIN_TOKEN_LENGTH, make_server
from owi.store import MAX_PLAUSIBLE_HR, Store

DEFAULT_SYNC_DAYS = 3
SYNC_BATCH_DAYS = 14
TRUTH_HEADER = "date,steps,active_minutes,activity_kcal,total_kcal,distance_km"


def _date(value: str) -> date:
    return date.fromisoformat(value)


def _days_between(first: date, last: date) -> list[date]:
    return [first + timedelta(days=offset) for offset in range((last - first).days + 1)]


def _max_hr(
    settings: Settings, fitted: float | None, store: Store, inputs: dict[date, DayInputs]
) -> float:
    """Configured value, else the one calibration fitted with, else the highest seen.

    "Seen" covers this run's samples and the recently stored days. It shifts with the
    days in the run, which is why a calibrated value takes precedence.
    """
    if settings.max_hr:
        return settings.max_hr
    if fitted:
        return fitted
    seen = [s.value for item in inputs.values() for s in item.samples if s.type == HEART_RATE]
    known = [v for v in (max(seen, default=None), store.max_hr_recent(max(inputs))) if v]
    return min(max(known), MAX_PLAUSIBLE_HR) if known else DEFAULT_MAX_HR


def _fetch(
    settings: Settings,
    fitted_max_hr: float | None,
    client: OWClient,
    store: Store,
    days: list[date],
    now: datetime,
) -> dict[date, DayInputs]:
    """Inputs for every requested day, all sharing one maximum heart rate."""
    tz = ZoneInfo(settings.timezone)
    user_id = settings.user_id or client.user_id()
    _, last_end = day_window(max(days), tz)
    profile_samples = load_profile_samples(client, user_id, last_end)
    defaults = Profile(settings.weight_kg, settings.vo2max, settings.basal_kcal)

    inputs: dict[date, DayInputs] = {}
    for day in sorted(days):
        _, end = day_window(day, tz)
        profile = profile_for(profile_samples, end, defaults)
        inputs[day] = fetch_day(client, user_id, day, tz, profile, now)

    max_hr = _max_hr(settings, fitted_max_hr, store, inputs)
    return {
        day: replace(item, profile=replace(item.profile, max_hr=max_hr))
        for day, item in inputs.items()
    }


def _line(result: DayResult) -> str:
    def show(value: float | None, unit: str = "") -> str:
        return "-" if value is None else f"{value:.0f}{unit}"

    state = "" if result.complete else " (neúplný deň)"
    return (
        f"{result.day}: kroky {show(result.steps)}"
        f", aktívny čas ~{show(result.active_minutes_est, ' min')}"
        f", kalórie z aktivity ~{show(result.activity_kcal_est)}"
        f", spolu ~{show(result.total_kcal_est)}"
        f", tréningy {len(result.workouts)}{state}"
    )


def _person(settings: Settings, profile: Profile) -> Person:
    """What the features of a day need, with the maximum heart rate the day was computed with."""
    return Person(
        age=settings.age,
        sex=settings.sex,
        weight_kg=profile.weight_kg,
        body_fat_pct=profile.body_fat_pct,
        max_hr=profile.max_hr,
    )


def _sync_batch(settings: Settings, days: list[date], now: datetime) -> list[date]:
    """Fetch the whole batch before saving any of it, so a failed batch changes nothing.

    Days are saved in date order, so each day's features see those of the days before it.
    Returns the days that were saved.
    """
    params = load_params(settings.params_path)
    saved: list[date] = []
    with Store(settings.db_path) as store, OWClient(settings.api_url, settings.api_key) as client:
        inputs = _fetch(settings, params.max_hr, client, store, days, now)
        for day in sorted(inputs):
            item = inputs[day]
            if item.complete and not has_data(item):
                continue
            result = compute(item, params, settings.timezone)
            store.save_day(result)
            store.save_features(day_features(store, item, result, _person(settings, item.profile)))
            saved.append(day)
            print(_line(result))
    return saved


def _sync_once(settings: Settings, days: list[date], now: datetime) -> None:
    """Long ranges go in batches to bound memory; finished batches stay saved.

    Scores chain from day to day, so every stored day from the first saved one on is
    rescored, also when a later batch fails.
    """
    first_saved: date | None = None
    try:
        for offset in range(0, len(days), SYNC_BATCH_DAYS):
            saved = _sync_batch(settings, days[offset : offset + SYNC_BATCH_DAYS], now)
            if saved and first_saved is None:
                first_saved = min(saved)
            sys.stdout.flush()
    finally:
        if first_saved is not None:
            _rescore(settings, first_saved)


def _rescore(settings: Settings, first: date, last: date | None = None) -> None:
    """Recompute scores from stored features, from `first` to `last` or the last stored day."""
    params = load_params(settings.params_path)
    base = Person(age=settings.age, sex=settings.sex, max_hr=settings.max_hr or params.max_hr)
    with Store(settings.db_path) as store:
        span = store.features_span()
        if span is None:
            return
        last = last or span[1]
        count = scoring.rescore(store, first, last, base, settings.timezone)
    print(f"skóre prepočítané od {first} do {last}, počet dní: {count}")


def _cmd_sync(args: argparse.Namespace, settings: Settings) -> int:
    tz = ZoneInfo(settings.timezone)
    while True:
        now = datetime.now(UTC)
        last = args.to or today(tz, now)
        first = args.from_ or last - timedelta(days=args.days - 1)
        try:
            _sync_once(settings, _days_between(first, last), now)
        except OWError as exc:
            print(f"chyba: {exc}", file=sys.stderr)
            if not args.loop:
                return 1
        if not args.loop:
            return 0
        sys.stdout.flush()
        time.sleep(args.loop)


def _cmd_rescore(args: argparse.Namespace, settings: Settings) -> int:
    with Store(settings.db_path) as store:
        span = store.features_span()
    if span is None:
        print("nie sú uložené žiadne znaky dní; spusti owi sync", file=sys.stderr)
        return 1
    first, last = args.from_ or span[0], args.to or span[1]
    if first > last:
        print(f"chyba: {first} je po {last}", file=sys.stderr)
        return 1
    _rescore(settings, first, last)
    return 0


def _cmd_day(args: argparse.Namespace, settings: Settings) -> int:
    with Store(settings.db_path) as store:
        result = store.get_day(args.day)
    if result is None:
        print(f"pre {args.day} nie sú uložené žiadne dáta; spusti owi sync", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(asdict(result), default=str, indent=2))
        return 0
    print(_line(result))
    for workout in result.workouts:
        heart_rate = "tep -"
        if workout.hr_avg is not None and workout.hr_max is not None:
            heart_rate = f"tep {workout.hr_avg:.0f}/{workout.hr_max:.0f}"
        print(
            f"  {workout.start:%H:%M} UTC {workout.type}"
            f", {workout.duration_s // 60} min, {heart_rate}"
        )
    return 0


def _truth_inputs(
    settings: Settings, fitted_max_hr: float | None
) -> tuple[list[Truth], dict[date, DayInputs]] | None:
    """Reference days and their freshly fetched inputs, or None after printing why not."""
    if not settings.truth_path.is_file():
        print(
            f"chýba {settings.truth_path}; vytvor ho s hlavičkou {TRUTH_HEADER}",
            file=sys.stderr,
        )
        return None
    truths = load_truth(settings.truth_path)
    if not truths:
        print(f"{settings.truth_path} neobsahuje žiadne dni", file=sys.stderr)
        return None
    with Store(settings.db_path) as store, OWClient(settings.api_url, settings.api_key) as client:
        days = [t.day for t in truths]
        inputs = _fetch(settings, fitted_max_hr, client, store, days, datetime.now(UTC))
    return truths, inputs


def _print_comparison(
    settings: Settings, truths: list[Truth], inputs: dict[date, DayInputs], params: Params
) -> None:
    results = {day: compute(item, params, settings.timezone) for day, item in inputs.items()}
    print(f"{'deň':<12}{'údaj':<16}{'odhad':>10}{'Samsung':>10}{'odchýlka':>10}")
    for row in compare(truths, results):
        estimate = "-" if row.estimate is None else f"{row.estimate:.0f}"
        error = "-" if row.error_pct is None else f"{row.error_pct:+.1f} %"
        print(f"{row.day!s:<12}{row.metric:<16}{estimate:>10}{row.truth:>10.0f}{error:>10}")


def _cmd_calibrate(args: argparse.Namespace, settings: Settings) -> int:
    # A fresh fit also re-derives the maximum heart rate instead of reusing the old one.
    loaded = _truth_inputs(settings, fitted_max_hr=None)
    if loaded is None:
        return 1
    truths, inputs = loaded
    max_hr = next(iter(inputs.values())).profile.max_hr
    params = replace(fit(truths, inputs, load_params(settings.params_path)), max_hr=max_hr)
    save_params(settings.params_path, params)
    print(
        f"stride_m={params.stride_m:.3f} active_hr_delta={params.active_hr_delta:.0f}"
        f" kcal_scale={params.kcal_scale:.3f} max_hr={max_hr:.0f} -> {settings.params_path}"
    )
    _print_comparison(settings, truths, inputs, params)
    return 0


def _cmd_check(args: argparse.Namespace, settings: Settings) -> int:
    params = load_params(settings.params_path)
    loaded = _truth_inputs(settings, params.max_hr)
    if loaded is None:
        return 1
    truths, inputs = loaded
    _print_comparison(settings, truths, inputs, params)
    return 0


def _cmd_serve(args: argparse.Namespace, settings: Settings) -> int:
    if len(settings.serve_token) < MIN_TOKEN_LENGTH:
        print(
            f"chyba: nastav OWI_SERVE_TOKEN (aspoň {MIN_TOKEN_LENGTH} znakov)",
            file=sys.stderr,
        )
        return 1
    server = make_server(
        args.host,
        args.port,
        db_path=settings.db_path,
        token=settings.serve_token,
        timezone=settings.timezone,
    )
    host, port = server.server_address[:2]
    print(f"owi serve počúva na http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="owi", description="Denné metriky z Open Wearables")
    commands = parser.add_subparsers(dest="command", required=True)

    sync = commands.add_parser("sync", help="prepočíta dni a uloží ich")
    sync.add_argument("--days", type=int, default=DEFAULT_SYNC_DAYS, help="koľko posledných dní")
    sync.add_argument("--from", dest="from_", type=_date, help="prvý deň (YYYY-MM-DD)")
    sync.add_argument("--to", type=_date, help="posledný deň (YYYY-MM-DD)")
    sync.add_argument("--loop", type=int, help="opakovať každých N sekúnd")
    sync.set_defaults(run=_cmd_sync)

    rescore = commands.add_parser("rescore", help="prepočíta skóre z uložených znakov dní")
    rescore.add_argument("--from", dest="from_", type=_date, help="prvý deň (YYYY-MM-DD)")
    rescore.add_argument("--to", type=_date, help="posledný deň (YYYY-MM-DD)")
    rescore.set_defaults(run=_cmd_rescore)

    day = commands.add_parser("day", help="vypíše uložený deň")
    day.add_argument("day", type=_date)
    day.add_argument("--json", action="store_true")
    day.set_defaults(run=_cmd_day)

    calibrate = commands.add_parser("calibrate", help="naladí odhady podľa data/truth.csv")
    calibrate.set_defaults(run=_cmd_calibrate)
    check = commands.add_parser("check", help="porovná odhady s data/truth.csv")
    check.set_defaults(run=_cmd_check)

    serve = commands.add_parser("serve", help="sprístupní uložené dni cez HTTP, len na čítanie")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8787)
    serve.set_defaults(run=_cmd_serve)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return args.run(args, load_settings())
    except OWError as exc:
        print(f"chyba: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
