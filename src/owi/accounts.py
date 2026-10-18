"""User accounts of the web: data/accounts/accounts.db.

Several containers share the file through a folder on Windows (owi serve writes it, owi sync
reads and fills the tables for sources and users), so the store follows entries.py: SQLite's
rollback journal, a connection per call, short transactions and a few retries while the other
side holds the lock.

Passwords are stored as scrypt hashes, reset links only as SHA-256 of the token. Nothing here
logs a password. Times are timezone-aware datetimes stored as ISO text.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
import time
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import TracebackType
from typing import Any

from owi.passwords import dummy_hash, hash_password, verify_password

ACCOUNTS_DIR = "accounts"
ACCOUNTS_FILE = "accounts.db"
CONNECT_TIMEOUT_S = 2.0
RETRIES = 5
RETRY_PAUSE_S = 0.2

PASSWORD_MIN = 10
PASSWORD_MAX = 256

LOGIN_FAILURES = 5
LOGIN_WINDOW = timedelta(minutes=15)
REGISTRATIONS_PER_IP = 5
REGISTRATION_WINDOW = timedelta(hours=1)
RESET_LIFETIME = timedelta(hours=24)
ATTEMPT_KEEP = timedelta(days=1)

ROLES = ("admin", "user")
STATUSES = ("pending", "active", "suspended")
SEXES = ("male", "female")
SETTING_VALUES = {
    "theme": ("system", "light", "dark"),
    "sleep_score": ("performance", "apple", "samsung"),
    "overview_mode": ("auto", "morning"),
}
DEFAULT_SETTINGS = {"theme": "system", "sleep_score": "performance", "overview_mode": "auto"}
INBOX_KINDS = ("pairing", "stale_data", "disconnected", "funnel", "ow_update", "password_reset")

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_NAME_MAX = 100
_EMAIL_MAX = 254

_SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    ow_user_id TEXT UNIQUE,
    birth_date TEXT,
    sex TEXT,
    training_consent INTEGER NOT NULL DEFAULT 1,
    settings TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    session_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_attempts (email TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_email ON login_attempts (email, at);
CREATE TABLE IF NOT EXISTS registration_attempts (ip TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS registration_attempts_ip ON registration_attempts (ip, at);
CREATE TABLE IF NOT EXISTS reset_tokens (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE TABLE IF NOT EXISTS inbox (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    account_id TEXT,
    message TEXT NOT NULL,
    key TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_open_key ON inbox (key)
    WHERE resolved_at IS NULL AND key IS NOT NULL;
CREATE TABLE IF NOT EXISTS system (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ow_users (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
    ow_user_id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS last_data (ow_user_id TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deletions (ow_user_id TEXT PRIMARY KEY, requested_at TEXT NOT NULL);
"""


