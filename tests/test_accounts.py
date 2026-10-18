from datetime import timedelta

import pytest

from owi.accounts import (
    AccountError,
    Accounts,
    OwUser,
    accounts_path,
    hash_password,
    verify_password,
)
from tests.factories import utc

NOW = utc(2026, 10, 18, 9, 0)
PASSWORD = "correct horse battery"
IP = "203.0.113.7"


@pytest.fixture
def store(tmp_path):
    with Accounts(accounts_path(tmp_path)) as accounts:
        yield accounts


def register(store, email="mama@email.sk", ip=IP, now=NOW, first_name="Mama"):
    return store.register(email, first_name, None, PASSWORD, ip, now)


def admin(store, email="admin@email.sk"):
    return store.create(email, "Admin", None, PASSWORD, "admin", "active", NOW)


def test_accounts_path_is_inside_the_accounts_folder(tmp_path):
    assert accounts_path(tmp_path) == tmp_path / "accounts" / "accounts.db"


def test_register_normalizes_email_and_starts_pending(store):
    account = store.register("  Mama@Email.SK ", "Mama", None, PASSWORD, IP, NOW)

    assert account.email == "mama@email.sk"
    assert account.status == "pending"
    assert account.role == "user"
    assert account.training_consent is True
    assert account.settings == {
        "theme": "system",
        "sleep_score": "performance",
        "overview_mode": "auto",
    }
    assert account.ow_user_id is None
    assert account.session_version == 0
    assert store.get(account.id) == account


def test_register_rejects_mismatched_rules(store):
    with pytest.raises(AccountError) as short:
        store.register("a@email.sk", "Mama", None, "123456789", IP, NOW)
    assert short.value.code == "invalid"
    assert "password" in short.value.fields

    with pytest.raises(AccountError) as nameless:
        store.register("a@email.sk", "  ", None, PASSWORD, IP, NOW)
    assert nameless.value.code == "invalid"
    assert "first_name" in nameless.value.fields

    with pytest.raises(AccountError) as bad_mail:
        store.register("not-an-email", "Mama", None, PASSWORD, IP, NOW)
    assert "email" in bad_mail.value.fields


def test_duplicate_email_is_taken(store):
    register(store)

    with pytest.raises(AccountError) as taken:
        register(store, email=" MAMA@email.sk")

    assert taken.value.code == "email_taken"


def test_login_with_any_case_finds_the_account(store):
    account = register(store)

    found = store.login(" MAMA@Email.sk", PASSWORD, NOW)

    assert found.id == account.id
    assert found.last_login_at == NOW


def test_five_failed_logins_lock_the_email_for_15_minutes(store):
    register(store)
    for _ in range(5):
        with pytest.raises(AccountError) as wrong:
            store.login("mama@email.sk", "wrong password!", NOW)
        assert wrong.value.code == "invalid_credentials"

    with pytest.raises(AccountError) as locked:
        store.login("mama@email.sk", PASSWORD, NOW + timedelta(minutes=1))
    assert locked.value.code == "too_many_attempts"
    assert locked.value.retry_after_s is not None and locked.value.retry_after_s > 0

    later = NOW + timedelta(minutes=16)
    with pytest.raises(AccountError) as again:
        store.login("mama@email.sk", "wrong password!", later)
    assert again.value.code == "invalid_credentials"
    assert store.login("mama@email.sk", PASSWORD, later).email == "mama@email.sk"


def test_unknown_email_is_invalid_credentials_and_counts_too(store):
    with pytest.raises(AccountError) as unknown:
        store.login("nobody@email.sk", PASSWORD, NOW)
    assert unknown.value.code == "invalid_credentials"


def test_sixth_registration_from_one_ip_within_an_hour_is_refused(store):
    for number in range(5):
        register(store, email=f"user{number}@email.sk")

    with pytest.raises(AccountError) as refused:
        register(store, email="user5@email.sk", now=NOW + timedelta(minutes=30))
    assert refused.value.code == "too_many_attempts"

    other_ip = register(store, email="user5@email.sk", ip="203.0.113.8")
    assert other_ip.email == "user5@email.sk"
    assert register(store, email="user6@email.sk", now=NOW + timedelta(minutes=61))


def test_registration_can_be_closed(store):
    store.system_set("registration_open", "0")

    with pytest.raises(AccountError) as closed:
        register(store)
    assert closed.value.code == "registration_closed"
    assert store.create("a@email.sk", "A", None, PASSWORD, "admin", "active", NOW)


