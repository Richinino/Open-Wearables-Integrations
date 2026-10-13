"""Settings from environment variables and an optional .env file."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_API_URL = "http://localhost:8000"
DEFAULT_TIMEZONE = "Europe/Bratislava"
DEFAULT_DATA_DIR = "data"


@dataclass(frozen=True)
class Settings:
    api_url: str = DEFAULT_API_URL
    api_key: str = ""
    user_id: str | None = None
    timezone: str = DEFAULT_TIMEZONE
    data_dir: Path = Path(DEFAULT_DATA_DIR)
    max_hr: float | None = None
    weight_kg: float | None = None
    vo2max: float | None = None
    basal_kcal: float | None = None

    @property
    def db_path(self) -> Path:
        return self.data_dir / "owi.db"

    @property
    def truth_path(self) -> Path:
        return self.data_dir / "truth.csv"

    @property
    def params_path(self) -> Path:
        return self.data_dir / "params.json"


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip("'\"")
    return values


def _float(values: Mapping[str, str], key: str) -> float | None:
    raw = values.get(key)
    return float(raw) if raw else None


def load_settings(
    env: Mapping[str, str] | None = None, env_file: Path | None = Path(".env")
) -> Settings:
    """Environment variables win over the .env file; empty values count as unset."""
    values: dict[str, str] = {}
    if env_file is not None and env_file.is_file():
        values.update(_read_env_file(env_file))
    values.update(os.environ if env is None else env)

    return Settings(
        api_url=values.get("OWI_API_URL") or DEFAULT_API_URL,
        api_key=values.get("OWI_API_KEY") or "",
        user_id=values.get("OWI_USER_ID") or None,
        timezone=values.get("OWI_TIMEZONE") or DEFAULT_TIMEZONE,
        data_dir=Path(values.get("OWI_DATA_DIR") or DEFAULT_DATA_DIR),
        max_hr=_float(values, "OWI_MAX_HR"),
        weight_kg=_float(values, "OWI_WEIGHT_KG"),
        vo2max=_float(values, "OWI_VO2MAX"),
        basal_kcal=_float(values, "OWI_BASAL_KCAL"),
    )
