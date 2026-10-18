import json
from datetime import timedelta

import pytest

from owi import inbox
from owi.accounts import Accounts, accounts_path
from owi.inbox import latest_ow_release, refresh_inbox, running_ow_version
from tests.factories import utc

NOW = utc(2026, 10, 18, 12)


class FakeResponse:
    def __init__(self, body, fail=False):
        self._body = body
        self._fail = fail

    def raise_for_status(self):
        if self._fail:
            raise RuntimeError("status")

    def json(self):
        return self._body


class FakeHttp:
    def __init__(self, answers=None, error=None):
        self.answers = answers or {}
        self.error = error
        self.urls = []

    def get(self, url, *, timeout):
        self.urls.append(url)
        if self.error:
            raise self.error
        return FakeResponse(self.answers[url])


@pytest.fixture
def accounts(tmp_path):
    with Accounts(accounts_path(tmp_path)) as store:
        yield store


def person(accounts, email, name="Peter", status="active", ow_user_id=None):
    account = accounts.create(email, name, None, "correct horse battery", "user", "pending", NOW)
    if ow_user_id:
        account = accounts.pair(account.id, ow_user_id)
    if status != "active" and status != "pending":
        accounts.set_role_status(account.id, None, status)
    return account


def open_items(accounts):
    return accounts.inbox_list(False)


def refresh(accounts, tmp_path, now=NOW, version=None, latest=None):
    refresh_inbox(accounts, tmp_path, version, latest, now)


def test_pending_account_adds_one_pairing_item(accounts, tmp_path):
    account = person(accounts, "p@example.test")

    refresh(accounts, tmp_path)
    refresh(accounts, tmp_path)

    items = open_items(accounts)
    assert [(i.kind, i.account_id, i.message) for i in items] == [
        ("pairing", account.id, "Peter čaká na spárovanie")
    ]
    assert "@" not in items[0].message

    accounts.pair(account.id, "ow-1")
    refresh(accounts, tmp_path)
    assert open_items(accounts) == []


def test_no_data_for_24_hours_adds_stale_item_and_new_data_does_not_repeat_it(accounts, tmp_path):
    account = person(accounts, "a@example.test", "Andrea", ow_user_id="ow-1")
    accounts.last_data_set("ow-1", NOW - timedelta(hours=23))
    refresh(accounts, tmp_path)
    assert open_items(accounts) == []

    accounts.last_data_set("ow-1", NOW - timedelta(hours=25))
    refresh(accounts, tmp_path)
    refresh(accounts, tmp_path)
    items = open_items(accounts)
    assert [(i.kind, i.account_id, i.message) for i in items] == [
        ("stale_data", account.id, "Andrea nemá nové dáta viac ako 24 h")
    ]

    accounts.last_data_set("ow-1", NOW - timedelta(hours=1))
    refresh(accounts, tmp_path)
    assert open_items(accounts) == []
    refresh(accounts, tmp_path)
    assert open_items(accounts) == []

    later = NOW + timedelta(hours=30)
    refresh(accounts, tmp_path, now=later)
    assert [i.kind for i in open_items(accounts)] == ["stale_data"]


def test_inactive_connection_adds_disconnected_item(accounts, tmp_path):
    account = person(accounts, "o@example.test", "Otec", ow_user_id="ow-1")
    connections = [
        {"provider": "suunto", "status": "revoked", "last_synced_at": None},
        {"provider": "garmin", "status": "active", "last_synced_at": None},
    ]
    accounts.sources_replace("ow-1", json.dumps({"connections": connections}), NOW)

    refresh(accounts, tmp_path)
    refresh(accounts, tmp_path)

    items = open_items(accounts)
    assert [(i.kind, i.account_id) for i in items] == [("disconnected", account.id)]
    assert "suunto" in items[0].message and "Otec" in items[0].message

    connections[0]["status"] = "active"
    accounts.sources_replace("ow-1", json.dumps({"connections": connections}), NOW)
    refresh(accounts, tmp_path)
    assert open_items(accounts) == []


def test_watchdog_reconnect_line_adds_funnel_item_once(accounts, tmp_path):
    log = tmp_path / "funnel-watchdog.log"
    log.write_text(
        "2026-10-18 09:00:00 Funnel ok\n"
        "2026-10-18 10:30:44 Funnel does not answer; Tailscale reconnected\n",
        encoding="utf-8",
    )

    refresh(accounts, tmp_path)
    refresh(accounts, tmp_path)

    items = open_items(accounts)
    assert [(i.kind, i.account_id) for i in items] == [("funnel", None)]
    assert items[0].message == "Funnel neodpovedal, Tailscale sa znova pripojil (10:30)"

    accounts.inbox_resolve(items[0].id, NOW)
    refresh(accounts, tmp_path)
    assert open_items(accounts) == []

    log.write_text(log.read_text() + "2026-10-18 11:00:00 Funnel ok\n", encoding="utf-8")
    refresh(accounts, tmp_path)
    assert open_items(accounts) == []


def test_newer_ow_release_adds_update_item(accounts, tmp_path):
    refresh(accounts, tmp_path, version="0.10.0", latest="0.10.0")
    assert open_items(accounts) == []

    refresh(accounts, tmp_path, version="0.10.0", latest="0.10.1")
    refresh(accounts, tmp_path, version="0.10.0", latest="0.10.1")
    items = open_items(accounts)
    assert [(i.kind, i.message) for i in items] == [
        ("ow_update", "Je nová verzia Open Wearables 0.10.1 (beží 0.10.0)")
    ]

    refresh(accounts, tmp_path, version="0.10.1", latest="0.10.1")
    assert open_items(accounts) == []


