"""Command line entry point: owi sync | rescore | day | calibrate | check | entries | users | ..."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from owi import entries, samsung_scores, scoring, tuning, users
from owi.accounts import Account, Accounts, OwUser
from owi.calibration import (
    FIT_WINDOW_DAYS,
    RefDay,
    compare,
    load_params,
    load_truth,
    save_params,
    stride_samples,
)
from owi.client import OWClient, OWError, summary_pairs
from owi.config import Settings, load_settings
from owi.days import day_window, today
from owi.entries import Entry
from owi.models import (
    DEFAULT_MAX_HR,
    HEART_RATE,
    SAMSUNG_PROVIDER,
    DayInputs,
    DayResult,
    Params,
    Profile,
    Sample,
)
from owi.pipeline import (
    DAY_TYPES,
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
ARRIVING_DAYS = 7


def _now() -> datetime:
    return datetime.now(UTC)


def _date(value: str) -> date:
    return date.fromisoformat(value)


def _days_between(first: date, last: date) -> list[date]:
    return [first + timedelta(days=offset) for offset in range((last - first).days + 1)]


@dataclass
class Seen:
    """What a user's sync run saw of the data: the newest sample, whether any came from
    Samsung, and which (provider, type) pairs had a sample in the last week."""

    latest: datetime | None = None
    samsung: bool = False
    arriving: set[tuple[str, str]] = field(default_factory=set)
    covers_week: bool = False

    def observe(self, samples: Sequence[Sample], since: datetime) -> None:
        for item in samples:
            if self.latest is None or item.timestamp > self.latest:
                self.latest = item.timestamp
            self.note(item, since)

    def note(self, item: Sample, since: datetime) -> None:
        source = item.source
        self.samsung = self.samsung or source.is_samsung_direct or source.is_samsung_health_app
        if item.timestamp >= since:
            self.arriving.add((source.provider, item.type))


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


def _person(settings: Settings, profile: Profile, day: date) -> Person:
    """What the features of a day need, with the maximum heart rate the day was computed with."""
    return Person(
        age=settings.age_on(day),
        sex=settings.sex,
        weight_kg=profile.weight_kg,
        body_fat_pct=profile.body_fat_pct,
        max_hr=profile.max_hr,
    )


def _sync_batch(
    settings: Settings, days: list[date], now: datetime, seen: Seen | None = None
) -> list[date]:
    """Fetch the whole batch before saving any of it, so a failed batch changes nothing.

    Days are saved in date order, so each day's features see those of the days before it.
    Returns the days that were saved.
    """
    params = load_params(settings.params_path)
    saved: list[date] = []
    with Store(settings.db_path) as store, OWClient(settings.api_url, settings.api_key) as client:
        inputs = _fetch(settings, params.max_hr, client, store, days, now)
        if seen is not None:
            for item in inputs.values():
                seen.observe(item.samples, now - timedelta(days=ARRIVING_DAYS))
        for day in sorted(inputs):
            item = inputs[day]
            if item.complete and not has_data(item):
                continue
            result = compute(item, params, settings.timezone)
            store.save_day(result)
            store.save_features(
                day_features(store, item, result, _person(settings, item.profile, day))
            )
            saved.append(day)
            print(_line(result))
    return saved


def _sync_once(
    settings: Settings, days: list[date], now: datetime, seen: Seen | None = None
) -> None:
    """Long ranges go in batches to bound memory; finished batches stay saved.

    Scores chain from day to day, so every stored day from the first saved one on is
    rescored, also when a later batch fails.
    """
    first_saved: date | None = None
    try:
        for offset in range(0, len(days), SYNC_BATCH_DAYS):
            saved = _sync_batch(settings, days[offset : offset + SYNC_BATCH_DAYS], now, seen)
            if saved and first_saved is None:
                first_saved = min(saved)
            sys.stdout.flush()
    finally:
        if first_saved is not None:
            _rescore(settings, first_saved)


def _rescore(settings: Settings, first: date, last: date | None = None) -> None:
    """Recompute scores from stored features, from `first` to `last` or the last stored day."""
    params = load_params(settings.params_path)
    models = samsung_scores.load_models(settings.score_weights_path)
    base = Person(age=settings.age, sex=settings.sex, max_hr=settings.max_hr or params.max_hr)
    with Store(settings.db_path) as store:
        span = store.features_span()
        if span is None:
            return
        last = last or span[1]
        count = scoring.rescore(
            store, first, last, base, settings.timezone, models, settings.age_on
        )
    print(f"skóre prepočítané od {first} do {last}, počet dní: {count}")


def _reference_days(
    settings: Settings, max_hr: float | None, days: list[date], now: datetime
) -> tuple[dict[date, RefDay], float | None]:
    """Downloaded reference days slimmed to what the fit needs, a batch at a time.

    Every batch shares the maximum heart rate the first one settled on.
    """
    refs: dict[date, RefDay] = {}
    if not days:
        return refs, max_hr
    with Store(settings.db_path) as store, OWClient(settings.api_url, settings.api_key) as client:
        for offset in range(0, len(days), SYNC_BATCH_DAYS):
            batch = days[offset : offset + SYNC_BATCH_DAYS]
            for day, item in _fetch(settings, max_hr, client, store, batch, now).items():
                refs[day] = RefDay.of(item)
                max_hr = item.profile.max_hr
    return refs, max_hr


FitEntries = tuple[list[Entry], list[Entry], tuning.Signature]


def _fit_entries(settings: Settings, now: datetime) -> FitEntries:
    """The user's entries of the last year, the same filled in with Samsung's own numbers
    (auto entries), and the signature of what a fit would read."""
    last = today(ZoneInfo(settings.timezone), now)
    first = last - timedelta(days=FIT_WINDOW_DAYS - 1)
    manual = entries.load(settings.entries_path, first, last)
    with Store(settings.db_path) as store:
        features = store.features(first, last)
    merged = tuning.merge(manual, features)
    return manual, merged, tuning.signature(merged)


def _fit(
    settings: Settings,
    now: datetime,
    inputs: dict[date, DayInputs] | None = None,
    loaded: FitEntries | None = None,
) -> tuning.Tuning:
    """Tune on the entries of the last year and save params, score weights and history.

    `inputs` are already downloaded reference days; the other days whose entry has an active
    time or calories (tuning.reference_days) are downloaded here.
    """
    last = today(ZoneInfo(settings.timezone), now)
    since = last - timedelta(days=FIT_WINDOW_DAYS)
    manual, found, signature = loaded or _fit_entries(settings, now)
    params = load_params(settings.params_path)
    refs = {day: RefDay.of(item) for day, item in (inputs or {}).items()}
    max_hr = next(iter(inputs.values())).profile.max_hr if inputs else params.max_hr
    missing = [day for day in tuning.reference_days(manual, found, last) if day not in refs]
    if missing:
        downloaded, max_hr = _reference_days(settings, max_hr, missing, now)
        refs.update(downloaded)
    scored = [e.day for e in found if e.sleep_score is not None or e.energy_score is not None]
    with Store(settings.db_path) as store:
        stored = store.days(since + timedelta(days=1), last)
        history = (
            store.features(min(scored) - timedelta(days=tuning.HISTORY_DAYS - 1), max(scored))
            if scored
            else []
        )
    result = tuning.run(
        found,
        refs,
        stride_samples(w for day in stored for w in day.workouts),
        history,
        Person(age=settings.age_on(last), sex=settings.sex),
        settings.timezone,
        replace(params, max_hr=max_hr),
        samsung_scores.load_models(settings.score_weights_path),
        last,
    )
    with Store(settings.db_path) as store:
        if store.recompute_state() is None:
            # The stored days were computed with the values from before the first fit.
            store.set_recompute_state(tuning.estimate_params(params), None)
        store.save_fit(tuning.record(result, signature, now))
    save_params(settings.params_path, result.params)
    samsung_scores.save_models(settings.score_weights_path, result.models)
    return result


def _refresh(settings: Settings, now: datetime, fitted: bool, force: bool = False) -> None:
    """Recompute every stored day for new estimate parameters, else rescore after a fit."""
    params = load_params(settings.params_path)
    with Store(settings.db_path) as store:
        state = store.recompute_state()
        span = store.span()
        features = store.features_span()
    if span is not None and tuning.recompute_due(state, params, now, force):
        print(f"nové parametre odhadov, prepočítavam dni od {span[0]}")
        _sync_once(settings, _days_between(span[0], today(ZoneInfo(settings.timezone), now)), now)
        with Store(settings.db_path) as store:
            store.set_recompute_state(tuning.estimate_params(params), now)
    elif fitted and features is not None:
        _rescore(settings, features[0])


def _tune(settings: Settings, now: datetime) -> None:
    """Refit when a value the fit reads changed since the last fit or a day has passed, then
    refresh.

    Nothing happens while there is neither an entries store (owi entries import or the first
    entry from the web) nor any of Samsung's own numbers, so existing parameters are not
    reset by a fit without anything to fit on.
    """
    try:
        loaded = _fit_entries(settings, now)
    except sqlite3.OperationalError as exc:
        # The web held the entries longer than the retries; the next run tries again.
        print(f"doladenie odložené: {exc}", file=sys.stderr)
        return
    if not loaded[1] and not settings.entries_path.is_file():
        return
    with Store(settings.db_path) as store:
        last = store.latest_fit()
    fitted = tuning.fit_due(last, loaded[2], now)
    if fitted:
        try:
            result = _fit(settings, now, loaded=loaded)
        except sqlite3.OperationalError as exc:
            print(f"doladenie odložené: {exc}", file=sys.stderr)
            return
        print(_params_line(settings, result.params))
    _refresh(settings, now, fitted)


def _ensure_entries_dir(settings: Settings) -> None:
    """The api container mounts these folders for writing; Docker needs them to exist."""
    for folder in (settings.entries_path.parent, settings.accounts_path.parent):
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            print(f"pozor: priečinok {folder} sa nedá vytvoriť: {exc}", file=sys.stderr)


def _user_settings(settings: Settings, account: Account, paths: users.UserPaths) -> Settings:
    """The settings of one account's sync: its folders, its profile and not the owner's.

    The values in .env (age, sex, weights, maximum heart rate) are those of the user the old
    single-user setup was made for; only that user's account falls back to them.
    """
    owner = account.ow_user_id == settings.user_id
    base = (
        settings
        if owner
        else replace(
            settings,
            age=None,
            sex=None,
            max_hr=None,
            weight_kg=None,
            vo2max=None,
            basal_kcal=None,
        )
    )
    return replace(
        base,
        user_id=paths.ow_user_id,
        sex=account.sex or base.sex,
        birth_date=date.fromisoformat(account.birth_date) if account.birth_date else None,
        paths=paths,
    )


def _sync_user(
    settings: Settings,
    account: Account,
    paths: users.UserPaths,
    days: list[date],
    now: datetime,
) -> Seen:
    """Sync one account into its own folder; tune only when the account allows it."""
    user = _user_settings(settings, account, paths)
    for folder in (paths.folder, paths.entries_path.parent):
        folder.mkdir(parents=True, exist_ok=True)
    tz = ZoneInfo(settings.timezone)
    first_start, _ = day_window(min(days), tz)
    _, last_end = day_window(max(days), tz)
    seen = Seen(covers_week=first_start <= now - timedelta(days=ARRIVING_DAYS) and last_end >= now)
    _sync_once(user, days, now, seen)
    if account.training_consent:
        _tune(user, now)
    return seen


def _ow_label(item: dict) -> str:
    name = " ".join(part for part in (item.get("first_name"), item.get("last_name")) if part)
    return " · ".join(part for part in (name, item.get("email")) if part) or item["id"]


def _refresh_ow_users(settings: Settings, accounts: Accounts) -> None:
    with OWClient(settings.api_url, settings.api_key) as client:
        found = client.users()
    accounts.ow_users_replace([OwUser(item["id"], _ow_label(item)) for item in found])


def _store_sources(
    settings: Settings, accounts: Accounts, ow_user_id: str, seen: Seen, now: datetime
) -> None:
    """Connections, the types of data with whether they arrive, and the newest sample.

    A type arrives for a provider when it had a sample in the last week. The samples of the
    sync window tell it for the types owi downloads when the window covers the week; the
    rest costs one request per type (its first page).
    """
    since = now - timedelta(days=ARRIVING_DAYS)
    with OWClient(settings.api_url, settings.api_key) as client:
        connections = client.connections(ow_user_id)
        pairs = summary_pairs(client.data_summary(ow_user_id))
        resolved = set(DAY_TYPES) if seen.covers_week else set()
        for type_ in sorted({t for _, t in pairs} - resolved):
            wanted = [(provider, t) for provider, t in pairs if t == type_]
            if all(pair in seen.arriving for pair in wanted):
                continue
            for item in client.sample_head(ow_user_id, type_, since, now):
                seen.note(item, since)
    providers = {p for p, _ in pairs} | {(c.get("provider") or "").lower() for c in connections}
    payload = {
        "connections": [
            {key: item.get(key) for key in ("provider", "status", "last_synced_at")}
            for item in connections
        ],
        "types": [
            {"type": type_, "provider": provider, "arriving": (provider, type_) in seen.arriving}
            for provider, type_ in sorted(pairs, key=lambda pair: (pair[1], pair[0]))
        ],
        "samsung_health": seen.samsung or SAMSUNG_PROVIDER in providers,
    }
    accounts.sources_replace(ow_user_id, json.dumps(payload), now)
    known = accounts.last_data(ow_user_id)
    if seen.latest is not None and (known is None or seen.latest > known):
        accounts.last_data_set(ow_user_id, seen.latest)


def _delete_queued_folders(settings: Settings, accounts: Accounts) -> None:
    """Remove the folders of users taken out of the app, unless an account uses them again."""
    kept = {account.ow_user_id for account in accounts.all()}
    root = (settings.data_dir / users.USERS_DIR).resolve()
    for ow_user_id in accounts.deletions_pending():
        if ow_user_id in kept:
            continue
        folder = users.user_paths(settings.data_dir, ow_user_id).folder
        if folder.resolve().parent == root:
            shutil.rmtree(folder, ignore_errors=True)
        accounts.deletions_done(ow_user_id)


def _sync_accounts(settings: Settings, days: list[date], now: datetime) -> bool:
    """Sync every paired active account; one account failing does not stop the others."""
    ok = True
    with Accounts(settings.accounts_path) as accounts:
        try:
            _refresh_ow_users(settings, accounts)
        except OWError as exc:
            print(f"chyba: zoznam používateľov: {exc}", file=sys.stderr)
            ok = False
        for account in accounts.paired():
            ow_user_id = account.ow_user_id or ""
            try:
                seen = _sync_user(
                    settings, account, users.user_paths(settings.data_dir, ow_user_id), days, now
                )
                _store_sources(settings, accounts, ow_user_id, seen, now)
            except OWError as exc:
                print(f"chyba: účet {account.id}: {exc}", file=sys.stderr)
                ok = False
        _delete_queued_folders(settings, accounts)
    return ok


def _cmd_sync(args: argparse.Namespace, settings: Settings) -> int:
    tz = ZoneInfo(settings.timezone)
    _ensure_entries_dir(settings)
    while True:
        now = _now()
        last = args.to or today(tz, now)
        first = args.from_ or last - timedelta(days=args.days - 1)
        try:
            if settings.accounts_path.is_file():
                if not _sync_accounts(settings, _days_between(first, last), now) and not args.loop:
                    return 1
            else:
                # Until the data is migrated there are no accounts: the one user of .env.
                _sync_once(settings, _days_between(first, last), now)
                _tune(settings, now)
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


def _entry_inputs(
    settings: Settings, fitted_max_hr: float | None, now: datetime
) -> tuple[list[Entry], dict[date, DayInputs]] | None:
    """Entries of the last year and their freshly fetched inputs, or None after saying why."""
    last = today(ZoneInfo(settings.timezone), now)
    first = last - timedelta(days=FIT_WINDOW_DAYS - 1)
    found = entries.load(settings.entries_path, first, last)
    if not found:
        print(
            f"v {settings.entries_path} nie sú žiadne zápisy; doplň ich na webe"
            " alebo spusti owi entries import",
            file=sys.stderr,
        )
        return None
    with Store(settings.db_path) as store, OWClient(settings.api_url, settings.api_key) as client:
        inputs = _fetch(settings, fitted_max_hr, client, store, [e.day for e in found], now)
    return found, inputs


def _print_comparison(
    settings: Settings, found: list[Entry], inputs: dict[date, DayInputs], params: Params
) -> None:
    results = {day: compute(item, params, settings.timezone) for day, item in inputs.items()}
    print(f"{'deň':<12}{'údaj':<16}{'odhad':>10}{'Samsung':>10}{'odchýlka':>10}")
    for row in compare(found, results):
        estimate = "-" if row.estimate is None else f"{row.estimate:.0f}"
        error = "-" if row.error_pct is None else f"{row.error_pct:+.1f} %"
        print(f"{row.day!s:<12}{row.metric:<16}{estimate:>10}{row.truth:>10.0f}{error:>10}")


def _params_line(settings: Settings, params: Params) -> str:
    def show(value: float | None, digits: int) -> str:
        return "-" if value is None else f"{value:.{digits}f}"

    return (
        f"stride_m={params.stride_m:.3f} active_hr_delta={params.active_hr_delta:.1f}"
        f" kcal_scale={params.kcal_scale:.3f} basal_kcal={show(params.basal_kcal, 0)}"
        f" max_hr={show(params.max_hr, 0)} -> {settings.params_path}"
    )


def _cmd_calibrate(args: argparse.Namespace, settings: Settings) -> int:
    """Tune now, whatever changed, and recompute the stored days right away if needed."""
    now = _now()
    # A fresh fit also re-derives the maximum heart rate instead of reusing the old one.
    loaded = _entry_inputs(settings, None, now)
    if loaded is None:
        return 1
    found, inputs = loaded
    result = _fit(settings, now, inputs)
    print(_params_line(settings, result.params))
    _print_comparison(settings, found, inputs, result.params)
    _refresh(settings, now, fitted=True, force=True)
    return 0


def _cmd_check(args: argparse.Namespace, settings: Settings) -> int:
    params = load_params(settings.params_path)
    loaded = _entry_inputs(settings, params.max_hr, _now())
    if loaded is None:
        return 1
    found, inputs = loaded
    _print_comparison(settings, found, inputs, params)
    return 0


def _cmd_entries_import(args: argparse.Namespace, settings: Settings) -> int:
    """Copy the old truth.csv into the entries store; days already entered stay as they are."""
    path: Path = args.path or settings.truth_path
    if not path.is_file():
        print(f"chýba {path}", file=sys.stderr)
        return 1
    known = {entry.day for entry in entries.load(settings.entries_path)}
    now = _now()
    imported = skipped = 0
    for truth in load_truth(path):
        values, problems = entries.validate(
            {
                "steps": truth.steps,
                "distance_km": truth.distance_km,
                "active_minutes": truth.active_minutes,
                "active_kcal": truth.activity_kcal,
                "total_kcal": truth.total_kcal,
            }
        )
        if truth.day in known:
            print(f"{truth.day}: už je zapísaný, ostáva")
        elif problems:
            reasons = ", ".join(f"{name} {message}" for name, message in problems.items())
            print(f"{truth.day}: preskočený ({reasons})")
        elif all(value is None for value in values.values()):
            print(f"{truth.day}: prázdny, preskočený")
        else:
            entries.save(settings.entries_path, truth.day, values, now)
            known.add(truth.day)
            imported += 1
            continue
        skipped += 1
    print(f"importované dni: {imported}, preskočené: {skipped} -> {settings.entries_path}")
    return 0


def _cmd_users_migrate(args: argparse.Namespace, settings: Settings) -> int:
    """Move the single-user files into the user's folders, after a backup of data/."""
    if not settings.data_dir.is_dir():
        print(f"chýba {settings.data_dir}", file=sys.stderr)
        return 1
    try:
        backup = users.backup_data(settings.data_dir, _now(), args.backup_dir)
    except OSError as exc:
        print(f"chyba: záloha zlyhala: {exc}", file=sys.stderr)
        return 1
    print(f"záloha: {backup}")
    try:
        moved = users.migrate_legacy(settings.data_dir, args.ow_user)
    except FileExistsError as exc:
        print(f"chyba: {exc}", file=sys.stderr)
        return 1
    for name in moved:
        print(f"presunuté: {name}")
    if not moved:
        print("nič na presun")
    return 0


