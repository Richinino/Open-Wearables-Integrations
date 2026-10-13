from pathlib import Path

from owi.config import load_settings


def test_defaults_without_env_or_file():
    settings = load_settings(env={}, env_file=None)

    assert settings.api_url == "http://localhost:8000"
    assert settings.api_key == ""
    assert settings.user_id is None
    assert settings.timezone == "Europe/Bratislava"
    assert settings.data_dir == Path("data")
    assert settings.db_path == Path("data") / "owi.db"
    assert settings.truth_path == Path("data") / "truth.csv"
    assert settings.params_path == Path("data") / "params.json"
    assert settings.max_hr is None


def test_environment_overrides_the_env_file(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("OWI_API_KEY=from-file\nOWI_TIMEZONE=UTC\n", encoding="utf-8")

    settings = load_settings(env={"OWI_API_KEY": "from-env"}, env_file=env_file)

    assert settings.api_key == "from-env"
    assert settings.timezone == "UTC"


def test_env_file_ignores_comments_blank_lines_and_quotes(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment\n\nOWI_API_URL='http://ow:8000'\nOWI_USER_ID=\"abc\"\nOWI_MAX_HR=\n",
        encoding="utf-8",
    )

    settings = load_settings(env={}, env_file=env_file)

    assert settings.api_url == "http://ow:8000"
    assert settings.user_id == "abc"
    assert settings.max_hr is None


def test_numeric_overrides_are_floats():
    settings = load_settings(
        env={
            "OWI_MAX_HR": "185",
            "OWI_WEIGHT_KG": "70.0",
            "OWI_VO2MAX": "48.0",
            "OWI_BASAL_KCAL": "1650",
            "OWI_DATA_DIR": "/data",
        },
        env_file=None,
    )

    assert settings.max_hr == 185.0
    assert settings.weight_kg == 70.0
    assert settings.vo2max == 48.0
    assert settings.basal_kcal == 1650.0
    assert settings.data_dir == Path("/data")
