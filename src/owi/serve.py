"""Read-only HTTP API over the stored results: owi serve."""

from __future__ import annotations

import hmac
import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from owi.models import DayResult
from owi.score_models import DayFeatures, DayScores
from owi.store import Store, jsonable

MAX_DAYS = 400
MIN_TOKEN_LENGTH = 32
REQUEST_TIMEOUT_S = 15


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


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, date) else value  # datetime is a date too


def _day(
    result: DayResult, features: DayFeatures | None, scores: DayScores | None
) -> dict[str, Any]:
    """The stored day, plus its scores and sleep timeline and each workout's strain."""
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
    return day


def _query_day(query: dict[str, list[str]], name: str) -> date | None:
    values = query.get(name)
    return date.fromisoformat(values[0]) if values else None


def _days(query: dict[str, list[str]], db_path: Path, timezone: str) -> Response:
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
                _day(result, features.get(result.day), scores.get(result.day)) for result in found
            ],
        },
    )


def respond(
    method: str,
    target: str,
    authorization: str | None,
    *,
    db_path: Path,
    token: str,
    timezone: str,
) -> Response:
    """Answer one request. Pure apart from reading the database."""
    if method != "GET":
        return _error(405, "method not allowed")
    url = urlsplit(target)
    if url.path == "/health":
        return Response(200, {"status": "ok"})
    if url.path != "/v1/days":
        return _error(404, "not found")
    if not _authorized(authorization, token):
        return _error(401, "unauthorized")
    return _days(parse_qs(url.query), db_path, timezone)


class _Handler(BaseHTTPRequestHandler):
    server_version = "owi"
    sys_version = ""
    timeout = REQUEST_TIMEOUT_S

    def _answer(self) -> None:
        response = respond(
            self.command, self.path, self.headers.get("Authorization"), **self.server.context
        )
        payload = json.dumps(response.body).encode()
        self.send_response(response.status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        if response.status == 401:
            self.send_header("WWW-Authenticate", "Bearer")
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _answer


def make_server(
    host: str, port: int, *, db_path: Path, token: str, timezone: str
) -> ThreadingHTTPServer:
    if len(token) < MIN_TOKEN_LENGTH:
        raise ValueError(f"token must have at least {MIN_TOKEN_LENGTH} characters")
    server = ThreadingHTTPServer((host, port), _Handler)
    server.daemon_threads = True
    server.context = {"db_path": db_path, "token": token, "timezone": timezone}
    return server