class AccountError(Exception):
    """A refused account operation; `code` is one of the API error codes."""

    def __init__(
        self,
        code: str,
        fields: dict[str, str] | None = None,
        retry_after_s: int | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.fields = fields
        self.retry_after_s = retry_after_s


@dataclass(frozen=True)
class Account:
    id: str
    email: str
    first_name: str
    last_name: str | None
    role: str
    status: str
    ow_user_id: str | None
    birth_date: str | None
    sex: str | None
    training_consent: bool
    settings: dict[str, str]
    created_at: datetime
    last_login_at: datetime | None
    session_version: int
    password_hash: str = field(repr=False)

    @property
    def paired(self) -> bool:
        return self.ow_user_id is not None


@dataclass(frozen=True)
class InboxItem:
    id: int
    kind: str
    account_id: str | None
    message: str
    key: str | None
    created_at: datetime
    resolved_at: datetime | None


@dataclass(frozen=True)
class OwUser:
    id: str
    label: str


def accounts_path(data_dir: Path) -> Path:
    return data_dir / ACCOUNTS_DIR / ACCOUNTS_FILE


# validation


def _normalize_email(raw: Any) -> str:
    return raw.strip().lower() if isinstance(raw, str) else ""


def _check_email(raw: Any) -> tuple[str, str | None]:
    email = _normalize_email(raw)
    if len(email) > _EMAIL_MAX or not _EMAIL.match(email):
        return email, "neplatný e-mail"
    return email, None


def _check_first_name(raw: Any) -> tuple[str, str | None]:
    name = raw.strip() if isinstance(raw, str) else ""
    if not name or len(name) > _NAME_MAX:
        return name, "povinné, najviac 100 znakov"
    return name, None


def _check_last_name(raw: Any) -> tuple[str | None, str | None]:
    if raw is None:
        return None, None
    if not isinstance(raw, str) or len(raw.strip()) > _NAME_MAX:
        return None, "najviac 100 znakov"
    return raw.strip() or None, None


def _check_password(raw: Any) -> str | None:
    if not isinstance(raw, str) or not PASSWORD_MIN <= len(raw) <= PASSWORD_MAX:
        return f"{PASSWORD_MIN}–{PASSWORD_MAX} znakov"
    return None


def _check_birth_date(raw: Any) -> tuple[str | None, str | None]:
    if raw is None:
        return None, None
    try:
        if not isinstance(raw, str) or len(raw) != 10:
            raise ValueError
        parsed = date.fromisoformat(raw)
    except ValueError:
        return None, "dátum RRRR-MM-DD"
    if parsed.year < 1900:
        return None, "dátum RRRR-MM-DD"
    return parsed.isoformat(), None


def _check_settings(raw: Any, current: Mapping[str, str]) -> tuple[dict[str, str], str | None]:
    if not isinstance(raw, Mapping):
        return dict(current), "objekt"
    merged = dict(current)
    for name, value in raw.items():
        if name not in SETTING_VALUES or value not in SETTING_VALUES[name]:
            return dict(current), f"neplatné nastavenie {name}"
        merged[name] = value
    return merged, None


# time


def _text(moment: datetime | None) -> str | None:
    return None if moment is None else moment.astimezone(UTC).isoformat()


def _moment(text: str | None) -> datetime | None:
    return None if text is None else datetime.fromisoformat(text)


# database plumbing


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=CONNECT_TIMEOUT_S, isolation_level=None)
    db.execute("PRAGMA journal_mode=DELETE")
    db.executescript(_SCHEMA)
    db.row_factory = sqlite3.Row
    return db


def _locked(error: sqlite3.OperationalError) -> bool:
    message = str(error).lower()
    return "locked" in message or "busy" in message


def _read[T](path: Path, work: Callable[[sqlite3.Connection], T]) -> T:
    """A read-only call: a deferred transaction that never asks for the write lock.

    A writer in another container does not block it (rollback journal readers only wait while
    a commit is in progress), so checking an account on every request stays cheap.
    """
    for attempt in range(RETRIES):
        try:
            db = _connect(path)
            try:
                db.execute("BEGIN")
                try:
                    return work(db)
                finally:
                    db.execute("ROLLBACK")
            finally:
                db.close()
        except sqlite3.OperationalError as error:
            if not _locked(error) or attempt == RETRIES - 1:
                raise
            time.sleep(RETRY_PAUSE_S)
    raise AssertionError("unreachable")


def _run[T](path: Path, work: Callable[[sqlite3.Connection], T | AccountError]) -> T:
    """One short write transaction, retried a few times while the database is locked.

    Slow work (password hashing) belongs before the call, not inside `work`.
    `work` may return an AccountError instead of raising it: the transaction is then committed
    first (a failed login must still be counted) and the error raised afterwards.
    """
    for attempt in range(RETRIES):
        try:
            db = _connect(path)
            try:
                db.execute("BEGIN IMMEDIATE")
                try:
                    result = work(db)
                except BaseException:
                    db.execute("ROLLBACK")
                    raise
                db.execute("COMMIT")
            finally:
                db.close()
        except sqlite3.OperationalError as error:
            if not _locked(error) or attempt == RETRIES - 1:
                raise
            time.sleep(RETRY_PAUSE_S)
        else:
            if isinstance(result, AccountError):
                raise result
            return result
    raise AssertionError("unreachable")


