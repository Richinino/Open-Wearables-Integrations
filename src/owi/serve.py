"""HTTP API over the stored results and the accounts of the web: owi serve.

Reading the days takes OWI_SERVE_TOKEN. Everything that writes (a day's entry from Samsung
Health, the accounts and the admin panel) takes its own OWI_WRITE_TOKEN; neither token does
the other's job. Only the web's server holds the write token: it vouches for the logged-in
account whose id is in the path, and for the admin it names in X-Owi-Acting, whom owi still
checks to be an active admin. The results databases are only read; entries go to their own
store (entries.py), accounts to theirs (accounts.py).

With accounts, the days and entries are those of the account named by `?account=`; without
an accounts store the single-user layout of before answers as it always did.
"""

from __future__ import annotations

import gzip
import hmac
import json
import re
import shutil
import sqlite3
import sys
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from owi import entries, tuning, users
from owi.accounts import DEFAULT_SETTINGS, Account, AccountError, Accounts, InboxItem
from owi.accounts import accounts_path as default_accounts_path
from owi.calibration import load_params
from owi.days import today
from owi.entries import Entry
from owi.models import DayResult, Params
from owi.score_models import DayFeatures, DayScores
from owi.store import Store, jsonable

MAX_DAYS = 400
MIN_TOKEN_LENGTH = 32
REQUEST_TIMEOUT_S = 15
GZIP_LEVEL = 6  # the whole history is ~1.3 MB of JSON; level 6 brings it to about a tenth
MAX_BODY_BYTES = 4096  # an entry is seven numbers, an account form a few short texts
BODY_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})
FUNNEL_LOG = "funnel-watchdog.log"
MAX_EVENT_CHARS = 300
MAX_CLIENT_IP_CHARS = 64
_ENTRY_PATH = re.compile(r"/v1/entries/([^/]+)")
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
# Open Wearables user ids name folders in data/users and data/zapisy: no dots, no slashes.
_FOLDER_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")
_INBOX_ID = re.compile(r"[0-9]{1,18}")
_WATCHDOG_LINE = re.compile(r"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (.*)")
_ERROR_STATUS = {
    "invalid": 400,
    "invalid_token": 400,
    "invalid_credentials": 401,
    "forbidden": 403,
    "suspended": 403,
    "registration_closed": 403,
    "not_found": 404,
    "not_paired": 404,
    "email_taken": 409,
    "ow_user_taken": 409,
    "last_admin": 409,
    "too_many_attempts": 429,
}


@dataclass(frozen=True)
class Response:
    status: int
    body: Any  # a JSON object, or a list for the admin's lists


def _error(status: int, message: str) -> Response:
    return Response(status, {"error": message})


def _invalid(fields: dict[str, str]) -> Response:
    return Response(400, {"error": "invalid", "fields": fields})


def _authorized(authorization: str | None, token: str) -> bool:
    scheme, _, supplied = (authorization or "").partition(" ")
    if not token or scheme.lower() != "bearer":
        return False
    return hmac.compare_digest(supplied.strip().encode(), token.encode())


def _accepts_gzip(accept_encoding: str | None) -> bool:
    """True when the Accept-Encoding header lists gzip without q=0."""
    for item in (accept_encoding or "").split(","):
        name, _, params = item.strip().partition(";")
        if name.strip().lower() != "gzip":
            continue
        quality = params.strip().removeprefix("q=").strip() if params.strip() else "1"
        try:
            return float(quality) > 0
        except ValueError:
            return False
    return False


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, date) else value  # datetime is a date too


def _day(
    result: DayResult,
    features: DayFeatures | None,
    scores: DayScores | None,
    entry: Entry | None,
) -> dict[str, Any]:
    """The stored day, its scores, sleep timeline, Samsung entry and Samsung's own numbers,
    and each workout's strain."""
    strain = features.workout_strain if features else {}
    day = {name: _iso(value) for name, value in asdict(result).items() if name != "workouts"}
    day["resting_hr"] = day.pop("resting_hr_measured")
    day["workouts"] = [
        {
            **{name: _iso(value) for name, value in asdict(workout).items()},
            "strain": strain.get(workout.id),
        }
        for workout in result.workouts
    ]
    day["sleep_timeline"] = jsonable(features.sleep_intervals) if features else []
    day["scores"] = jsonable(scores)
    day["samsung"] = entries.as_json(entry) if entry else None
    day["samsung_auto"] = tuning.auto_json(features)
    return day