def test_password_hash_format_and_verification():
    stored = hash_password("correct horse battery")

    assert stored.startswith("scrypt$16384$8$1$")
    assert verify_password("correct horse battery", stored)
    assert not verify_password("another password", stored)
    assert not verify_password("correct horse battery", "garbage")
    assert hash_password("correct horse battery") != stored


def test_change_password_bumps_session_version(store):
    account = register(store)

    changed = store.change_password(account.id, PASSWORD, "a brand new password")

    assert changed.session_version == account.session_version + 1
    assert store.login("mama@email.sk", "a brand new password", NOW)
    with pytest.raises(AccountError) as wrong:
        store.change_password(account.id, "not the current", "another new password")
    assert wrong.value.code == "invalid_credentials"
    with pytest.raises(AccountError) as short:
        store.change_password(account.id, "a brand new password", "short")
    assert short.value.code == "invalid"


def test_bump_session_raises_the_version(store):
    account = register(store)

    assert store.bump_session(account.id).session_version == 1


def test_reset_token_is_single_use_and_expires_after_24_h(store):
    account = register(store)
    token, expires_at = store.create_reset_token(account.id, NOW)
    assert expires_at == NOW + timedelta(hours=24)

    reset = store.confirm_reset(token, "the new password", NOW + timedelta(hours=1))
    assert reset.session_version == 1
    assert store.login("mama@email.sk", "the new password", NOW)

    with pytest.raises(AccountError) as used:
        store.confirm_reset(token, "yet another password", NOW + timedelta(hours=2))
    assert used.value.code == "invalid_token"

    late, _ = store.create_reset_token(account.id, NOW)
    with pytest.raises(AccountError) as expired:
        store.confirm_reset(late, "yet another password", NOW + timedelta(hours=24, seconds=1))
    assert expired.value.code == "invalid_token"

    with pytest.raises(AccountError) as unknown:
        store.confirm_reset("nonsense", "yet another password", NOW)
    assert unknown.value.code == "invalid_token"


def test_reset_token_is_stored_only_as_a_hash(store, tmp_path):
    account = register(store)
    token, _ = store.create_reset_token(account.id, NOW)

    assert token.encode() not in accounts_path(tmp_path).read_bytes()


def test_request_reset_adds_an_inbox_item_only_for_a_known_account(store):
    account = register(store)

    store.request_reset("nobody@email.sk", NOW)
    assert store.inbox_list(False) == []

    store.request_reset(" Mama@email.sk", NOW)
    store.request_reset("mama@email.sk", NOW)
    items = store.inbox_list(False)
    assert [(i.kind, i.account_id) for i in items] == [("password_reset", account.id)]


def test_pair_refuses_an_ow_user_of_another_account(store):
    first = register(store)
    second = register(store, email="other@email.sk")

    paired = store.pair(first.id, "ow-1")
    assert paired.ow_user_id == "ow-1"
    assert paired.status == "active"
    assert paired.paired is True

    with pytest.raises(AccountError) as taken:
        store.pair(second.id, "ow-1")
    assert taken.value.code == "ow_user_taken"
    assert store.pair(first.id, "ow-1").ow_user_id == "ow-1"


def test_unpair_returns_the_account_to_pending(store):
    account = store.pair(register(store).id, "ow-1")

    unpaired = store.unpair(account.id)

    assert unpaired.ow_user_id is None
    assert unpaired.status == "pending"
    assert unpaired.paired is False


def test_paired_lists_active_accounts_with_an_ow_user(store):
    one = store.pair(register(store).id, "ow-1")
    two = register(store, email="two@email.sk")
    three = store.pair(register(store, email="three@email.sk").id, "ow-3")
    store.set_role_status(three.id, None, "suspended")

    assert [a.id for a in store.paired()] == [one.id]
    assert {a.id for a in store.all()} == {one.id, two.id, three.id}


def test_last_admin_cannot_demote_suspend_or_delete_self(store):
    only = admin(store)

    for role, status in (("user", None), (None, "suspended")):
        with pytest.raises(AccountError) as refused:
            store.set_role_status(only.id, role, status)
        assert refused.value.code == "last_admin"
    with pytest.raises(AccountError) as deleted:
        store.delete(only.id)
    assert deleted.value.code == "last_admin"

    second = admin(store, "second@email.sk")
    assert store.set_role_status(only.id, "user", None).role == "user"
    with pytest.raises(AccountError) as last:
        store.delete(second.id)
    assert last.value.code == "last_admin"


