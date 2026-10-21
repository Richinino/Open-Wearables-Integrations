import json
import threading
from datetime import date, timedelta

import httpx
import pytest

from owi import cli, entries
from owi.accounts import Accounts, OwUser, accounts_path
from owi.serve import MAX_BODY_BYTES, Response, make_server, respond
from owi.store import Store
from owi.users import user_paths
from tests.factories import utc
from tests.test_store import make_day

TOKEN = "t" * 40
WRITE_TOKEN = "w" * 40
READ_AUTH = f"Bearer {TOKEN}"
WRITE_AUTH = f"Bearer {WRITE_TOKEN}"
TIMEZONE = "Europe/Bratislava"
NOW = utc(2026, 10, 18, 9)
PASSWORD = "correct horse battery"
NEW_PASSWORD = "a different long one"
IP = "203.0.113.7"
ACCOUNT_KEYS = {
    "id",
    "email",
    "first_name",
    "last_name",
    "role",
    "status",
    "paired",
    "birth_date",
    "sex",
    "training_consent",
    "settings",
    "has_samsung",
    "created_at",
    "last_login_at",
    "session_version",
}
ADMIN_KEYS = ACCOUNT_KEYS | {"ow_user_id", "last_data_at"}
ENTRY = {"steps": 12345, "sleep_score": 80}


@pytest.fixture
def data(tmp_path):
    """A data folder whose accounts store exists (owi accounts create-admin makes it)."""
    folder = tmp_path / "data"
    with Accounts(accounts_path(folder)):
        pass
    return folder


def store(data) -> Accounts:
    return Accounts(accounts_path(data))


def call(
    data,
    method: str,
    target: str,
    body: object = None,
    *,
    authorization: str | None = WRITE_AUTH,
    acting: str | None = None,
    client_ip: str | None = IP,
    raw: bytes | None = None,
    write_token: str = WRITE_TOKEN,
    now=NOW,
) -> Response:
    if raw is None:
        raw = b"" if body is None else json.dumps(body).encode()
    return respond(
        method,
        target,
        authorization,
        db_path=data / "owi.db",
        token=TOKEN,
        timezone=TIMEZONE,
        write_token=write_token,
        body=raw,
        accounts_path=accounts_path(data),
        data_dir=data,
        acting=acting,
        client_ip=client_ip,
        now=now,
    )


def admin_call(data, admin_id: str, method: str, target: str, body: object = None) -> Response:
    return call(data, method, target, body, acting=admin_id)


def make_admin(data, email="admin@example.test", status="active"):
    return store(data).create(email, "Admin", None, PASSWORD, "admin", status, NOW)


def make_user(data, email="ada@example.test", ow_user_id: str | None = None, first="Ada"):
    accounts = store(data)
    account = accounts.create(email, first, None, PASSWORD, "user", "pending", NOW)
    if ow_user_id is not None:
        account = accounts.pair(account.id, ow_user_id)
    return account


def known_ow_users(data, *ids: str) -> None:
    store(data).ow_users_replace([OwUser(item, f"Label {item}") for item in ids])


def save_days(data, ow_user_id: str, steps: int) -> None:
    with Store(user_paths(data, ow_user_id).db_path) as db:
        for offset in (1, 2, 3):
            db.save_day(make_day(date(2026, 10, offset), steps=steps + offset))


def register(data, email="ada@example.test", first_name="Ada", client_ip=IP, **extra) -> Response:
    body = {"email": email, "first_name": first_name, "password": PASSWORD, **extra}
    return call(data, "POST", "/v1/accounts/register", body, client_ip=client_ip)


def login(data, email="ada@example.test", password=PASSWORD, now=NOW) -> Response:
    return call(data, "POST", "/v1/accounts/login", {"email": email, "password": password}, now=now)


# accounts


def test_register_login_and_me_round_trip(data):
    created = register(data, email="  Ada@Example.TEST ", last_name="Test")

    assert created.status == 201
    account = created.body
    assert set(account) == ACCOUNT_KEYS
    assert account["email"] == "ada@example.test"
    assert account["first_name"] == "Ada"
    assert account["last_name"] == "Test"
    assert account["role"] == "user"
    assert account["status"] == "pending"
    assert account["paired"] is False
    assert account["has_samsung"] is False
    assert account["training_consent"] is True
    assert account["settings"] == {
        "theme": "system",
        "sleep_score": "performance",
        "overview_mode": "auto",
    }
    assert account["created_at"] == NOW.isoformat()
    assert account["last_login_at"] is None
    assert account["session_version"] == 0
    assert json.loads(json.dumps(account)) == account

    later = NOW + timedelta(minutes=5)
    logged_in = login(data, email="ADA@example.test", now=later)

    assert logged_in.status == 200
    assert logged_in.body == {**account, "last_login_at": later.isoformat()}

    me = call(data, "GET", f"/v1/accounts/{account['id']}")

    assert me == Response(200, logged_in.body)


