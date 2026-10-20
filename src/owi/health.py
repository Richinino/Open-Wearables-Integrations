"""Small operational checks; no health measurements or credentials are exposed."""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

from owi.calibration import write_atomic

STATUS_FILE = "sync-status.json"


def read_status(data_dir: Path) -> dict:
    try:
        result = json.loads((data_dir / STATUS_FILE).read_text("utf-8-sig"))
        return result if isinstance(result, dict) else {}
    except (OSError, ValueError):
        return {}


def finish_sync(data_dir: Path, started: datetime, ok: bool, error: str | None) -> None:
    previous = read_status(data_dir)
    finished = datetime.now(UTC).isoformat()
    write_atomic(
        data_dir / STATUS_FILE,
        json.dumps(
            {
                "last_attempt_at": started.isoformat(),
                "finished_at": finished,
                "last_success_at": finished if ok else previous.get("last_success_at"),
                "ok": ok,
                "error": error,
            }
        ),
    )


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if mode == "api":
            with urllib.request.urlopen("http://127.0.0.1:8787/ready", timeout=5) as response:
                return 0 if response.status == 200 else 1
        if mode == "sync":
            state = read_status(Path(os.environ.get("OWI_DATA_DIR", "data")))
            last = datetime.fromisoformat(state["last_success_at"])
            age = datetime.now(UTC) - last
            return (
                0 if state.get("ok") is True and timedelta(0) <= age < timedelta(minutes=30) else 1
            )
    except (OSError, ValueError, TypeError, KeyError):
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