def test_delete_removes_the_account(store):
    admin(store)
    account = register(store)

    store.delete(account.id)

    assert store.get(account.id) is None
    with pytest.raises(AccountError) as gone:
        store.delete(account.id)
    assert gone.value.code == "not_found"


def test_update_changes_profile_and_merges_settings(store):
    account = register(store)

    updated = store.update(
        account.id,
        {
            "first_name": " Anna ",
            "last_name": "Nováková",
            "email": "ANNA@email.sk",
            "birth_date": "2008-03-04",
            "sex": "female",
            "training_consent": False,
            "settings": {"theme": "dark"},
        },
    )

    assert updated.first_name == "Anna"
    assert updated.last_name == "Nováková"
    assert updated.email == "anna@email.sk"
    assert updated.birth_date == "2008-03-04"
    assert updated.sex == "female"
    assert updated.training_consent is False
    assert updated.settings == {
        "theme": "dark",
        "sleep_score": "performance",
        "overview_mode": "auto",
    }


def test_update_rejects_bad_values_and_taken_email(store):
    account = register(store)
    register(store, email="other@email.sk")

    with pytest.raises(AccountError) as bad:
        store.update(account.id, {"sex": "robot", "settings": {"theme": "pink"}})
    assert bad.value.code == "invalid"
    assert {"sex", "settings"} <= set(bad.value.fields)

    with pytest.raises(AccountError) as taken:
        store.update(account.id, {"email": "other@email.sk"})
    assert taken.value.code == "email_taken"

    with pytest.raises(AccountError) as missing:
        store.update("nope", {"first_name": "X"})
    assert missing.value.code == "not_found"


def test_inbox_key_deduplicates_until_resolved(store):
    account = register(store)

    store.inbox_add("pairing", account.id, "Nový účet", "pairing:1", NOW)
    store.inbox_add("pairing", account.id, "Nový účet", "pairing:1", NOW)
    (item,) = store.inbox_list(False)
    assert item.key == "pairing:1"
    assert item.resolved_at is None

    store.inbox_resolve(item.id, NOW)
    assert store.inbox_list(False) == []
    assert [i.id for i in store.inbox_list(True)] == [item.id]
    assert store.inbox_list(True)[0].resolved_at == NOW

    store.inbox_add("pairing", account.id, "Nový účet", "pairing:1", NOW)
    assert len(store.inbox_list(False)) == 1
    assert len(store.inbox_list(True)) == 1


def test_inbox_resolve_unknown_item_is_not_found(store):
    with pytest.raises(AccountError) as missing:
        store.inbox_resolve(99, NOW)
    assert missing.value.code == "not_found"


def test_suspended_login_is_refused(store):
    admin(store)
    account = register(store)
    store.set_role_status(account.id, None, "suspended")

    with pytest.raises(AccountError) as suspended:
        store.login("mama@email.sk", PASSWORD, NOW)
    assert suspended.value.code == "suspended"
    with pytest.raises(AccountError) as wrong:
        store.login("mama@email.sk", "wrong password!", NOW)
    assert wrong.value.code == "invalid_credentials"


def test_system_values(store):
    assert store.system_get("registration_open") is None

    store.system_set("registration_open", "1")
    store.system_set("registration_open", "0")

    assert store.system_get("registration_open") == "0"


def test_ow_users_sources_and_last_data(store):
    store.ow_users_replace([OwUser("ow-1", "Jeden"), OwUser("ow-2", "Dva")])
    store.ow_users_replace([OwUser("ow-2", "Dva"), OwUser("ow-3", "Tri")])
    assert store.ow_users() == [OwUser("ow-2", "Dva"), OwUser("ow-3", "Tri")]

    assert store.sources("ow-2") is None
    store.sources_replace("ow-2", '{"connections": []}', NOW)
    store.sources_replace("ow-2", '{"connections": [1]}', NOW)
    assert store.sources("ow-2") == {"connections": [1]}

    assert store.last_data("ow-2") is None
    store.last_data_set("ow-2", NOW)
    assert store.last_data("ow-2") == NOW


def test_deletions_queue(store):
    store.deletions_add("ow-1", NOW)
    store.deletions_add("ow-1", NOW)
    store.deletions_add("ow-2", NOW)
    assert sorted(store.deletions_pending()) == ["ow-1", "ow-2"]

    store.deletions_done("ow-1")
    assert store.deletions_pending() == ["ow-2"]


def test_data_survives_reopening(tmp_path):
    path = accounts_path(tmp_path)
    with Accounts(path) as first:
        account = register(first)
    with Accounts(path) as second:
        assert second.get(account.id) == account