def test_account_json_never_contains_the_password_hash(data):
    admin = make_admin(data)
    known_ow_users(data, "ow-a")
    account = register(data).body
    account_id = account["id"]
    answers = [
        account,
        login(data).body,
        call(data, "GET", f"/v1/accounts/{account_id}").body,
        call(data, "PATCH", f"/v1/accounts/{account_id}", {"first_name": "Adela"}).body,
        call(
            data,
            "POST",
            f"/v1/accounts/{account_id}/password",
            {"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        ).body,
        call(data, "POST", f"/v1/accounts/{account_id}/logout-all").body,
        admin_call(
            data, admin.id, "POST", f"/v1/admin/accounts/{account_id}/pair", {"ow_user_id": "ow-a"}
        ).body,
        admin_call(data, admin.id, "GET", "/v1/admin/accounts").body,
        admin_call(data, admin.id, "PATCH", f"/v1/admin/accounts/{account_id}", {}).body,
        admin_call(data, admin.id, "POST", f"/v1/admin/accounts/{account_id}/unpair").body,
    ]
    stored = store(data).get(account_id).password_hash

    for answer in answers:
        text = json.dumps(answer)
        assert "password" not in text
        assert "scrypt" not in text
        assert stored not in text
        assert PASSWORD not in text
        assert NEW_PASSWORD not in text


def test_register_validates_and_refuses_a_taken_email(data):
    invalid = call(
        data,
        "POST",
        "/v1/accounts/register",
        {"email": "nope", "first_name": "", "password": "short"},
    )

    assert invalid.status == 400
    assert invalid.body["error"] == "invalid"
    assert set(invalid.body["fields"]) == {"email", "first_name", "password"}
    assert register(data).status == 201
    assert register(data, email="ADA@example.test") == Response(409, {"error": "email_taken"})


def test_registration_is_limited_per_client_ip(data):
    for number in range(5):
        assert register(data, email=f"u{number}@example.test").status == 201

    refused = register(data, email="u5@example.test")

    assert refused.status == 429
    assert refused.body["error"] == "too_many_attempts"
    assert refused.body["retry_after_s"] > 0
    assert register(data, email="u6@example.test", client_ip="198.51.100.9").status == 201


def test_registration_closed_is_403(data):
    admin = make_admin(data)

    closed = admin_call(data, admin.id, "PUT", "/v1/admin/system", {"registration_open": False})

    assert closed.status == 200
    assert closed.body["registration_open"] is False
    assert register(data) == Response(403, {"error": "registration_closed"})
    assert store(data).all() == [admin]

    opened = admin_call(data, admin.id, "PUT", "/v1/admin/system", {"registration_open": True})

    assert opened.body["registration_open"] is True
    assert register(data).status == 201


def test_login_refuses_wrong_passwords_suspended_accounts_and_too_many_attempts(data):
    make_user(data)
    suspended = make_user(data, email="sus@example.test")
    store(data).set_role_status(suspended.id, None, "suspended")

    assert login(data, email="sus@example.test") == Response(403, {"error": "suspended"})
    assert login(data, email="nobody@example.test") == Response(
        401, {"error": "invalid_credentials"}
    )
    for _ in range(5):
        assert login(data, password="wrong password!").status == 401

    locked = login(data)

    assert locked.status == 429
    assert locked.body["error"] == "too_many_attempts"
    assert 0 < locked.body["retry_after_s"] <= 15 * 60 + 1


def test_get_an_unknown_account_is_404(data):
    assert call(data, "GET", "/v1/accounts/missing") == Response(404, {"error": "not_found"})


def test_patch_changes_the_own_profile_and_settings(data):
    account = make_user(data)
    make_user(data, email="taken@example.test", first="Other")
    target = f"/v1/accounts/{account.id}"

    changed = call(
        data,
        "PATCH",
        target,
        {
            "last_name": "Test",
            "birth_date": "2008-10-13",
            "sex": "female",
            "training_consent": False,
            "settings": {"theme": "dark"},
        },
    )

    assert changed.status == 200
    assert changed.body["last_name"] == "Test"
    assert changed.body["birth_date"] == "2008-10-13"
    assert changed.body["sex"] == "female"
    assert changed.body["training_consent"] is False
    assert changed.body["settings"]["theme"] == "dark"
    assert changed.body["settings"]["sleep_score"] == "performance"

    invalid = call(data, "PATCH", target, {"sex": "other", "birth_date": "18.10.2026"})

    assert invalid.status == 400
    assert set(invalid.body["fields"]) == {"sex", "birth_date"}
    assert call(data, "PATCH", target, {"email": "Taken@example.test"}) == Response(
        409, {"error": "email_taken"}
    )


@pytest.mark.parametrize(
    "changes", [{"role": "admin"}, {"status": "active"}, {"ow_user_id": "ow-x"}]
)
def test_patch_cannot_change_role_status_or_pairing(data, changes):
    account = make_user(data)

    response = call(data, "PATCH", f"/v1/accounts/{account.id}", changes)

    assert response.status == 400
    after = store(data).get(account.id)
    assert (after.role, after.status, after.ow_user_id) == ("user", "pending", None)


def test_password_change_needs_the_current_one_and_bumps_the_session(data):
    account = make_user(data)
    target = f"/v1/accounts/{account.id}/password"

    wrong = call(data, "POST", target, {"current_password": "not it at all", "new_password": "x"})
    short = call(data, "POST", target, {"current_password": PASSWORD, "new_password": "short"})
    changed = call(
        data, "POST", target, {"current_password": PASSWORD, "new_password": NEW_PASSWORD}
    )

    assert wrong == Response(401, {"error": "invalid_credentials"})
    assert short.status == 400
    assert set(short.body["fields"]) == {"new_password"}
    assert changed.status == 200
    assert changed.body["session_version"] == 1
    assert login(data, password=PASSWORD).status == 401
    assert login(data, password=NEW_PASSWORD).status == 200


def test_logout_all_bumps_the_session_version(data):
    account = make_user(data)

    response = call(data, "POST", f"/v1/accounts/{account.id}/logout-all")

    assert response.status == 200
    assert response.body["session_version"] == 1
    assert store(data).get(account.id).session_version == 1


# deleting accounts


def entries_of(data, ow_user_id: str):
    return user_paths(data, ow_user_id).entries_path


def test_deleting_an_account_removes_its_entries_and_queues_its_folder(data):
    admin = make_admin(data)
    own = make_user(data, ow_user_id="ow-a")
    other = make_user(data, email="bob@example.test", ow_user_id="ow-b", first="Bob")
    unpaired = make_user(data, email="eve@example.test", first="Eve")
    for ow_user_id in ("ow-a", "ow-b"):
        entries.save(entries_of(data, ow_user_id), date(2026, 10, 2), {"steps": 1}, NOW)
        user_paths(data, ow_user_id).folder.mkdir(parents=True)

    wrong = call(data, "DELETE", f"/v1/accounts/{own.id}", {"password": "not the password"})
    assert wrong == Response(401, {"error": "invalid_credentials"})
    assert store(data).get(own.id) is not None

    deleted = call(data, "DELETE", f"/v1/accounts/{own.id}", {"password": PASSWORD})

    assert deleted == Response(204, {})
    assert store(data).get(own.id) is None
    assert not entries_of(data, "ow-a").parent.exists()
    assert store(data).deletions_pending() == ["ow-a"]
    # The computed days stay until the owi container removes them (api cannot write there).
    assert user_paths(data, "ow-a").folder.exists()
    assert entries_of(data, "ow-b").exists()

    by_admin = admin_call(data, admin.id, "DELETE", f"/v1/admin/accounts/{other.id}")
    unpaired_gone = admin_call(data, admin.id, "DELETE", f"/v1/admin/accounts/{unpaired.id}")

    assert by_admin == Response(204, {})
    assert unpaired_gone == Response(204, {})
    assert not entries_of(data, "ow-b").parent.exists()
    assert store(data).deletions_pending() == ["ow-a", "ow-b"]
    assert [account.id for account in store(data).all()] == [admin.id]


def test_the_last_admin_cannot_delete_itself(data):
    admin = make_admin(data)

    own = call(data, "DELETE", f"/v1/accounts/{admin.id}", {"password": PASSWORD})
    by_admin = admin_call(data, admin.id, "DELETE", f"/v1/admin/accounts/{admin.id}")

    assert own == Response(409, {"error": "last_admin"})
    assert by_admin == Response(409, {"error": "last_admin"})
    assert store(data).get(admin.id) is not None


def test_deleting_an_unknown_account_is_404(data):
    admin = make_admin(data)

    assert call(data, "DELETE", "/v1/accounts/missing", {"password": PASSWORD}).status == 404
    assert admin_call(data, admin.id, "DELETE", "/v1/admin/accounts/missing").status == 404


# password reset


def test_reset_request_always_answers_202_and_adds_inbox_only_for_known_email(data):
    admin = make_admin(data)
    account = make_user(data)

    unknown = call(data, "POST", "/v1/password-reset/request", {"email": "who@example.test"})
    assert unknown.status == 202
    assert store(data).inbox_list(resolved=False) == []

    known = call(data, "POST", "/v1/password-reset/request", {"email": " ADA@example.test"})

    assert known.status == 202
    assert known.body == unknown.body
    inbox = admin_call(data, admin.id, "GET", "/v1/admin/inbox?resolved=0")
    assert inbox.status == 200
    (item,) = inbox.body
    assert set(item) == {"id", "kind", "account_id", "message", "created_at", "resolved_at"}
    assert item["kind"] == "password_reset"
    assert item["account_id"] == account.id
    assert item["created_at"] == NOW.isoformat()
    assert item["resolved_at"] is None


def test_a_reset_link_sets_a_new_password_once(data):
    admin = make_admin(data)
    account = make_user(data)

    link = admin_call(data, admin.id, "POST", f"/v1/admin/accounts/{account.id}/reset-link")

    assert link.status == 200
    assert set(link.body) == {"token", "expires_at"}
    assert link.body["expires_at"] == (NOW + timedelta(hours=24)).isoformat()
    token = link.body["token"]
    body = {"token": token, "new_password": NEW_PASSWORD}

    short = call(data, "POST", "/v1/password-reset/confirm", {**body, "new_password": "short"})
    confirmed = call(data, "POST", "/v1/password-reset/confirm", body)
    again = call(data, "POST", "/v1/password-reset/confirm", body)

    assert short.status == 400
    assert set(short.body["fields"]) == {"new_password"}
    assert confirmed.status == 200
    assert confirmed.body["id"] == account.id
    assert confirmed.body["session_version"] == 1
    assert again == Response(400, {"error": "invalid_token"})
    assert login(data, password=NEW_PASSWORD).status == 200


def test_a_reset_token_is_never_stored_raw(data):
    admin = make_admin(data)
    account = make_user(data)

    token = admin_call(data, admin.id, "POST", f"/v1/admin/accounts/{account.id}/reset-link").body[
        "token"
    ]

    assert token.encode() not in accounts_path(data).read_bytes()


# admin


ADMIN_ROUTES = [
    ("GET", "/v1/admin/accounts", None),
    ("GET", "/v1/admin/ow-users", None),
    ("POST", "/v1/admin/accounts/{id}/pair", {"ow_user_id": "ow-a"}),
    ("POST", "/v1/admin/accounts/{id}/unpair", None),
    ("PATCH", "/v1/admin/accounts/{id}", {"role": "admin"}),
    ("DELETE", "/v1/admin/accounts/{id}", None),
    ("POST", "/v1/admin/accounts/{id}/reset-link", None),
    ("GET", "/v1/admin/accounts/{id}/sources", None),
    ("GET", "/v1/admin/inbox?resolved=0", None),
    ("POST", "/v1/admin/inbox/1/resolve", None),
    ("GET", "/v1/admin/system", None),
    ("PUT", "/v1/admin/system", {"registration_open": False}),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES)
@pytest.mark.parametrize("who", ["nobody", "unknown", "user", "suspended_admin", "pending_admin"])
def test_admin_endpoints_need_an_active_admin_acting_header(data, method, path, body, who):
    make_admin(data)  # an active admin exists, but is not the one acting
    known_ow_users(data, "ow-a")
    target = make_user(data, email="target@example.test", first="Target")
    store(data).inbox_add("pairing", target.id, "čaká", "pairing:x", NOW)
    acting = {
        "nobody": None,
        "unknown": "no-such-account",
        "user": make_user(data, email="user@example.test", first="User").id,
        "suspended_admin": make_admin(data, "sus@example.test", status="suspended").id,
        "pending_admin": make_admin(data, "pend@example.test", status="pending").id,
    }[who]
    before = store(data).all()

    response = call(data, method, path.format(id=target.id), body, acting=acting)

    assert response == Response(403, {"error": "forbidden"})
    assert store(data).all() == before
    assert store(data).system_get("registration_open") is None
    assert len(store(data).inbox_list(resolved=False)) == 1


def test_admin_endpoints_still_need_the_write_token(data):
    admin = make_admin(data)

    for authorization in (None, READ_AUTH, "Bearer wrong"):
        response = call(
            data, "GET", "/v1/admin/accounts", authorization=authorization, acting=admin.id
        )
        assert response == Response(401, {"error": "unauthorized"})


def test_admin_accounts_list_waiting_ones_first_with_admin_fields(data):
    admin = make_admin(data)
    paired = make_user(data, email="bob@example.test", ow_user_id="ow-b", first="Bob")
    waiting = make_user(data)
    store(data).last_data_set("ow-b", utc(2026, 10, 18, 7))

    response = admin_call(data, admin.id, "GET", "/v1/admin/accounts")

    assert response.status == 200
    assert response.body[0]["id"] == waiting.id
    assert {item["id"] for item in response.body[1:]} == {admin.id, paired.id}
    for item in response.body:
        assert set(item) == ADMIN_KEYS
    by_id = {item["id"]: item for item in response.body}
    assert by_id[paired.id]["ow_user_id"] == "ow-b"
    assert by_id[paired.id]["paired"] is True
    assert by_id[paired.id]["last_data_at"] == "2026-10-18T07:00:00+00:00"
    assert by_id[waiting.id]["ow_user_id"] is None
    assert by_id[waiting.id]["last_data_at"] is None


def test_ow_users_show_which_account_they_are_paired_with(data):
    admin = make_admin(data)
    known_ow_users(data, "ow-a", "ow-b")
    paired = make_user(data, ow_user_id="ow-b")

    response = admin_call(data, admin.id, "GET", "/v1/admin/ow-users")

    assert response == Response(
        200,
        [
            {"id": "ow-a", "label": "Label ow-a", "paired_account_id": None},
            {"id": "ow-b", "label": "Label ow-b", "paired_account_id": paired.id},
        ],
    )


def test_pair_makes_the_account_active_and_unpair_makes_it_wait(data):
    admin = make_admin(data)
    known_ow_users(data, "ow-a")
    account = make_user(data)
    target = f"/v1/admin/accounts/{account.id}"

    paired = admin_call(data, admin.id, "POST", f"{target}/pair", {"ow_user_id": "ow-a"})

    assert paired.status == 200
    assert set(paired.body) == ADMIN_KEYS
    assert (paired.body["status"], paired.body["paired"]) == ("active", True)
    assert paired.body["ow_user_id"] == "ow-a"

    unpaired = admin_call(data, admin.id, "POST", f"{target}/unpair")

    assert unpaired.status == 200
    assert (unpaired.body["status"], unpaired.body["paired"]) == ("pending", False)
    assert unpaired.body["ow_user_id"] is None


def test_pair_conflict_is_409(data):
    admin = make_admin(data)
    known_ow_users(data, "ow-a")
    first = make_user(data, ow_user_id="ow-a")
    second = make_user(data, email="bob@example.test", first="Bob")

    response = admin_call(
        data, admin.id, "POST", f"/v1/admin/accounts/{second.id}/pair", {"ow_user_id": "ow-a"}
    )

    assert response == Response(409, {"error": "ow_user_taken"})
    assert store(data).get(second.id).ow_user_id is None
    assert store(data).get(second.id).status == "pending"
    assert store(data).get(first.id).ow_user_id == "ow-a"
    # The second account sees no data of the first one.
    save_days(data, "ow-a", 100)
    assert call(data, "GET", f"/v1/days?account={second.id}", authorization=READ_AUTH) == Response(
        404, {"error": "not_paired"}
    )


@pytest.mark.parametrize("ow_user_id", ["ow-unknown", "../ow-a", "", None, 7])
def test_pair_takes_only_a_known_open_wearables_user(data, ow_user_id):
    admin = make_admin(data)
    known_ow_users(data, "ow-a", "../ow-a")
    account = make_user(data)

    response = admin_call(
        data, admin.id, "POST", f"/v1/admin/accounts/{account.id}/pair", {"ow_user_id": ow_user_id}
    )

    assert response.status == 400
    assert set(response.body["fields"]) == {"ow_user_id"}
    assert store(data).get(account.id).ow_user_id is None


def test_pairing_again_cancels_the_queued_folder_deletion(data):
    admin = make_admin(data)
    known_ow_users(data, "ow-a")
    account = make_user(data)
    store(data).deletions_add("ow-a", NOW)

    admin_call(
        data, admin.id, "POST", f"/v1/admin/accounts/{account.id}/pair", {"ow_user_id": "ow-a"}
    )

    assert store(data).deletions_pending() == []


def test_admin_changes_role_and_status_but_not_of_the_last_admin(data):
    admin = make_admin(data)
    account = make_user(data, ow_user_id="ow-a")
    target = f"/v1/admin/accounts/{account.id}"

    suspended = admin_call(data, admin.id, "PATCH", target, {"status": "suspended"})
    promoted = admin_call(data, admin.id, "PATCH", target, {"role": "admin", "status": "active"})
    invalid = admin_call(data, admin.id, "PATCH", target, {"role": "owner"})
    unknown_field = admin_call(data, admin.id, "PATCH", target, {"email": "x@example.test"})

    assert suspended.status == 200
    assert suspended.body["status"] == "suspended"
    assert set(suspended.body) == ADMIN_KEYS
    assert (promoted.body["role"], promoted.body["status"]) == ("admin", "active")
    assert invalid.status == 400
    assert set(invalid.body["fields"]) == {"role"}
    assert unknown_field.status == 400
    assert set(unknown_field.body["fields"]) == {"email"}

    # Two active admins: the first may step down, the second (now the last one) may not.
    stepped_down = admin_call(
        data, account.id, "PATCH", f"/v1/admin/accounts/{admin.id}", {"role": "user"}
    )
    assert stepped_down.body["role"] == "user"
    last = admin_call(data, account.id, "PATCH", target, {"status": "suspended"})
    assert last == Response(409, {"error": "last_admin"})


def test_sources_of_an_account(data):
    admin = make_admin(data)
    paired = make_user(data, ow_user_id="ow-a")
    waiting = make_user(data, email="bob@example.test", first="Bob")
    sources = {
        "connections": [{"provider": "garmin", "status": "active", "last_synced_at": None}],
        "types": [{"type": "steps", "provider": "garmin", "arriving": True}],
        "samsung_health": False,
        "checked_at": "2026-10-18T08:00:00+00:00",
    }
    store(data).sources_replace("ow-a", json.dumps(sources), NOW)

    found = admin_call(data, admin.id, "GET", f"/v1/admin/accounts/{paired.id}/sources")
    empty = admin_call(data, admin.id, "GET", f"/v1/admin/accounts/{waiting.id}/sources")
    missing = admin_call(data, admin.id, "GET", "/v1/admin/accounts/missing/sources")

    assert found == Response(
        200,
        {
            "connections": sources["connections"],
            "types": sources["types"],
            "updated_at": "2026-10-18T08:00:00+00:00",
        },
    )
    assert empty == Response(200, {"connections": [], "types": [], "updated_at": None})
    assert missing == Response(404, {"error": "not_found"})


def test_has_samsung_comes_from_the_sources_of_the_paired_user(data):
    account = make_user(data, ow_user_id="ow-a")
    target = f"/v1/accounts/{account.id}"
    assert call(data, "GET", target).body["has_samsung"] is False

    store(data).sources_replace("ow-a", json.dumps({"samsung_health": True}), NOW)

    assert call(data, "GET", target).body["has_samsung"] is True


def test_inbox_items_are_resolved(data):
    admin = make_admin(data)
    store(data).inbox_add("funnel", None, "Funnel znova beží", "funnel:1", NOW)
    (item,) = admin_call(data, admin.id, "GET", "/v1/admin/inbox").body
    later = NOW + timedelta(hours=1)

    resolved = call(
        data, "POST", f"/v1/admin/inbox/{item['id']}/resolve", acting=admin.id, now=later
    )

    assert resolved == Response(200, {**item, "resolved_at": later.isoformat()})
    assert admin_call(data, admin.id, "GET", "/v1/admin/inbox?resolved=0").body == []
    assert admin_call(data, admin.id, "GET", "/v1/admin/inbox?resolved=1").body == [resolved.body]
    assert admin_call(data, admin.id, "POST", "/v1/admin/inbox/999/resolve").status == 404
    assert admin_call(data, admin.id, "POST", "/v1/admin/inbox/abc/resolve").status == 404


def test_system_reports_registration_and_last_sync(data):
    admin = make_admin(data)
    accounts = store(data)
    empty = admin_call(data, admin.id, "GET", "/v1/admin/system")

    assert empty == Response(
        200,
        {
            "ow_api": "down",
            "ow_version": None,
            "ow_latest": None,
            "last_sync_at": None,
            "funnel": {"last_event_at": None, "last_event": None},
            "registration_open": True,
        },
    )

    accounts.system_set("last_sync_at", "2026-10-18T08:50:00+00:00")
    accounts.system_set("last_sync_ok", "1")
    accounts.system_set("registration_open", "0")
    (data / "funnel-watchdog.log").write_text(
        "2026-10-18 10:40:00 check skipped: offline\n"
        "2026-10-18 10:45:00 Funnel does not answer; Tailscale reconnected\n\n",
        encoding="utf-8",
    )

    report = admin_call(data, admin.id, "GET", "/v1/admin/system")

    assert report == Response(
        200,
        {
            "ow_api": "ok",
            "ow_version": None,
            "ow_latest": None,
            "last_sync_at": "2026-10-18T08:50:00+00:00",
            "funnel": {
                "last_event_at": "2026-10-18T10:45:00+02:00",
                "last_event": "Funnel does not answer; Tailscale reconnected",
            },
            "registration_open": False,
        },
    )

    accounts.system_set("last_sync_ok", "0")

    assert admin_call(data, admin.id, "GET", "/v1/admin/system").body["ow_api"] == "down"


def test_a_watchdog_log_written_with_a_bom_still_reads(data):
    admin = make_admin(data)
    (data / "funnel-watchdog.log").write_bytes(
        "﻿2026-10-18 10:45:00 check skipped: offline\r\n".encode()
    )

    funnel = admin_call(data, admin.id, "GET", "/v1/admin/system").body["funnel"]

    assert funnel == {
        "last_event_at": "2026-10-18T10:45:00+02:00",
        "last_event": "check skipped: offline",
    }


@pytest.mark.parametrize("body", [{"registration_open": "no"}, {}, {"other": True}])
def test_system_change_takes_only_a_boolean_registration_switch(data, body):
    admin = make_admin(data)

    response = admin_call(data, admin.id, "PUT", "/v1/admin/system", body)

    assert response.status == 400
    assert response.body["error"] == "invalid"
    assert store(data).system_get("registration_open") is None


# per-account data


def days(data, account_id: str | None, authorization: str | None = READ_AUTH) -> Response:
    query = "" if account_id is None else f"?account={account_id}"
    return call(data, "GET", f"/v1/days{query}", authorization=authorization)


def test_days_for_account_reads_its_own_folder(data):
    ada = make_user(data, ow_user_id="ow-a")
    bob = make_user(data, email="bob@example.test", ow_user_id="ow-b", first="Bob")
    save_days(data, "ow-a", 100)
    save_days(data, "ow-b", 200)

    for account, steps in ((ada, [101, 102, 103]), (bob, [201, 202, 203])):
        response = days(data, account.id)
        assert response.status == 200
        assert [day["steps"] for day in response.body["days"]] == steps


def test_days_for_a_pending_account_is_404_not_paired(data):
    account = make_user(data)

    assert days(data, account.id) == Response(404, {"error": "not_paired"})


def test_days_for_a_paired_account_set_back_to_pending_is_404_not_paired(data):
    account = make_user(data, ow_user_id="ow-a")
    save_days(data, "ow-a", 100)
    store(data).set_role_status(account.id, None, "pending")

    assert days(data, account.id) == Response(404, {"error": "not_paired"})


def test_days_for_a_suspended_or_unknown_account(data):
    account = make_user(data, ow_user_id="ow-a")
    save_days(data, "ow-a", 100)
    store(data).set_role_status(account.id, None, "suspended")

    assert days(data, account.id) == Response(403, {"error": "suspended"})
    assert days(data, "missing") == Response(404, {"error": "not_found"})


def test_days_of_an_account_still_need_the_read_token(data):
    account = make_user(data, ow_user_id="ow-a")
    save_days(data, "ow-a", 100)

    assert days(data, account.id, WRITE_AUTH) == Response(401, {"error": "unauthorized"})


def test_days_without_an_account_once_accounts_exist_name_the_missing_account(data):
    save_days(data, "ow-a", 100)
    with Store(data / "owi.db") as db:
        db.save_day(make_day(date(2026, 10, 1), steps=5))

    response = days(data, None)

    assert response == Response(400, {"error": "invalid", "fields": {"account": "povinné"}})


def test_days_of_a_paired_account_without_computed_days_are_unavailable(data):
    account = make_user(data, ow_user_id="ow-a")

    assert days(data, account.id) == Response(503, {"error": "no data yet"})
    assert not user_paths(data, "ow-a").folder.exists()


def put_entry(data, account_id: str | None, day="2026-10-02", body=ENTRY) -> Response:
    query = "" if account_id is None else f"?account={account_id}"
    return call(data, "PUT", f"/v1/entries/{day}{query}", body, now=utc(2026, 10, 3, 10))


def test_entries_go_to_the_accounts_folder(data):
    ada = make_user(data, ow_user_id="ow-a")
    make_user(data, email="bob@example.test", ow_user_id="ow-b", first="Bob")
    save_days(data, "ow-a", 100)
    save_days(data, "ow-b", 200)

    response = put_entry(data, ada.id)

    assert response.status == 200
    assert response.body["steps"] == 12345
    (saved,) = entries.load(entries_of(data, "ow-a"))
    assert saved.steps == 12345
    assert not entries_of(data, "ow-b").exists()
    assert not entries.path_in(data).exists()
    (day,) = days(data, ada.id).body["days"][1:2]
    assert day["samsung"]["steps"] == 12345


def test_entries_of_accounts_without_data_are_refused(data):
    waiting = make_user(data)
    suspended = make_user(data, email="sus@example.test", ow_user_id="ow-s", first="Sus")
    store(data).set_role_status(suspended.id, None, "suspended")

    assert put_entry(data, waiting.id) == Response(404, {"error": "not_paired"})
    assert put_entry(data, suspended.id) == Response(403, {"error": "suspended"})
    assert put_entry(data, "missing") == Response(404, {"error": "not_found"})
    assert put_entry(data, None) == Response(
        400, {"error": "invalid", "fields": {"account": "povinné"}}
    )
    assert not (data / "zapisy").exists()


def test_entries_of_an_account_still_need_the_write_token(data):
    account = make_user(data, ow_user_id="ow-a")
    save_days(data, "ow-a", 100)

    response = call(
        data,
        "PUT",
        f"/v1/entries/2026-10-02?account={account.id}",
        ENTRY,
        authorization=READ_AUTH,
    )

    assert response == Response(401, {"error": "unauthorized"})
    assert not entries_of(data, "ow-a").exists()


# requests in general


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/v1/accounts/register"),
        ("GET", "/v1/accounts/some-id"),
        ("POST", "/v1/password-reset/request"),
    ],
)
@pytest.mark.parametrize("authorization", [None, READ_AUTH, "Bearer nope", WRITE_TOKEN])
def test_account_endpoints_need_the_write_token(data, method, path, authorization):
    response = call(data, method, path, {"email": "x@example.test"}, authorization=authorization)

    assert response == Response(401, {"error": "unauthorized"})