def test_version_comparison_is_numeric(accounts):
    assert inbox.is_newer("v0.10.0", "0.9.9")
    assert inbox.is_newer("1.0", "0.99.9")
    assert not inbox.is_newer("0.10.0", "0.10.0")
    assert not inbox.is_newer("0.9.0", "0.10.0")
    assert not inbox.is_newer("garbage", "0.10.0")
    assert not inbox.is_newer(None, "0.10.0")


def test_github_failure_is_silent(accounts):
    http = FakeHttp(error=RuntimeError("offline"))

    assert latest_ow_release(http) is None
    assert latest_ow_release(http, accounts, NOW) is None
    assert running_ow_version(http, "http://ow.test") is None


def test_latest_release_is_asked_once_in_24_hours(accounts):
    http = FakeHttp({inbox.RELEASE_URL: {"tag_name": "v0.10.1"}})

    assert latest_ow_release(http, accounts, NOW) == "0.10.1"
    assert latest_ow_release(http, accounts, NOW + timedelta(hours=23)) == "0.10.1"
    assert len(http.urls) == 1
    assert accounts.system_get("ow_latest") == "0.10.1"

    assert latest_ow_release(http, accounts, NOW + timedelta(hours=25)) == "0.10.1"
    assert len(http.urls) == 2


def test_failed_check_keeps_the_known_release_and_waits_24_hours(accounts):
    accounts.system_set("ow_latest", "0.10.1")
    http = FakeHttp(error=RuntimeError("offline"))

    assert latest_ow_release(http, accounts, NOW) == "0.10.1"
    assert latest_ow_release(http, accounts, NOW + timedelta(hours=1)) == "0.10.1"
    assert len(http.urls) == 1


def test_running_version_comes_from_openapi(accounts):
    http = FakeHttp({"http://ow.test/openapi.json": {"info": {"version": "0.10.0"}}})

    assert running_ow_version(http, "http://ow.test/") == "0.10.0"


def resolve_by_hand(accounts, kind):
    (item,) = [i for i in accounts.inbox_list(False) if i.kind == kind]
    accounts.inbox_resolve(item.id, NOW)


def test_stale_item_resolved_by_hand_stays_quiet_until_the_condition_ends(accounts, tmp_path):
    person(accounts, "a@example.test", "Andrea", ow_user_id="ow-1")
    accounts.last_data_set("ow-1", NOW - timedelta(hours=25))
    refresh(accounts, tmp_path)
    resolve_by_hand(accounts, "stale_data")

    refresh(accounts, tmp_path)
    refresh(accounts, tmp_path, now=NOW + timedelta(hours=2))
    assert open_items(accounts) == []

    accounts.last_data_set("ow-1", NOW + timedelta(hours=3))
    refresh(accounts, tmp_path, now=NOW + timedelta(hours=3))
    assert open_items(accounts) == []

    refresh(accounts, tmp_path, now=NOW + timedelta(hours=30))
    assert [i.kind for i in open_items(accounts)] == ["stale_data"]


def test_pairing_item_resolved_by_hand_stays_quiet_until_paired_and_unpaired(accounts, tmp_path):
    account = person(accounts, "p@example.test")
    refresh(accounts, tmp_path)
    resolve_by_hand(accounts, "pairing")

    refresh(accounts, tmp_path)
    assert open_items(accounts) == []

    accounts.pair(account.id, "ow-1")
    refresh(accounts, tmp_path)
    accounts.unpair(account.id)
    refresh(accounts, tmp_path)
    assert [i.kind for i in open_items(accounts)] == ["pairing"]


def test_disconnected_item_resolved_by_hand_stays_quiet_until_reconnected(accounts, tmp_path):
    person(accounts, "o@example.test", "Otec", ow_user_id="ow-1")

    def sources(status):
        data = {"connections": [{"provider": "suunto", "status": status}]}
        accounts.sources_replace("ow-1", json.dumps(data), NOW)

    sources("revoked")
    refresh(accounts, tmp_path)
    resolve_by_hand(accounts, "disconnected")
    refresh(accounts, tmp_path)
    assert open_items(accounts) == []

    sources("active")
    refresh(accounts, tmp_path)
    sources("revoked")
    refresh(accounts, tmp_path)
    assert [i.kind for i in open_items(accounts)] == ["disconnected"]


def test_reconnect_line_followed_by_other_lines_is_still_found(accounts, tmp_path):
    (tmp_path / "funnel-watchdog.log").write_text(
        "2026-10-18 10:30:44 Funnel does not answer; Tailscale reconnected\n"
        "2026-10-18 10:45:00 check skipped: tailscale busy\n"
        "2026-10-18 11:00:00 Funnel does not answer; reconnected recently, waiting\n",
        encoding="utf-8",
    )

    refresh(accounts, tmp_path)
    refresh(accounts, tmp_path)

    assert [i.message for i in open_items(accounts)] == [
        "Funnel neodpovedal, Tailscale sa znova pripojil (10:30)"
    ]


def test_reconnect_lines_older_than_24_hours_are_ignored(accounts, tmp_path):
    (tmp_path / "funnel-watchdog.log").write_text(
        "2026-10-16 10:30:44 Funnel does not answer; Tailscale reconnected\n"
        "2026-10-18 11:00:00 Funnel ok\n",
        encoding="utf-8",
    )

    refresh(accounts, tmp_path)

    assert open_items(accounts) == []