def _query_day(query: dict[str, list[str]], name: str) -> date | None:
    values = query.get(name)
    return date.fromisoformat(values[0]) if values else None


def _params(path: Path) -> Params:
    try:
        return load_params(path)
    except (OSError, ValueError, TypeError):
        # Unreadable or from an unknown version: the days matter more than this block.
        return Params()


def _entries(path: Path, first: date, last: date) -> dict[date, Entry]:
    try:
        return {entry.day: entry for entry in entries.load(path, first, last)}
    except sqlite3.OperationalError:
        # Held by a write for longer than the retries: the days still matter more.
        return {}


def _days(
    query: dict[str, list[str]], db_path: Path, timezone: str, entries_path: Path, params_path: Path
) -> Response:
    try:
        first, last = _query_day(query, "from"), _query_day(query, "to")
    except ValueError:
        return _error(400, "dates must be YYYY-MM-DD")
    try:
        with Store(db_path, readonly=True) as store:
            span = store.span()
            found: list[DayResult] = []
            features: dict[date, DayFeatures] = {}
            scores: dict[date, DayScores] = {}
            samsung: dict[date, Entry] = {}
            if span is not None:
                last = last or span[1]
                first = first or last - timedelta(days=MAX_DAYS - 1)
                if first > last:
                    return _error(400, "from is after to")
                if (last - first).days >= MAX_DAYS:
                    return _error(400, f"range is longer than {MAX_DAYS} days")
                found = store.days(first, last)
                features = {f.day: f for f in store.features(first, last)}
                scores = {s.day: s for s in store.scores(first, last)}
                samsung = _entries(entries_path, first, last)
            last_fit = store.latest_fit()
    except sqlite3.OperationalError:
        # No database yet, or the sync is writing to it right now.
        return _error(503, "no data yet")

    first_day, last_day, synced_at = span or (None, None, None)
    return Response(
        200,
        {
            "timezone": timezone,
            "first_day": _iso(first_day),
            "last_day": _iso(last_day),
            "synced_at": _iso(synced_at),
            "days": [
                _day(
                    result,
                    features.get(result.day),
                    scores.get(result.day),
                    samsung.get(result.day),
                )
                for result in found
            ],
            "calibration": tuning.summary(last_fit, _params(params_path)),
        },
    )