def test_account_endpoints_are_unavailable_without_a_write_token(data):
    response = call(data, "POST", "/v1/accounts/login", {}, authorization=None, write_token="")

    assert response == Response(503, {"error": "writes are disabled"})


def test_a_body_that_is_not_a_json_object_is_invalid(data):
    for raw in (b"{email:", b"[1, 2]", b'"text"', b"\xff\xfe"):
        response = call(data, "POST", "/v1/accounts/login", raw=raw)
        assert response == Response(400, {"error": "invalid", "fields": {"body": "objekt JSON"}})


def test_text_that_is_not_unicode_is_an_invalid_body(data):
    make_user(data)
    # A lone surrogate is valid JSON but no text: hashing it would fail.
    raw = b'{"email": "ada@example.test", "password": "abc\\ud800defghijk"}'

    for path in ("/v1/accounts/login", "/v1/accounts/register"):
        response = call(data, "POST", path, raw=raw)
        assert response == Response(400, {"error": "invalid", "fields": {"body": "objekt JSON"}})


def test_a_body_over_the_limit_is_413(data):
    response = call(data, "POST", "/v1/accounts/register", raw=b" " * (MAX_BODY_BYTES + 1))

    assert response == Response(413, {"error": "body too large"})


def test_wrong_methods_of_account_paths_are_405(data):
    assert call(data, "GET", "/v1/accounts/register").status == 405
    assert call(data, "GET", "/v1/accounts/login").status == 405
    assert call(data, "PUT", "/v1/accounts/some-id").status == 405
    assert call(data, "GET", "/v1/accounts/some-id/password").status == 405
    assert call(data, "DELETE", "/v1/admin/system").status == 405
    assert call(data, "GET", "/v1/password-reset/confirm").status == 405


