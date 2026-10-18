"""Read-only client for the Open Wearables REST API."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from datetime import UTC, date, datetime
from typing import Any

import httpx

from owi.models import HealthScore, Sample, SleepInterval, SleepSession, SourceRef, Workout

PAGE_LIMIT = 100
# Open Wearables 0.9.0 renamed the series; older servers still send the old name.
_TYPE_ALIASES = {"energy": "active_energy"}
# Open Wearables stage names (SleepStageType), plus out_of_bed in case a provider sends it.
# "sleeping", "unknown" and anything unrecognised are sleep without a known stage.
_SLEEP_STAGES = {
    "deep": "deep",
    "rem": "rem",
    "light": "light",
    "awake": "awake",
    "in_bed": "awake",
    "out_of_bed": "awake",
}
_ASLEEP = "asleep"


class OWError(RuntimeError):
    """The Open Wearables API could not be reached or answered with an error."""


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _format_time(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _source(raw: dict[str, Any] | None) -> SourceRef:
    raw = raw or {}
    return SourceRef(
        provider=(raw.get("provider") or "unknown").lower(),
        source=raw.get("source"),
        device=raw.get("device"),
    )


def _intervals(raw: list[dict[str, Any]] | None) -> tuple[SleepInterval, ...]:
    intervals = [
        SleepInterval(
            start=_parse_time(item["start_time"]),
            end=_parse_time(item["end_time"]),
            stage=_SLEEP_STAGES.get((item.get("stage") or "").lower(), _ASLEEP),
        )
        for item in raw or []
    ]
    return tuple(sorted(intervals, key=lambda interval: interval.start))


class OWClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._http = httpx.Client(
            base_url=base_url.rstrip("/") + "/api/v1",
            headers={"X-Open-Wearables-API-Key": api_key},
            transport=transport,
            timeout=timeout,
        )

    def __enter__(self) -> OWClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def _get(self, path: str, params: list[tuple[str, str]]) -> dict[str, Any]:
        try:
            response = self._http.get(path, params=params)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise OWError(f"Open Wearables API request failed for {path}: {exc}") from exc
        return response.json()

    def _pages(self, path: str, params: list[tuple[str, str]]) -> Iterator[dict[str, Any]]:
        cursor: str | None = None
        while True:
            query = [*params, ("limit", str(PAGE_LIMIT))]
            if cursor:
                query.append(("cursor", cursor))
            body = self._get(path, query)
            yield from body.get("data") or []
            pagination = body.get("pagination") or {}
            cursor = pagination.get("next_cursor")
            if not pagination.get("has_more") or not cursor:
                return

    def _offset_pages(self, path: str, params: list[tuple[str, str]]) -> Iterator[dict[str, Any]]:
        """Pages counted by offset, as the health scores come."""
        offset = 0
        while True:
            query = [*params, ("limit", str(PAGE_LIMIT)), ("offset", str(offset))]
            body = self._get(path, query)
            items = body.get("data") or []
            yield from items
            offset += len(items)
            if not (body.get("pagination") or {}).get("has_more") or not items:
                return

    def user_id(self) -> str:
        items = self._get("/users", [("limit", "2")]).get("items") or []
        if len(items) != 1:
            raise OWError(f"Expected exactly one user, found {len(items)}; set OWI_USER_ID")
        return items[0]["id"]

    def timeseries(
        self, user_id: str, types: Sequence[str], start: datetime, end: datetime
    ) -> list[Sample]:
        params = [
            ("start_time", _format_time(start)),
            ("end_time", _format_time(end)),
            *[("types", type_) for type_ in types],
        ]
        return [
            Sample(
                timestamp=_parse_time(item["timestamp"]),
                type=_TYPE_ALIASES.get(item["type"], item["type"]),
                value=float(item["value"]),
                source=_source(item.get("source")),
            )
            for item in self._pages(f"/users/{user_id}/timeseries", params)
        ]

    def workouts(self, user_id: str, start: datetime, end: datetime) -> list[Workout]:
        params = [("start_date", _format_time(start)), ("end_date", _format_time(end))]
        return [
            Workout(
                id=item["id"],
                type=item.get("type") or "unknown",
                start=_parse_time(item["start_time"]),
                end=_parse_time(item["end_time"]),
                source=_source(item.get("source")),
                distance_m=item.get("distance_meters"),
            )
            for item in self._pages(f"/users/{user_id}/events/workouts", params)
        ]

    def sleeps(self, user_id: str, start: datetime, end: datetime) -> list[SleepSession]:
        params = [("start_date", _format_time(start)), ("end_date", _format_time(end))]
        sessions = []
        for item in self._pages(f"/users/{user_id}/events/sleep", params):
            stages = item.get("stages") or {}
            seconds = item.get("sleep_duration_seconds")
            sessions.append(
                SleepSession(
                    id=item["id"],
                    start=_parse_time(item["start_time"]),
                    end=_parse_time(item["end_time"]),
                    source=_source(item.get("source")),
                    sleep_minutes=None if seconds is None else seconds / 60,
                    deep_minutes=stages.get("deep_minutes"),
                    rem_minutes=stages.get("rem_minutes"),
                    light_minutes=stages.get("light_minutes"),
                    awake_minutes=stages.get("awake_minutes"),
                    is_nap=bool(item.get("is_nap", False)),
                    intervals=_intervals(item.get("sleep_stage_intervals")),
                )
            )
        return sessions

    def health_scores(
        self, user_id: str, category: str, provider: str, first: date, last: date
    ) -> list[HealthScore]:
        """Scores the provider computed itself, recorded from `first` to `last`; those
        without a value are skipped."""
        params = [
            ("start_date", first.isoformat()),
            ("end_date", last.isoformat()),
            ("category", category),
            ("provider", provider),
        ]
        return [
            HealthScore(
                id=item["id"],
                category=item.get("category") or category,
                value=float(item["value"]),
                recorded_at=_parse_time(item["recorded_at"]),
                provider=(item.get("provider") or provider).lower(),
                event_record_id=item.get("event_record_id"),
            )
            for item in self._offset_pages(f"/users/{user_id}/health-scores", params)
            if item.get("value") is not None
        ]
