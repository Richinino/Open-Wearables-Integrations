"""Notes for the admins, raised from what the sync sees.

Every note has a key, so the same condition is not added twice. A condition that ends
(account paired, new data, source active again, newer version installed) resolves its note,
so it can fire again later. Notes for events (Funnel, a release) are never added a second
time, not even after an admin has resolved them.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from owi.accounts import Account, Accounts

STALE_AFTER = timedelta(hours=24)
RELEASE_EVERY = timedelta(hours=24)
FUNNEL_WINDOW = timedelta(hours=24)
RELEASE_URL = "https://api.github.com/repos/the-momentum/open-wearables/releases/latest"
HTTP_TIMEOUT_S = 5.0
FUNNEL_LOG = "funnel-watchdog.log"
RECONNECT_MARK = "Tailscale reconnected"

# Families whose notes end together with their condition.
_MANAGED = ("pairing:", "stale:", "disconnected:", "ow_update:")
_WATCHDOG_LINE = re.compile(r"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):(\d{2})\s+(.*)")


class Http(Protocol):
    """What is needed of httpx.Client: get(url, timeout=...) -> response."""

    def get(self, url: str, *, timeout: float) -> Any: ...


def _get_json(http: Http, url: str) -> Any:
    response = http.get(url, timeout=HTTP_TIMEOUT_S)
    response.raise_for_status()
    return response.json()


def _version_parts(text: str | None) -> tuple[int, ...] | None:
    if not text:
        return None
    parts = []
    for part in text.strip().removeprefix("v").removeprefix("V").split("."):
        digits = re.match(r"\d+", part)
        if digits is None:
            return None
        parts.append(int(digits[0]))
    return tuple(parts)


def is_newer(latest: str | None, running: str | None) -> bool:
    """Numeric comparison by dotted parts; only strictly newer counts."""
    new, old = _version_parts(latest), _version_parts(running)
    if new is None or old is None:
        return False
    size = max(len(new), len(old))
    pad = (0,) * size
    return new + pad[len(new) :] > old + pad[len(old) :]


def running_ow_version(http: Http, api_url: str) -> str | None:
    """The version Open Wearables reports in its public OpenAPI document; None on any failure."""
    try:
        version = _get_json(http, api_url.rstrip("/") + "/openapi.json")["info"]["version"]
    except Exception:
        return None
    return version if isinstance(version, str) and version else None


def latest_ow_release(
    http: Http, accounts: Accounts | None = None, now: datetime | None = None
) -> str | None:
    """The newest Open Wearables release on GitHub (tag without a leading "v").

    With `accounts` and `now` the answer is kept in `system` and GitHub is asked at most once
    in 24 hours, whether or not the last attempt worked. Any failure is silent.
    """
    cache = accounts is not None and now is not None
    if cache:
        try:
            checked = datetime.fromisoformat(accounts.system_get("ow_latest_checked_at") or "")
            if now - checked < RELEASE_EVERY:
                return accounts.system_get("ow_latest")
        except ValueError:
            pass
    found: str | None = None
    try:
        tag = _get_json(http, RELEASE_URL)["tag_name"]
        if isinstance(tag, str) and _version_parts(tag) is not None:
            found = tag.strip().removeprefix("v").removeprefix("V")
    except Exception:
        found = None
    if cache:
        try:
            accounts.system_set("ow_latest_checked_at", now.isoformat())
            if found is not None:
                accounts.system_set("ow_latest", found)
            else:
                found = accounts.system_get("ow_latest")
        except Exception:
            pass
    return found


def _funnel_items(data_dir: Path, now: datetime) -> dict[str, str]:
    """key -> message for every reconnect line of the watchdog log from the last 24 hours.

    The watchdog writes a line only when it acts or skips, so a reconnect can be followed by
    other lines before the sync looks. The times are those of the computer the watchdog runs
    on, compared here without a zone.
    """
    try:
        text = (data_dir / FUNNEL_LOG).read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return {}
    since = now.replace(tzinfo=None) - FUNNEL_WINDOW
    found: dict[str, str] = {}
    for line in text.splitlines():
        match = _WATCHDOG_LINE.fullmatch(line.strip())
        if match is None or RECONNECT_MARK not in match[4]:
            continue
        try:
            at = datetime.fromisoformat(f"{match[1]}T{match[2]}:{match[3]}")
        except ValueError:
            continue
        if at >= since:
            found[f"funnel:{match[1]} {match[2]}:{match[3]}"] = (
                f"Funnel neodpovedal, Tailscale sa znova pripojil ({match[2]})"
            )
    return found


def _wanted(
    accounts: Accounts,
    data_dir: Path,
    ow_version: str | None,
    ow_latest: str | None,
    now: datetime,
) -> dict[str, tuple[str, str | None, str]]:
    """key -> (kind, account id, message) for every condition that holds now."""
    wanted: dict[str, tuple[str, str | None, str]] = {}
    for account in accounts.all():
        name = account.first_name
        if account.status == "pending" and not account.paired:
            wanted[f"pairing:{account.id}"] = (
                "pairing",
                account.id,
                f"{name} čaká na spárovanie",
            )
        if account.status != "active" or account.ow_user_id is None:
            continue
        _account_conditions(accounts, account, now, wanted)
    for key, message in _funnel_items(data_dir, now).items():
        wanted[key] = ("funnel", None, message)
    if ow_version and ow_latest and is_newer(ow_latest, ow_version):
        wanted[f"ow_update:{ow_latest}"] = (
            "ow_update",
            None,
            f"Je nová verzia Open Wearables {ow_latest} (beží {ow_version})",
        )
    return wanted


def _account_conditions(
    accounts: Accounts,
    account: Account,
    now: datetime,
    wanted: dict[str, tuple[str, str | None, str]],
) -> None:
    ow_user_id = account.ow_user_id or ""
    last = accounts.last_data(ow_user_id)
    if last is not None and now - last > STALE_AFTER:
        wanted[f"stale:{ow_user_id}"] = (
            "stale_data",
            account.id,
            f"{account.first_name} nemá nové dáta viac ako 24 h",
        )
    sources = accounts.sources(ow_user_id) or {}
    for connection in sources.get("connections") or []:
        provider = str(connection.get("provider") or "").lower()
        status = str(connection.get("status") or "").lower()
        if provider and status != "active":
            wanted[f"disconnected:{ow_user_id}:{provider}"] = (
                "disconnected",
                account.id,
                f"{account.first_name}: odpojil sa zdroj {provider}",
            )


def refresh_inbox(
    accounts: Accounts,
    data_dir: Path,
    ow_version: str | None,
    ow_latest: str | None,
    now: datetime,
) -> None:
    """Add a note for every new condition and resolve the notes whose condition has ended."""
    wanted = _wanted(accounts, data_dir, ow_version, ow_latest, now)
    open_keys: set[str] = set()
    for item in accounts.inbox_list(False):
        if item.key is None:
            continue
        open_keys.add(item.key)
        if item.key.startswith(_MANAGED) and item.key not in wanted:
            accounts.inbox_resolve(item.id, now, automatic=True)
    # What an admin has seen to stays quiet while its condition lasts; once the condition has
    # been seen to end, the note is forgotten and may fire again.
    by_hand: set[str] = set()
    seen: set[str] = set()
    for item in accounts.inbox_list(True):
        if item.key is None:
            continue
        seen.add(item.key)
        if item.resolved_by == "auto" or not item.key.startswith(_MANAGED):
            continue
        if item.key in wanted:
            by_hand.add(item.key)
        else:
            accounts.inbox_condition_ended(item.id)
    for key, (kind, account_id, message) in wanted.items():
        # Events are added once for good; states may come back after they ended.
        if key in open_keys or (key in seen if kind in ("funnel", "ow_update") else key in by_hand):
            continue
        accounts.inbox_add(kind, account_id, message, key, now)
