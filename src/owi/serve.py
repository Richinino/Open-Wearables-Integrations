"""HTTP API over the stored results: owi serve.

Reading the days takes OWI_SERVE_TOKEN. The one write, a day's entry from Samsung Health,
takes its own OWI_WRITE_TOKEN; neither token does the other's job. The results database is
only read; entries go to their own store (entries.py).
"""

from __future__ import annotations

import gzip
import hmac
import json
import re
import sqlite3
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from owi import entries, tuning
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
MAX_BODY_BYTES = 4096  # an entry is seven numbers
_ENTRY_PATH = re.compile(r"/v1/entries/([^/]+)")
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


@dataclass(frozen=True)
class Response:
    status: int
    body: dict[str, Any]


def _error(status: int, message: str) -> Response:
    return Response(status, {"error": message})


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
        return Response(400, {"error": "invalid", "fields": problems})
    try:
        if all(value is None for value in values.values()):
            entries.delete(entries_path, day)
            return Response(200, entries.as_json(Entry(day)))
        return Response(200, entries.as_json(entries.save(entries_path, day, values, now)))
    except (sqlite3.OperationalError, OSError):
        return _error(503, "entries are unavailable")


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
    now: datetime | None = None,
) -> Response:
    """Answer one request. Pure apart from reading the databases and writing entries.

    The entries store and params.json default to their places beside the database.
    """
    url = urlsplit(target)
    entries_path = entries_path or entries.path_in(db_path.parent)
    params_path = params_path or db_path.parent / "params.json"
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
        return _put_entry(
            entry.group(1),
            body,
            db_path=db_path,
            entries_path=entries_path,
            timezone=timezone,
            now=now or datetime.now(UTC),
        )
    if method != "GET":
        return _error(405, "method not allowed")
    if url.path == "/health":
        return Response(200, {"status": "ok"})
    if url.path != "/v1/days":
        return _error(404, "not found")
    if not _authorized(authorization, token):
        return _error(401, "unauthorized")
    return _days(parse_qs(url.query), db_path, timezone, entries_path, params_path)


class _Handler(BaseHTTPRequestHandler):
    server_version = "owi"
    sys_version = ""
    timeout = REQUEST_TIMEOUT_S

    def _body(self) -> bytes:
        """The request body, cut one byte past the limit so an oversized one is noticed."""
        if self.command != "PUT":
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
            **self.server.context,
        )
        payload = json.dumps(response.body).encode()
        gzipped = _accepts_gzip(self.headers.get("Accept-Encoding"))
        if gzipped:
            payload = gzip.compress(payload, compresslevel=GZIP_LEVEL)
        self.send_response(response.status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Cache-Control", "no-store")
        if response.status == 401:
            self.send_header("WWW-Authenticate", "Bearer")
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
) -> ThreadingHTTPServer:
    """Without `write_token` the API stays read-only and entries answer 503."""
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
    }
    return server