def _cmd_serve(args: argparse.Namespace, settings: Settings) -> int:
    if len(settings.serve_token) < MIN_TOKEN_LENGTH:
        print(
            f"chyba: nastav OWI_SERVE_TOKEN (aspoň {MIN_TOKEN_LENGTH} znakov)",
            file=sys.stderr,
        )
        return 1
    write_token = settings.write_token
    if write_token and (len(write_token) < MIN_TOKEN_LENGTH or write_token == settings.serve_token):
        print(
            f"chyba: OWI_WRITE_TOKEN musí mať aspoň {MIN_TOKEN_LENGTH} znakov"
            " a líšiť sa od OWI_SERVE_TOKEN",
            file=sys.stderr,
        )
        return 1
    if write_token:
        _ensure_entries_dir(settings)
    server = make_server(
        args.host,
        args.port,
        db_path=settings.db_path,
        token=settings.serve_token,
        timezone=settings.timezone,
        write_token=write_token,
        entries_path=settings.entries_path,
        params_path=settings.params_path,
    )
    host, port = server.server_address[:2]
    writes = "zápis zapnutý" if write_token else "len na čítanie"
    print(f"owi serve počúva na http://{host}:{port}, {writes}", flush=True)
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

    sync = commands.add_parser("sync", help="prepočíta dni, uloží ich a doladí odhady")
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

    calibrate = commands.add_parser(
        "calibrate", help="doladí odhady podľa zápisov hneď a prepočíta dni"
    )
    calibrate.set_defaults(run=_cmd_calibrate)
    check = commands.add_parser("check", help="porovná odhady so zápismi")
    check.set_defaults(run=_cmd_check)

    entry_commands = commands.add_parser("entries", help="zápisy zo Samsung Health")
    entry_actions = entry_commands.add_subparsers(dest="action", required=True)
    import_ = entry_actions.add_parser("import", help="jednorazovo prenesie data/truth.csv")
    import_.add_argument("--path", type=Path, help="CSV súbor (predvolene data/truth.csv)")
    import_.set_defaults(run=_cmd_entries_import)

    user_commands = commands.add_parser("users", help="priečinky používateľov")
    user_actions = user_commands.add_subparsers(dest="action", required=True)
    migrate = user_actions.add_parser(
        "migrate", help="jednorazovo presunie doterajšie dáta do priečinkov používateľa"
    )
    migrate.add_argument("--ow-user", required=True, help="ID používateľa v Open Wearables")
    migrate.add_argument(
        "--backup-dir", type=Path, help="kam uložiť zálohu data/ (predvolene vedľa repa)"
    )
    migrate.set_defaults(run=_cmd_users_migrate)

    serve = commands.add_parser(
        "serve", help="sprístupní uložené dni cez HTTP a prijíma zápisy zo Samsung Health"
    )
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