def _account(row: sqlite3.Row) -> Account:
    return Account(
        id=row["id"],
        email=row["email"],
        first_name=row["first_name"],
        last_name=row["last_name"],
        role=row["role"],
        status=row["status"],
        ow_user_id=row["ow_user_id"],
        birth_date=row["birth_date"],
        sex=row["sex"],
        training_consent=bool(row["training_consent"]),
        settings=json.loads(row["settings"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        last_login_at=_moment(row["last_login_at"]),
        session_version=row["session_version"],
        password_hash=row["password_hash"],
    )


def _item(row: sqlite3.Row) -> InboxItem:
    return InboxItem(
        id=row["id"],
        kind=row["kind"],
        account_id=row["account_id"],
        message=row["message"],
        key=row["key"],
        created_at=datetime.fromisoformat(row["created_at"]),
        resolved_at=_moment(row["resolved_at"]),
    )


def _load(db: sqlite3.Connection, account_id: str) -> Account:
    row = db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    if row is None:
        raise AccountError("not_found")
    return _account(row)


def _load_by_email(db: sqlite3.Connection, email: str) -> Account | None:
    row = db.execute("SELECT * FROM accounts WHERE email = ?", (email,)).fetchone()
    return None if row is None else _account(row)


def _other_active_admins(db: sqlite3.Connection, account_id: str) -> int:
    row = db.execute(
        "SELECT COUNT(*) FROM accounts WHERE role = 'admin' AND status = 'active' AND id != ?",
        (account_id,),
    ).fetchone()
    return row[0]


def _guard_last_admin(db: sqlite3.Connection, current: Account, role: str, status: str) -> None:
    """Refuse a change that would leave no active admin."""
    was_admin = current.role == "admin" and current.status == "active"
    stays_admin = role == "admin" and status == "active"
    if was_admin and not stays_admin and _other_active_admins(db, current.id) == 0:
        raise AccountError("last_admin")


def _insert(
    db: sqlite3.Connection,
    email: str,
    first_name: str,
    last_name: str | None,
    password_hash: str,
    role: str,
    status: str,
    now: datetime,
) -> Account:
    account = Account(
        id=uuid.uuid4().hex,
        email=email,
        first_name=first_name,
        last_name=last_name,
        role=role,
        status=status,
        ow_user_id=None,
        birth_date=None,
        sex=None,
        training_consent=True,
        settings=dict(DEFAULT_SETTINGS),
        created_at=now,
        last_login_at=None,
        session_version=0,
        password_hash=password_hash,
    )
    try:
        db.execute(
            "INSERT INTO accounts (id, email, first_name, last_name, password_hash, role, status,"
            " training_consent, settings, created_at, session_version)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)",
            (
                account.id,
                email,
                first_name,
                last_name,
                account.password_hash,
                role,
                status,
                json.dumps(account.settings),
                _text(now),
            ),
        )
    except sqlite3.IntegrityError as error:
        raise AccountError("email_taken") from error
    return replace(account, created_at=datetime.fromisoformat(_text(now) or ""))


def _validated_new(
    email: Any, first_name: Any, last_name: Any, password: Any
) -> tuple[str, str, str | None]:
    email_value, email_problem = _check_email(email)
    first, first_problem = _check_first_name(first_name)
    last, last_problem = _check_last_name(last_name)
    problems = {
        name: problem
        for name, problem in (
            ("email", email_problem),
            ("first_name", first_problem),
            ("last_name", last_problem),
            ("password", _check_password(password)),
        )
        if problem
    }
    if problems:
        raise AccountError("invalid", fields=problems)
    return email_value, first, last


def _lockout(db: sqlite3.Connection, email: str, now: datetime) -> AccountError | None:
    """too_many_attempts while the email has 5 failed password checks in the last 15 minutes."""
    db.execute("DELETE FROM login_attempts WHERE at <= ?", (_text(now - ATTEMPT_KEEP),))
    failures = db.execute(
        "SELECT at FROM login_attempts WHERE email = ? AND at > ? ORDER BY at",
        (email, _text(now - LOGIN_WINDOW)),
    ).fetchall()
    if len(failures) < LOGIN_FAILURES:
        return None
    oldest = datetime.fromisoformat(failures[0]["at"])
    wait = int((oldest + LOGIN_WINDOW - now).total_seconds()) + 1
    return AccountError("too_many_attempts", retry_after_s=max(wait, 1))


def _fail_attempt(db: sqlite3.Connection, email: str, now: datetime) -> AccountError:
    db.execute("INSERT INTO login_attempts (email, at) VALUES (?, ?)", (email, _text(now)))
    return AccountError("invalid_credentials")


def _registration_refusal(db: sqlite3.Connection, ip: str, now: datetime) -> AccountError | None:
    row = db.execute("SELECT value FROM system WHERE key = 'registration_open'").fetchone()
    if row is not None and row["value"] in ("0", "false"):
        return AccountError("registration_closed")
    recent = db.execute(
        "SELECT at FROM registration_attempts WHERE ip = ? AND at > ? ORDER BY at",
        (ip, _text(now - REGISTRATION_WINDOW)),
    ).fetchall()
    if len(recent) >= REGISTRATIONS_PER_IP:
        oldest = datetime.fromisoformat(recent[0]["at"])
        wait = int((oldest + REGISTRATION_WINDOW - now).total_seconds()) + 1
        return AccountError("too_many_attempts", retry_after_s=max(wait, 1))
    return None


class Accounts:
    """The accounts store. Use as a context manager; every call is its own transaction."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def __enter__(self) -> Accounts:
        _read(self.path, lambda db: None)
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None

    # creating accounts

    def register(
        self,
        email: str,
        first_name: str,
        last_name: str | None,
        password: str,
        ip: str,
        now: datetime,
    ) -> Account:
        """A new pending user; 5 per hour per IP at most, refused while signup is closed."""
        mail, first, last = _validated_new(email, first_name, last_name, password)
        # Cheap refusals first so a blocked client cannot make us hash; the transaction below
        # checks again, because another request may have used the last slot meanwhile.
        refusal = _read(self.path, lambda db: _registration_refusal(db, ip, now))
        if refusal is not None:
            raise refusal
        password_hash = hash_password(password)

        def work(db: sqlite3.Connection) -> Account | AccountError:
            refused = _registration_refusal(db, ip, now)
            if refused is not None:
                return refused
            db.execute(
                "DELETE FROM registration_attempts WHERE at <= ?", (_text(now - ATTEMPT_KEEP),)
            )
            db.execute("INSERT INTO registration_attempts (ip, at) VALUES (?, ?)", (ip, _text(now)))
            try:
                return _insert(db, mail, first, last, password_hash, "user", "pending", now)
            except AccountError as error:
                return error

        return _run(self.path, work)

    def create(
        self,
        email: str,
        first_name: str,
        last_name: str | None,
        password: str,
        role: str,
        status: str,
        now: datetime,
    ) -> Account:
        """Like register, for the command line: no rate limit, ignores whether signup is open."""
        mail, first, last = _validated_new(email, first_name, last_name, password)
        problems = {}
        if role not in ROLES:
            problems["role"] = "admin alebo user"
        if status not in STATUSES:
            problems["status"] = "pending, active alebo suspended"
        if problems:
            raise AccountError("invalid", fields=problems)
        password_hash = hash_password(password)
        return _run(
            self.path, lambda db: _insert(db, mail, first, last, password_hash, role, status, now)
        )

    # signing in

    def login(self, email: str, password: str, now: datetime) -> Account:
        mail = _normalize_email(email)
        # The slow hash runs outside the transaction so the database is not locked meanwhile.
        row = self._find_by_email(mail)
        stored = row.password_hash if row is not None else dummy_hash()
        right = verify_password(password if isinstance(password, str) else "", stored)

        def work(db: sqlite3.Connection) -> Account | AccountError:
            locked = _lockout(db, mail, now)
            if locked is not None:
                return locked
            current = _load_by_email(db, mail)
            if not right or current is None or current.password_hash != stored:
                return _fail_attempt(db, mail, now)
            if current.status == "suspended":
                return AccountError("suspended")
            db.execute("DELETE FROM login_attempts WHERE email = ?", (mail,))
            db.execute(
                "UPDATE accounts SET last_login_at = ? WHERE id = ?", (_text(now), current.id)
            )
            return _load(db, current.id)

        return _run(self.path, work)

    def check_password(self, account_id: str, password: str, now: datetime) -> None:
        """Raise invalid_credentials unless `password` is the account's current one.

        A wrong password counts toward the same lockout as login (5 per 15 minutes per email).
        """
        account = self._require(account_id)
        right = verify_password(
            password if isinstance(password, str) else "", account.password_hash
        )
        failure = _run(
            self.path, lambda db: self._settle_check(db, account.id, right, account, now)
        )
        if failure is not None:
            raise failure

    @staticmethod
    def _settle_check(
        db: sqlite3.Connection, account_id: str, right: bool, verified: Account, now: datetime
    ) -> AccountError | None:
        """Inside the transaction: lockout, then count a failure or clear the counter."""
        current = _load(db, account_id)
        locked = _lockout(db, current.email, now)
        if locked is not None:
            return locked
        if not right or current.password_hash != verified.password_hash:
            return _fail_attempt(db, current.email, now)
        db.execute("DELETE FROM login_attempts WHERE email = ?", (current.email,))
        return None

    def _require(self, account_id: str) -> Account:
        account = self.get(account_id)
        if account is None:
            raise AccountError("not_found")
        return account

    def _find_by_email(self, email: str) -> Account | None:
        return _read(self.path, lambda db: _load_by_email(db, email))

    # reading

    def get(self, account_id: str) -> Account | None:
        def work(db: sqlite3.Connection) -> Account | None:
            row = db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
            return None if row is None else _account(row)

        return _read(self.path, work)

    def all(self) -> list[Account]:
        """Every account, waiting ones first, then oldest first."""

        def work(db: sqlite3.Connection) -> list[Account]:
            rows = db.execute(
                "SELECT * FROM accounts ORDER BY status = 'pending' DESC, created_at, id"
            )
            return [_account(row) for row in rows]

        return _read(self.path, work)

    def paired(self) -> list[Account]:
        """Active accounts with an Open Wearables user: the ones the sync works for."""

        def work(db: sqlite3.Connection) -> list[Account]:
            rows = db.execute(
                "SELECT * FROM accounts WHERE ow_user_id IS NOT NULL AND status = 'active'"
                " ORDER BY created_at, id"
            )
            return [_account(row) for row in rows]

        return _read(self.path, work)

    # changing an account

    def update(self, account_id: str, changes: Mapping[str, Any]) -> Account:
        def work(db: sqlite3.Connection) -> Account | AccountError:
            current = _load(db, account_id)
            values: dict[str, Any] = {}
            problems: dict[str, str] = {}
            for name, raw in changes.items():
                problem: str | None = None
                match name:
                    case "first_name":
                        values[name], problem = _check_first_name(raw)
                    case "last_name":
                        values[name], problem = _check_last_name(raw)
                    case "email":
                        values[name], problem = _check_email(raw)
                    case "birth_date":
                        values[name], problem = _check_birth_date(raw)
                    case "sex":
                        values[name] = raw
                        problem = None if raw is None or raw in SEXES else "male alebo female"
                    case "training_consent":
                        values[name] = 1 if raw else 0
                        problem = None if isinstance(raw, bool) else "áno alebo nie"
                    case "settings":
                        merged, problem = _check_settings(raw, current.settings)
                        values[name] = json.dumps(merged)
                    case _:
                        problem = "neznáme pole"
                if problem:
                    problems[name] = problem
            if problems:
                return AccountError("invalid", fields=problems)
            if values:
                assignments = ", ".join(f"{name} = ?" for name in values)
                try:
                    db.execute(
                        f"UPDATE accounts SET {assignments} WHERE id = ?",
                        (*values.values(), account_id),
                    )
                except sqlite3.IntegrityError:
                    return AccountError("email_taken")
            return _load(db, account_id)

        return _run(self.path, work)

    def change_password(self, account_id: str, current: str, new: str) -> Account:
        """Set a new password; a wrong current one counts as a failed login."""
        now = datetime.now(UTC)
        account = self._require(account_id)
        right = verify_password(current if isinstance(current, str) else "", account.password_hash)
        problem = _check_password(new)
        new_hash = hash_password(new) if right and problem is None else ""

        def work(db: sqlite3.Connection) -> Account | AccountError:
            failure = self._settle_check(db, account_id, right, account, now)
            if failure is not None:
                return failure
            if problem:
                return AccountError("invalid", fields={"password": problem})
            db.execute(
                "UPDATE accounts SET password_hash = ?, session_version = session_version + 1"
                " WHERE id = ?",
                (new_hash, account_id),
            )
            return _load(db, account_id)

        return _run(self.path, work)

    def bump_session(self, account_id: str) -> Account:
        def work(db: sqlite3.Connection) -> Account:
            _load(db, account_id)
            db.execute(
                "UPDATE accounts SET session_version = session_version + 1 WHERE id = ?",
                (account_id,),
            )
            return _load(db, account_id)

        return _run(self.path, work)

    def delete(self, account_id: str, now: datetime | None = None) -> Account:
        """Remove the account and its reset links and return what was removed.

        With `now`, the folder of a paired account's user is queued for deletion (deletions)
        in the same transaction, so a removed account never leaves its folder unqueued.
        """

        def work(db: sqlite3.Connection) -> Account:
            account = _load(db, account_id)
            _guard_last_admin(db, account, "user", "deleted")
            db.execute("DELETE FROM reset_tokens WHERE account_id = ?", (account_id,))
            db.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
            if now is not None and account.ow_user_id is not None:
                db.execute(
                    "INSERT OR IGNORE INTO deletions (ow_user_id, requested_at) VALUES (?, ?)",
                    (account.ow_user_id, _text(now)),
                )
            return account

        return _run(self.path, work)

    def pair(self, account_id: str, ow_user_id: str) -> Account:
        def work(db: sqlite3.Connection) -> Account | AccountError:
            _load(db, account_id)
            other = db.execute(
                "SELECT id FROM accounts WHERE ow_user_id = ? AND id != ?", (ow_user_id, account_id)
            ).fetchone()
            if other is not None:
                return AccountError("ow_user_taken")
            db.execute(
                "UPDATE accounts SET ow_user_id = ?, status = 'active' WHERE id = ?",
                (ow_user_id, account_id),
            )
            return _load(db, account_id)

        return _run(self.path, work)

    def unpair(self, account_id: str) -> Account:
        def work(db: sqlite3.Connection) -> Account:
            account = _load(db, account_id)
            _guard_last_admin(db, account, account.role, "pending")
            db.execute(
                "UPDATE accounts SET ow_user_id = NULL, status = 'pending' WHERE id = ?",
                (account_id,),
            )
            return _load(db, account_id)

        return _run(self.path, work)

    def set_role_status(self, account_id: str, role: str | None, status: str | None) -> Account:
        """Change the role and/or status (None keeps it); the last active admin is protected."""
        problems = {}
        if role is not None and role not in ROLES:
            problems["role"] = "admin alebo user"
        if status is not None and status not in STATUSES:
            problems["status"] = "pending, active alebo suspended"
        if problems:
            raise AccountError("invalid", fields=problems)

        def work(db: sqlite3.Connection) -> Account:
            account = _load(db, account_id)
            new_role = role or account.role
            new_status = status or account.status
            _guard_last_admin(db, account, new_role, new_status)
            db.execute(
                "UPDATE accounts SET role = ?, status = ? WHERE id = ?",
                (new_role, new_status, account_id),
            )
            return _load(db, account_id)

        return _run(self.path, work)

    # password reset

    def create_reset_token(self, account_id: str, now: datetime) -> tuple[str, datetime]:
        """A single-use token valid for 24 hours; only its SHA-256 is stored."""
        token = secrets.token_urlsafe(32)
        expires = now + RESET_LIFETIME

        def work(db: sqlite3.Connection) -> None:
            _load(db, account_id)
            db.execute(
                "INSERT INTO reset_tokens (token_hash, account_id, created_at, expires_at)"
                " VALUES (?, ?, ?, ?)",
                (_token_hash(token), account_id, _text(now), _text(expires)),
            )

        _run(self.path, work)
        return token, expires

    def confirm_reset(self, token: str, new_password: str, now: datetime) -> Account:
        token_hash = _token_hash(token if isinstance(token, str) else "")
        # Look at the token first so an invalid one never costs a hash; checked again below.
        if not _read(self.path, lambda db: _usable_token(db, token_hash, now)):
            raise AccountError("invalid_token")
        problem = _check_password(new_password)
        if problem:
            raise AccountError("invalid", fields={"password": problem})
        new_hash = hash_password(new_password)

        def work(db: sqlite3.Connection) -> Account | AccountError:
            row = _usable_token(db, token_hash, now)
            if row is None:
                return AccountError("invalid_token")
            db.execute(
                "UPDATE accounts SET password_hash = ?, session_version = session_version + 1"
                " WHERE id = ?",
                (new_hash, row["account_id"]),
            )
            db.execute(
                "UPDATE reset_tokens SET used_at = ? WHERE token_hash = ?",
                (_text(now), token_hash),
            )
            db.execute(
                "DELETE FROM login_attempts WHERE email = (SELECT email FROM accounts"
                " WHERE id = ?)",
                (row["account_id"],),
            )
            return _load(db, row["account_id"])

        return _run(self.path, work)

    def request_reset(self, email: str, now: datetime) -> None:
        """Tell the admins that someone asked for a new password; silent for unknown emails."""

        def work(db: sqlite3.Connection) -> None:
            account = _load_by_email(db, _normalize_email(email))
            if account is None:
                return
            _inbox_add(
                db,
                "password_reset",
                account.id,
                f"{account.first_name} ({account.email}) žiada nové heslo.",
                f"password_reset:{account.id}",
                now,
            )

        _run(self.path, work)

    # inbox

    def inbox_add(
        self, kind: str, account_id: str | None, message: str, key: str | None, now: datetime
    ) -> None:
        """Add a note for the admins; an unresolved note with the same key is not added twice."""
        _run(self.path, lambda db: _inbox_add(db, kind, account_id, message, key, now))

    def inbox_list(self, resolved: bool) -> list[InboxItem]:
        def work(db: sqlite3.Connection) -> list[InboxItem]:
            clause = "NOT NULL" if resolved else "NULL"
            rows = db.execute(
                f"SELECT * FROM inbox WHERE resolved_at IS {clause}"
                " ORDER BY created_at DESC, id DESC"
            )
            return [_item(row) for row in rows]

        return _read(self.path, work)

    def inbox_resolve(self, item_id: int, now: datetime) -> InboxItem:
        def work(db: sqlite3.Connection) -> InboxItem:
            row = db.execute("SELECT * FROM inbox WHERE id = ?", (item_id,)).fetchone()
            if row is None:
                raise AccountError("not_found")
            if row["resolved_at"] is None:
                db.execute("UPDATE inbox SET resolved_at = ? WHERE id = ?", (_text(now), item_id))
            return _item(db.execute("SELECT * FROM inbox WHERE id = ?", (item_id,)).fetchone())

        return _run(self.path, work)

    # system values

    def system_get(self, key: str) -> str | None:
        def work(db: sqlite3.Connection) -> str | None:
            row = db.execute("SELECT value FROM system WHERE key = ?", (key,)).fetchone()
            return None if row is None else row["value"]

        return _read(self.path, work)

    def system_set(self, key: str, value: str) -> None:
        _run(
            self.path,
            lambda db: db.execute(
                "INSERT INTO system (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            ),
        )

    # what the sync learns about Open Wearables users

    def ow_users_replace(self, users: list[OwUser]) -> None:
        stamp = _text(datetime.now(UTC))

        def work(db: sqlite3.Connection) -> None:
            db.execute("DELETE FROM ow_users")
            db.executemany(
                "INSERT INTO ow_users (id, label, updated_at) VALUES (?, ?, ?)",
                [(user.id, user.label, stamp) for user in users],
            )

        _run(self.path, work)

    def ow_users(self) -> list[OwUser]:
        def work(db: sqlite3.Connection) -> list[OwUser]:
            rows = db.execute("SELECT id, label FROM ow_users ORDER BY label, id")
            return [OwUser(row["id"], row["label"]) for row in rows]

        return _read(self.path, work)

    def sources_replace(self, ow_user_id: str, sources_json: str, now: datetime) -> None:
        _run(
            self.path,
            lambda db: db.execute(
                "INSERT OR REPLACE INTO sources (ow_user_id, json, updated_at) VALUES (?, ?, ?)",
                (ow_user_id, sources_json, _text(now)),
            ),
        )

    def sources(self, ow_user_id: str) -> dict[str, Any] | None:
        def work(db: sqlite3.Connection) -> dict[str, Any] | None:
            row = db.execute(
                "SELECT json FROM sources WHERE ow_user_id = ?", (ow_user_id,)
            ).fetchone()
            return None if row is None else json.loads(row["json"])

        return _read(self.path, work)

    def last_data_set(self, ow_user_id: str, at: datetime) -> None:
        _run(
            self.path,
            lambda db: db.execute(
                "INSERT OR REPLACE INTO last_data (ow_user_id, at) VALUES (?, ?)",
                (ow_user_id, _text(at)),
            ),
        )

    def last_data(self, ow_user_id: str) -> datetime | None:
        def work(db: sqlite3.Connection) -> datetime | None:
            row = db.execute(
                "SELECT at FROM last_data WHERE ow_user_id = ?", (ow_user_id,)
            ).fetchone()
            return None if row is None else datetime.fromisoformat(row["at"])

        return _read(self.path, work)

    # folders of removed users waiting for owi to delete them (api cannot write data/)

    def deletions_add(self, ow_user_id: str, now: datetime) -> None:
        _run(
            self.path,
            lambda db: db.execute(
                "INSERT OR IGNORE INTO deletions (ow_user_id, requested_at) VALUES (?, ?)",
                (ow_user_id, _text(now)),
            ),
        )

    def deletions_pending(self) -> list[str]:
        def work(db: sqlite3.Connection) -> list[str]:
            rows = db.execute("SELECT ow_user_id FROM deletions ORDER BY requested_at, ow_user_id")
            return [row["ow_user_id"] for row in rows]

        return _read(self.path, work)

    def deletions_done(self, ow_user_id: str) -> None:
        _run(
            self.path,
            lambda db: db.execute("DELETE FROM deletions WHERE ow_user_id = ?", (ow_user_id,)),
        )


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _inbox_add(
    db: sqlite3.Connection,
    kind: str,
    account_id: str | None,
    message: str,
    key: str | None,
    now: datetime,
) -> None:
    db.execute(
        "INSERT OR IGNORE INTO inbox (kind, account_id, message, key, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (kind, account_id, message, key, _text(now)),
    )


def _usable_token(db: sqlite3.Connection, token_hash: str, now: datetime) -> sqlite3.Row | None:
    """The reset token's row when it is unused, unexpired and its account still exists."""
    row = db.execute(
        "SELECT t.* FROM reset_tokens t JOIN accounts a ON a.id = t.account_id"
        " WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at >= ?",
        (token_hash, _text(now)),
    ).fetchone()
    return row