def test_unknown_account_paths_are_404(data):
    assert call(data, "GET", "/v1/accounts").status == 404
    assert call(data, "GET", "/v1/admin/nothing").status == 404
    assert call(data, "GET", "/v1/accounts/a/b/c").status == 404


def test_without_an_accounts_store_account_endpoints_wait_and_create_nothing(tmp_path):
    folder = tmp_path / "data"

    assert register(folder) == Response(503, {"error": "no accounts yet"})
    assert login(folder) == Response(503, {"error": "no accounts yet"})
    assert call(folder, "GET", "/v1/admin/accounts", acting="x") == Response(
        503, {"error": "no accounts yet"}
    )
    assert days(folder, "some-id") == Response(503, {"error": "no accounts yet"})
    assert not accounts_path(folder).exists()


def test_without_an_accounts_store_days_keep_todays_behaviour(tmp_path):
    folder = tmp_path / "data"
    with Store(folder / "owi.db") as db:
        db.save_day(make_day(date(2026, 10, 1), steps=5))

    response = days(folder, None)

    assert response.status == 200
    assert [day["steps"] for day in response.body["days"]] == [5]
    assert not accounts_path(folder).exists()


# over HTTP


@pytest.fixture
def base_url(data):
    server = make_server(
        "127.0.0.1",
        0,
        db_path=data / "owi.db",
        token=TOKEN,
        timezone=TIMEZONE,
        write_token=WRITE_TOKEN,
        accounts_path=accounts_path(data),
        data_dir=data,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def test_accounts_over_http(base_url, data):
    admin = make_admin(data)
    known_ow_users(data, "ow-a")
    headers = {"Authorization": WRITE_AUTH, "X-Owi-Client-Ip": "198.51.100.20"}

    created = httpx.post(
        f"{base_url}/v1/accounts/register",
        headers=headers,
        json={"email": "ada@example.test", "first_name": "Ada", "password": PASSWORD},
    )
    account_id = created.json()["id"]
    admin_headers = {"Authorization": WRITE_AUTH, "X-Owi-Acting": admin.id}
    paired = httpx.post(
        f"{base_url}/v1/admin/accounts/{account_id}/pair",
        headers=admin_headers,
        json={"ow_user_id": "ow-a"},
    )
    patched = httpx.patch(
        f"{base_url}/v1/accounts/{account_id}", headers=headers, json={"sex": "female"}
    )
    forbidden = httpx.get(f"{base_url}/v1/admin/accounts", headers=headers)
    deleted = httpx.request(
        "DELETE",
        f"{base_url}/v1/accounts/{account_id}",
        headers=headers,
        json={"password": PASSWORD},
    )

    assert created.status_code == 201
    assert paired.status_code == 200
    assert paired.json()["ow_user_id"] == "ow-a"
    assert patched.json()["sex"] == "female"
    assert (forbidden.status_code, forbidden.json()) == (403, {"error": "forbidden"})
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert store(data).get(account_id) is None


def test_too_many_attempts_over_http_carries_retry_after(base_url, data):
    make_user(data)
    headers = {"Authorization": WRITE_AUTH}
    body = {"email": "ada@example.test", "password": "wrong password!"}
    for _ in range(5):
        httpx.post(f"{base_url}/v1/accounts/login", headers=headers, json=body)

    locked = httpx.post(f"{base_url}/v1/accounts/login", headers=headers, json=body)

    assert locked.status_code == 429
    assert int(locked.headers["retry-after"]) == locked.json()["retry_after_s"]


# owi serve


def test_serve_hands_the_accounts_store_and_data_folder_to_the_server(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("OWI_SERVE_TOKEN", TOKEN)
    monkeypatch.setenv("OWI_WRITE_TOKEN", WRITE_TOKEN)
    monkeypatch.setenv("OWI_DATA_DIR", str(tmp_path / "data"))
    seen = {}

    class Server:
        server_address = ("127.0.0.1", 0)

        def serve_forever(self):
            raise KeyboardInterrupt

        def server_close(self):
            return None

    def fake_make_server(host, port, **kwargs):
        seen.update(kwargs)
        return Server()

    monkeypatch.setattr(cli, "make_server", fake_make_server)

    assert cli.main(["serve", "--port", "0"]) == 0

    assert seen["accounts_path"] == accounts_path(tmp_path / "data")
    assert seen["data_dir"] == tmp_path / "data"
    assert not accounts_path(tmp_path / "data").exists()


def test_consent_off_reports_default_calibration_without_deleting_previous_fit(data):
    from owi.calibration import save_params
    from owi.models import Params
    from owi.store import FitRecord

    account = make_user(data, ow_user_id="ow-fitted")
    save_days(data, "ow-fitted", 1000)
    paths = user_paths(data, "ow-fitted")
    fit = FitRecord(NOW, 20, None, {"stride_m": 1.1}, {})
    save_params(paths.params_path, Params(stride_m=1.1))
    with Store(paths.db_path) as db:
        db.save_fit(fit)
    target = f"/v1/days?account={account.id}"
    before = call(data, "GET", target, authorization=READ_AUTH).body["calibration"]
    assert before["fitted_at"] is not None and before["params"]["stride_m"] == 1.1
    store(data).update(account.id, {"training_consent": False})
    after = call(data, "GET", target, authorization=READ_AUTH).body["calibration"]
    assert after["fitted_at"] is None and after["entries"] == 0 and after["quality"] == {}
    assert after["params"] == after["defaults"]
    with Store(paths.db_path) as db:
        assert db.latest_fit() == fit
    store(data).update(account.id, {"training_consent": True})
    assert call(data, "GET", target, authorization=READ_AUTH).body["calibration"] == before


@pytest.mark.parametrize("replace_directly", [False, True])
def test_pairing_api_exposes_revoked_session_version_for_replacement_directory(
    data, replace_directly
):
    admin = make_admin(data)
    account = make_user(data, ow_user_id="ow-first")
    known_ow_users(data, "ow-first", "ow-second")
    save_days(data, "ow-first", 1000)
    save_days(data, "ow-second", 2000)
    path = f"/v1/admin/accounts/{account.id}"
    if not replace_directly:
        removed = admin_call(data, admin.id, "POST", f"{path}/unpair")
        assert removed.status == 200
        assert removed.body["session_version"] == account.session_version + 1
    paired = admin_call(data, admin.id, "POST", f"{path}/pair", {"ow_user_id": "ow-second"})
    assert paired.status == 200
    fresh = call(data, "GET", f"/v1/accounts/{account.id}")
    assert fresh.status == 200 and fresh.body["status"] == "active"
    assert fresh.body["session_version"] == account.session_version + 1
    assert fresh.body["id"] == account.id  # identity IDs alone cannot catch the change
    days = call(data, "GET", f"/v1/days?account={account.id}", authorization=READ_AUTH)
    assert days.status == 200 and days.body["days"][0]["steps"] == 2001