def _entry_day(text: str) -> date | None:
    if not _DAY.fullmatch(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _put_entry(
    day_text: str,
    body: bytes,
    *,
    db_path: Path,
    entries_path: Path,
    timezone: str,
    now: datetime,
) -> Response:
    """Save or, when every field is null, delete the entry of one day."""
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        payload = None
    values, problems = entries.validate(payload)
    day = _entry_day(day_text)
    if day is None:
        problems["day"] = "RRRR-MM-DD"
    else:
        try:
            with Store(db_path, readonly=True) as store:
                span = store.span()
        except sqlite3.OperationalError:
            return _error(503, "no data yet")
        if span is None or not span[0] <= day <= today(ZoneInfo(timezone), now):
            problems["day"] = "mimo rozsahu"
    if problems or day is None:
        return _invalid(problems)
    try:
        if all(value is None for value in values.values()):
            entries.delete(entries_path, day)
            return Response(200, entries.as_json(Entry(day)))
        return Response(200, entries.as_json(entries.save(entries_path, day, values, now)))
    except (sqlite3.OperationalError, OSError):
        return _error(503, "entries are unavailable")


# whose data: ?account=


@dataclass(frozen=True)
class _DataPaths:
    db_path: Path
    entries_path: Path
    params_path: Path


def _data_paths(
    query: dict[str, list[str]], accounts_path: Path, data_dir: Path, legacy: _DataPaths
) -> _DataPaths | Response:
    """The files of the account in `?account=`; the single-user ones while there are no
    accounts and none is asked for."""
    asked = query.get("account")
    if not asked:
        if accounts_path.is_file():
            return _invalid({"account": "povinné"})
        return legacy
    if not accounts_path.is_file():
        return _error(503, "no accounts yet")
    try:
        account = Accounts(accounts_path).get(asked[0])
    except sqlite3.Error:
        return _error(503, "accounts are unavailable")
    if account is None:
        return _error(404, "not_found")
    if account.status == "suspended":
        return _error(403, "suspended")
    ow_user_id = account.ow_user_id
    if account.status != "active" or ow_user_id is None or not _FOLDER_ID.fullmatch(ow_user_id):
        return _error(404, "not_paired")
    paths = users.user_paths(data_dir, ow_user_id)
    return _DataPaths(paths.db_path, paths.entries_path, paths.params_path)


# accounts: JSON


def _account_json(accounts: Accounts, account: Account) -> dict[str, Any]:
    """The Account of the API, field by field: the password hash never leaves this way."""
    return {
        "id": account.id,
        "email": account.email,
        "first_name": account.first_name,
        "last_name": account.last_name,
        "role": account.role,
        "status": account.status,
        "paired": account.paired,
        "birth_date": account.birth_date,
        "sex": account.sex,
        "training_consent": account.training_consent,
        "settings": {
            name: account.settings.get(name, default) for name, default in DEFAULT_SETTINGS.items()
        },
        "has_samsung": _has_samsung(accounts, account),
        "created_at": _iso(account.created_at),
        "last_login_at": _iso(account.last_login_at),
        "session_version": account.session_version,
    }


def _has_samsung(accounts: Accounts, account: Account) -> bool:
    """Whether the sync has seen any Samsung Health source of the paired user."""
    if account.ow_user_id is None:
        return False
    stored = accounts.sources(account.ow_user_id)
    return isinstance(stored, dict) and stored.get("samsung_health") is True


def _admin_json(accounts: Accounts, account: Account) -> dict[str, Any]:
    last = accounts.last_data(account.ow_user_id) if account.ow_user_id else None
    return {
        **_account_json(accounts, account),
        "ow_user_id": account.ow_user_id,
        "last_data_at": _iso(last),
    }


def _item_json(item: InboxItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "kind": item.kind,
        "account_id": item.account_id,
        "message": item.message,
        "created_at": _iso(item.created_at),
        "resolved_at": _iso(item.resolved_at),
    }


# accounts: requests


@dataclass(frozen=True)
class _Call:
    accounts: Accounts
    data_dir: Path
    query: dict[str, list[str]]
    payload: dict[str, Any]
    timezone: str
    client_ip: str
    now: datetime


def _object(body: bytes) -> dict[str, Any] | None:
    """The body as a JSON object; an empty body is an empty object, anything else None.

    JSON may carry lone surrogates, which are not text and cannot be hashed or stored as
    UTF-8; such a body counts as invalid too.
    """
    if not body.strip():
        return {}
    try:
        payload = json.loads(body)
        json.dumps(payload, ensure_ascii=False).encode()
    except (ValueError, UnicodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _texts(payload: dict[str, Any], *names: str) -> list[str]:
    """The named values, refused as invalid unless every one is a string."""
    missing = {name: "povinné" for name in names if not isinstance(payload.get(name), str)}
    if missing:
        raise AccountError("invalid", fields=missing)
    return [payload[name] for name in names]


def _as_new_password(error: AccountError) -> AccountError:
    """The store calls the new password `password`; the request calls it `new_password`."""
    if not error.fields or "password" not in error.fields:
        return error
    fields = {
        ("new_password" if name == "password" else name): text
        for name, text in error.fields.items()
    }
    return AccountError(error.code, fields, error.retry_after_s)


def _require(accounts: Accounts, account_id: str) -> Account:
    account = accounts.get(account_id)
    if account is None:
        raise AccountError("not_found")
    return account


def _remove_entries(data_dir: Path, ow_user_id: str) -> None:
    """Delete the user's entries folder now; the api container may write data/zapisy."""
    folder = users.user_paths(data_dir, ow_user_id).entries_path.parent
    if folder.resolve().parent != (data_dir / users.ENTRIES_DIR).resolve():
        return
    try:
        shutil.rmtree(folder)
    except FileNotFoundError:
        pass
    except OSError as exc:
        reason = type(exc).__name__
        print(f"pozor: zápisy zmazaného účtu sa nedajú zmazať: {reason}", file=sys.stderr)


def _delete_account(call: _Call, account_id: str) -> Response:
    """The account goes, its entries right away, its computed days through the owi container
    (queued with the account's removal; api cannot write data/users)."""
    removed = call.accounts.delete(account_id, call.now)
    if removed.ow_user_id is not None and _FOLDER_ID.fullmatch(removed.ow_user_id):
        _remove_entries(call.data_dir, removed.ow_user_id)
    return Response(204, {})


def _register(call: _Call) -> Response:
    payload = call.payload
    account = call.accounts.register(
        payload.get("email"),
        payload.get("first_name"),
        payload.get("last_name"),
        payload.get("password"),
        call.client_ip,
        call.now,
    )
    return Response(201, _account_json(call.accounts, account))


def _login(call: _Call) -> Response:
    email, password = _texts(call.payload, "email", "password")
    account = call.accounts.login(email, password, call.now)
    return Response(200, _account_json(call.accounts, account))


def _get_account(call: _Call, account_id: str) -> Response:
    return Response(200, _account_json(call.accounts, _require(call.accounts, account_id)))


def _patch_account(call: _Call, account_id: str) -> Response:
    # The store knows only the profile fields; role, status or pairing are refused there.
    account = call.accounts.update(account_id, call.payload)
    return Response(200, _account_json(call.accounts, account))


def _change_password(call: _Call, account_id: str) -> Response:
    current, new = _texts(call.payload, "current_password", "new_password")
    try:
        account = call.accounts.change_password(account_id, current, new)
    except AccountError as error:
        raise _as_new_password(error) from None
    return Response(200, _account_json(call.accounts, account))


def _logout_all(call: _Call, account_id: str) -> Response:
    return Response(200, _account_json(call.accounts, call.accounts.bump_session(account_id)))


def _delete_own_account(call: _Call, account_id: str) -> Response:
    (password,) = _texts(call.payload, "password")
    call.accounts.check_password(account_id, password, call.now)
    return _delete_account(call, account_id)


def _reset_request(call: _Call) -> Response:
    email = call.payload.get("email")
    call.accounts.request_reset(email if isinstance(email, str) else "", call.now)
    return Response(202, {})  # the same answer whether or not the email has an account


def _reset_confirm(call: _Call) -> Response:
    token, new = _texts(call.payload, "token", "new_password")
    try:
        account = call.accounts.confirm_reset(token, new, call.now)
    except AccountError as error:
        raise _as_new_password(error) from None
    return Response(200, _account_json(call.accounts, account))


def _admin_accounts(call: _Call) -> Response:
    return Response(200, [_admin_json(call.accounts, item) for item in call.accounts.all()])


def _admin_ow_users(call: _Call) -> Response:
    owners = {item.ow_user_id: item.id for item in call.accounts.all() if item.ow_user_id}
    return Response(
        200,
        [
            {"id": user.id, "label": user.label, "paired_account_id": owners.get(user.id)}
            for user in call.accounts.ow_users()
        ],
    )


def _admin_pair(call: _Call, account_id: str) -> Response:
    ow_user_id = call.payload.get("ow_user_id")
    known = {user.id for user in call.accounts.ow_users()}
    if not isinstance(ow_user_id, str) or not _FOLDER_ID.fullmatch(ow_user_id):
        raise AccountError("invalid", fields={"ow_user_id": "neplatné ID"})
    if ow_user_id not in known:
        raise AccountError("invalid", fields={"ow_user_id": "neznámy používateľ Open Wearables"})
    account = call.accounts.pair(account_id, ow_user_id)
    # Paired again before owi removed the folder of an earlier account: it is in use now.
    call.accounts.deletions_done(ow_user_id)
    return Response(200, _admin_json(call.accounts, account))


def _admin_unpair(call: _Call, account_id: str) -> Response:
    return Response(200, _admin_json(call.accounts, call.accounts.unpair(account_id)))


def _admin_patch(call: _Call, account_id: str) -> Response:
    unknown = {name: "neznáme pole" for name in call.payload if name not in ("role", "status")}
    if unknown:
        raise AccountError("invalid", fields=unknown)
    account = call.accounts.set_role_status(
        account_id, call.payload.get("role"), call.payload.get("status")
    )
    return Response(200, _admin_json(call.accounts, account))


def _admin_delete(call: _Call, account_id: str) -> Response:
    return _delete_account(call, account_id)


def _admin_reset_link(call: _Call, account_id: str) -> Response:
    # Shown once to the admin; the store keeps only its hash.
    token, expires_at = call.accounts.create_reset_token(account_id, call.now)
    return Response(200, {"token": token, "expires_at": _iso(expires_at)})


def _admin_sources(call: _Call, account_id: str) -> Response:
    account = _require(call.accounts, account_id)
    stored = call.accounts.sources(account.ow_user_id) if account.ow_user_id else None
    found = stored if isinstance(stored, dict) else {}
    return Response(
        200,
        {
            "connections": list(found.get("connections") or []),
            "types": list(found.get("types") or []),
            "updated_at": found.get("checked_at"),
        },
    )


def _admin_inbox(call: _Call) -> Response:
    resolved = (call.query.get("resolved") or ["0"])[0] in ("1", "true")
    return Response(200, [_item_json(item) for item in call.accounts.inbox_list(resolved)])


def _admin_resolve(call: _Call, item_id: str) -> Response:
    if not _INBOX_ID.fullmatch(item_id):
        raise AccountError("not_found")
    return Response(200, _item_json(call.accounts.inbox_resolve(int(item_id), call.now)))


def _funnel(data_dir: Path, timezone: str) -> dict[str, Any]:
    """The last line of the Funnel watchdog's log (scripts/funnel-watchdog.ps1)."""
    try:
        text = (data_dir / FUNNEL_LOG).read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        text = ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return {"last_event_at": None, "last_event": None}
    match = _WATCHDOG_LINE.fullmatch(lines[-1])
    if match is None:
        return {"last_event_at": None, "last_event": lines[-1][:MAX_EVENT_CHARS]}
    try:
        # The watchdog writes the local time of the computer it runs on.
        at = datetime.fromisoformat(f"{match[1]}T{match[2]}").replace(tzinfo=ZoneInfo(timezone))
    except ValueError:
        return {"last_event_at": None, "last_event": lines[-1][:MAX_EVENT_CHARS]}
    return {"last_event_at": at.isoformat(), "last_event": match[3][:MAX_EVENT_CHARS]}


def _admin_system(call: _Call) -> Response:
    value = call.accounts.system_get
    return Response(
        200,
        {
            # Written by owi sync after every run of the accounts (cli._sync_accounts).
            "ow_api": "ok" if value("last_sync_ok") == "1" else "down",
            "ow_version": value("ow_version"),
            "ow_latest": value("ow_latest"),
            "last_sync_at": value("last_sync_at"),
            "funnel": _funnel(call.data_dir, call.timezone),
            # Same reading as accounts._registration_refusal: open unless switched off.
            "registration_open": value("registration_open") not in ("0", "false"),
        },
    )


def _admin_set_system(call: _Call) -> Response:
    problems = {name: "neznáme pole" for name in call.payload if name != "registration_open"}
    if not isinstance(call.payload.get("registration_open"), bool):
        problems["registration_open"] = "true alebo false"
    if problems:
        raise AccountError("invalid", fields=problems)
    call.accounts.system_set("registration_open", "1" if call.payload["registration_open"] else "0")
    return _admin_system(call)


@dataclass(frozen=True)
class _Route:
    pattern: re.Pattern[str]
    methods: dict[str, Callable[..., Response]]
    admin: bool = False


# First match wins: register and login before the account ids.
_ROUTES = (
    _Route(re.compile(r"/v1/accounts/register"), {"POST": _register}),
    _Route(re.compile(r"/v1/accounts/login"), {"POST": _login}),
    _Route(
        re.compile(r"/v1/accounts/([^/]+)"),
        {"GET": _get_account, "PATCH": _patch_account, "DELETE": _delete_own_account},
    ),
    _Route(re.compile(r"/v1/accounts/([^/]+)/password"), {"POST": _change_password}),
    _Route(re.compile(r"/v1/accounts/([^/]+)/logout-all"), {"POST": _logout_all}),
    _Route(re.compile(r"/v1/password-reset/request"), {"POST": _reset_request}),
    _Route(re.compile(r"/v1/password-reset/confirm"), {"POST": _reset_confirm}),
    _Route(re.compile(r"/v1/admin/accounts"), {"GET": _admin_accounts}, admin=True),
    _Route(re.compile(r"/v1/admin/ow-users"), {"GET": _admin_ow_users}, admin=True),
    _Route(
        re.compile(r"/v1/admin/accounts/([^/]+)"),
        {"PATCH": _admin_patch, "DELETE": _admin_delete},
        admin=True,
    ),
    _Route(re.compile(r"/v1/admin/accounts/([^/]+)/pair"), {"POST": _admin_pair}, admin=True),
    _Route(re.compile(r"/v1/admin/accounts/([^/]+)/unpair"), {"POST": _admin_unpair}, admin=True),
    _Route(
        re.compile(r"/v1/admin/accounts/([^/]+)/reset-link"),
        {"POST": _admin_reset_link},
        admin=True,
    ),
    _Route(re.compile(r"/v1/admin/accounts/([^/]+)/sources"), {"GET": _admin_sources}, admin=True),
    _Route(re.compile(r"/v1/admin/inbox"), {"GET": _admin_inbox}, admin=True),
    _Route(re.compile(r"/v1/admin/inbox/([^/]+)/resolve"), {"POST": _admin_resolve}, admin=True),
    _Route(
        re.compile(r"/v1/admin/system"),
        {"GET": _admin_system, "PUT": _admin_set_system},
        admin=True,
    ),
)


def _refusal(error: AccountError) -> Response:
    body: dict[str, Any] = {"error": error.code}
    if error.fields:
        body["fields"] = dict(error.fields)
    if error.retry_after_s is not None:
        body["retry_after_s"] = error.retry_after_s
    return Response(_ERROR_STATUS.get(error.code, 400), body)


def _check_acting_admin(accounts: Accounts, acting: str | None) -> None:
    admin = accounts.get(acting) if acting else None
    if admin is None or admin.role != "admin" or admin.status != "active":
        raise AccountError("forbidden")


def _account_request(
    route: _Route,
    handler: Callable[..., Response],
    groups: tuple[str, ...],
    authorization: str | None,
    *,
    write_token: str,
    body: bytes,
    accounts_path: Path,
    acting: str | None,
    make_call: Callable[[Accounts, dict[str, Any]], _Call],
) -> Response:
    if not write_token:
        return _error(503, "writes are disabled")
    if not _authorized(authorization, write_token):
        return _error(401, "unauthorized")
    if len(body) > MAX_BODY_BYTES:
        return _error(413, "body too large")
    if not accounts_path.is_file():
        # Made by owi accounts create-admin; until then owi sync keeps the single-user layout,
        # so no request may create it.
        return _error(503, "no accounts yet")
    accounts = Accounts(accounts_path)
    try:
        if route.admin:
            _check_acting_admin(accounts, acting)
        payload = _object(body)
        if payload is None:
            return _invalid({"body": "objekt JSON"})
        return handler(make_call(accounts, payload), *groups)
    except AccountError as error:
        return _refusal(error)
    except (sqlite3.Error, OSError):
        return _error(503, "accounts are unavailable")


def respond(
    method: str,
    target: str,
    authorization: str | None,
    *,
    db_path: Path,
    token: str,
    timezone: str,
    write_token: str = "",
    body: bytes = b"",
    entries_path: Path | None = None,
    params_path: Path | None = None,
    accounts_path: Path | None = None,
    data_dir: Path | None = None,
    acting: str | None = None,
    client_ip: str | None = None,
    now: datetime | None = None,
) -> Response:
    """Answer one request. Pure apart from reading the databases and writing entries and
    accounts.

    The single-user files (database, entries, params.json) default to their places beside the
    database, the data folder to its folder and the accounts store to its place in there.
    `acting` is the X-Owi-Acting header, `client_ip` X-Owi-Client-Ip.
    """
    url = urlsplit(target)
    query = parse_qs(url.query)
    now = now or datetime.now(UTC)
    data_dir = data_dir or db_path.parent
    accounts_path = accounts_path or default_accounts_path(data_dir)
    legacy = _DataPaths(
        db_path,
        entries_path or entries.path_in(db_path.parent),
        params_path or db_path.parent / "params.json",
    )
    entry = _ENTRY_PATH.fullmatch(url.path)
    if entry:
        if method != "PUT":
            return _error(405, "method not allowed")
        if not write_token:
            return _error(503, "writes are disabled")
        if not _authorized(authorization, write_token):
            return _error(401, "unauthorized")
        if len(body) > MAX_BODY_BYTES:
            return _error(413, "body too large")
        paths = _data_paths(query, accounts_path, data_dir, legacy)
        if isinstance(paths, Response):
            return paths
        return _put_entry(
            entry.group(1),
            body,
            db_path=paths.db_path,
            entries_path=paths.entries_path,
            timezone=timezone,
            now=now,
        )
    ip = (client_ip or "").strip()[:MAX_CLIENT_IP_CHARS] or "unknown"

    def make_call(accounts: Accounts, payload: dict[str, Any]) -> _Call:
        return _Call(accounts, data_dir, query, payload, timezone, ip, now)

    for route in _ROUTES:
        match = route.pattern.fullmatch(url.path)
        if match is None:
            continue
        handler = route.methods.get(method)
        if handler is None:
            return _error(405, "method not allowed")
        return _account_request(
            route,
            handler,
            match.groups(),
            authorization,
            write_token=write_token,
            body=body,
            accounts_path=accounts_path,
            acting=acting,
            make_call=make_call,
        )
    if method != "GET":
        return _error(405, "method not allowed")
    if url.path == "/health":
        return Response(200, {"status": "ok"})
    if url.path != "/v1/days":
        return _error(404, "not found")
    if not _authorized(authorization, token):
        return _error(401, "unauthorized")
    paths = _data_paths(query, accounts_path, data_dir, legacy)
    if isinstance(paths, Response):
        return paths
    return _days(query, paths.db_path, timezone, paths.entries_path, paths.params_path)


class _Handler(BaseHTTPRequestHandler):
    server_version = "owi"
    sys_version = ""
    timeout = REQUEST_TIMEOUT_S

    def _body(self) -> bytes:
        """The request body, cut one byte past the limit so an oversized one is noticed."""
        if self.command not in BODY_METHODS:
            return b""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        return self.rfile.read(min(max(length, 0), MAX_BODY_BYTES + 1))

    def _answer(self) -> None:
        response = respond(
            self.command,
            self.path,
            self.headers.get("Authorization"),
            body=self._body(),
            acting=self.headers.get("X-Owi-Acting"),
            client_ip=self.headers.get("X-Owi-Client-Ip"),
            **self.server.context,
        )
        self.send_response(response.status)
        self.send_header("Cache-Control", "no-store")
        if response.status == 401:
            self.send_header("WWW-Authenticate", "Bearer")
        if response.status == 429 and isinstance(response.body, dict):
            retry = response.body.get("retry_after_s")
            if retry is not None:
                self.send_header("Retry-After", str(retry))
        if response.status == 204:
            self.end_headers()  # No Content: no body and no length
            return
        payload = json.dumps(response.body).encode()
        gzipped = _accepts_gzip(self.headers.get("Accept-Encoding"))
        if gzipped:
            payload = gzip.compress(payload, compresslevel=GZIP_LEVEL)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _answer


def make_server(
    host: str,
    port: int,
    *,
    db_path: Path,
    token: str,
    timezone: str,
    write_token: str = "",
    entries_path: Path | None = None,
    params_path: Path | None = None,
    accounts_path: Path | None = None,
    data_dir: Path | None = None,
) -> ThreadingHTTPServer:
    """Without `write_token` the API stays read-only: entries and accounts answer 503."""
    if len(token) < MIN_TOKEN_LENGTH:
        raise ValueError(f"token must have at least {MIN_TOKEN_LENGTH} characters")
    if write_token and len(write_token) < MIN_TOKEN_LENGTH:
        raise ValueError(f"write token must have at least {MIN_TOKEN_LENGTH} characters")
    if write_token and hmac.compare_digest(write_token.encode(), token.encode()):
        raise ValueError("write token must differ from the read token")
    server = ThreadingHTTPServer((host, port), _Handler)
    server.daemon_threads = True
    server.context = {
        "db_path": db_path,
        "token": token,
        "timezone": timezone,
        "write_token": write_token,
        "entries_path": entries_path,
        "params_path": params_path,
        "accounts_path": accounts_path,
        "data_dir": data_dir,
    }
    return server
