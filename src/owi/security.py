"""Shared login quota for the web, without enabling multi-user accounts."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

LOGIN_LIMIT = 10
GLOBAL_LIMIT = 100
WINDOW = timedelta(minutes=15)


def reserve_login(path: Path, key: str, now: datetime) -> int:
    """Reserve an attempt atomically; return a wait in seconds, or zero when allowed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=2, isolation_level=None)
    try:
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("CREATE TABLE IF NOT EXISTS attempts (client TEXT NOT NULL, at TEXT NOT NULL)")
        db.execute("CREATE INDEX IF NOT EXISTS attempts_client ON attempts(client, at)")
        db.execute("BEGIN IMMEDIATE")
        since = (now - WINDOW).isoformat()
        db.execute("DELETE FROM attempts WHERE at <= ?", (since,))
        own = db.execute("SELECT at FROM attempts WHERE client = ? ORDER BY at", (key,)).fetchall()
        total = db.execute("SELECT at FROM attempts ORDER BY at").fetchall()
        blocked = own if len(own) >= LOGIN_LIMIT else total if len(total) >= GLOBAL_LIMIT else []
        if blocked:
            wait = max(
                1, int((datetime.fromisoformat(blocked[0][0]) + WINDOW - now).total_seconds()) + 1
            )
        else:
            db.execute("INSERT INTO attempts VALUES (?, ?)", (key, now.isoformat()))
            wait = 0
        db.execute("COMMIT")
        return wait
    finally:
        db.close()
