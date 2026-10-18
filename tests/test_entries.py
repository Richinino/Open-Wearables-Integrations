import sqlite3
from datetime import date

import pytest

from owi import entries
from owi.entries import Entry
from tests.factories import utc

DAY = date(2026, 10, 12)
SAVED = utc(2026, 10, 16, 9, 30)
FULL = {
    "steps": 23588,
    "distance_km": 17.9,
    "active_minutes": 210,
    "active_kcal": 980,
    "total_kcal": 2610,
    "sleep_score": 82,
    "energy_score": 76,
}


@pytest.fixture
def path(tmp_path):
    return tmp_path / "zapisy" / "zapisy.db"


# validate


def test_a_full_body_is_valid_and_typed():
    values, problems = entries.validate(FULL)

    assert problems == {}
    assert values == {
        "steps": 23588,
        "distance_km": 17.9,
        "active_minutes": 210.0,
        "active_kcal": 980.0,
        "total_kcal": 2610.0,
        "sleep_score": 82.0,
        "energy_score": 76.0,
    }
    assert isinstance(values["steps"], int)


def test_missing_fields_are_null_and_unknown_ones_are_ignored():
    values, problems = entries.validate({"steps": 1000, "note": "x"})

    assert problems == {}
    assert values == {**dict.fromkeys(entries.FIELDS), "steps": 1000}


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("steps", -1, "0–100 000"),
        ("steps", 100_001, "0–100 000"),
        ("steps", 12.5, "celé číslo"),
        ("steps", "12", "celé číslo"),
        ("steps", True, "celé číslo"),
        ("distance_km", 150.1, "0–150"),
        ("active_minutes", 1441, "0–1 440"),
        ("active_kcal", 10_001, "0–10 000"),
        ("total_kcal", 499, "500–15 000"),
        ("total_kcal", 15_001, "500–15 000"),
        ("sleep_score", 101, "0–100"),
        ("energy_score", -0.5, "0–100"),
        ("sleep_score", "82", "číslo"),
        ("sleep_score", float("nan"), "číslo"),
        ("distance_km", float("inf"), "číslo"),
    ],
)
def test_values_out_of_range_or_of_the_wrong_type_are_named(field, value, message):
    values, problems = entries.validate({**FULL, field: value})

    assert problems == {field: message}


def test_whole_number_floats_count_as_steps():
    values, problems = entries.validate({"steps": 1200.0})

    assert problems == {}
    assert values["steps"] == 1200
    assert isinstance(values["steps"], int)


def test_a_body_that_is_not_an_object_is_invalid():
    _, problems = entries.validate([1, 2])

    assert problems == {"body": "objekt JSON"}


# save, load, delete


def test_missing_store_reads_as_empty_without_creating_it(path):
    assert entries.load(path) == []
    assert not path.parent.exists()


def test_saved_entry_reads_back_with_its_time(path):
    saved = entries.save(path, DAY, entries.validate(FULL)[0], SAVED)

    assert saved == Entry(
        day=DAY,
        steps=23588,
        distance_km=17.9,
        active_minutes=210.0,
        active_kcal=980.0,
        total_kcal=2610.0,
        sleep_score=82.0,
        energy_score=76.0,
        saved_at=SAVED,
    )
    assert entries.load(path) == [saved]


def test_saving_a_day_again_replaces_it(path):
    entries.save(path, DAY, {"steps": 1000}, SAVED)
    entries.save(path, DAY, {"sleep_score": 70.0}, utc(2026, 10, 16, 10))

    (entry,) = entries.load(path)
    assert (entry.steps, entry.sleep_score) == (None, 70.0)
    assert entry.saved_at == utc(2026, 10, 16, 10)


def test_load_limits_itself_to_a_range_oldest_first(path):
    for day in (14, 12, 13):
        entries.save(path, date(2026, 10, day), {"steps": day}, SAVED)

    assert [e.day.day for e in entries.load(path)] == [12, 13, 14]
    assert [e.day.day for e in entries.load(path, date(2026, 10, 13))] == [13, 14]
    assert [e.day.day for e in entries.load(path, last=date(2026, 10, 13))] == [12, 13]


def test_delete_removes_the_day(path):
    entries.save(path, DAY, {"steps": 1000}, SAVED)

    entries.delete(path, DAY)
    entries.delete(path, DAY)  # nothing left to delete is fine

    assert entries.load(path) == []


def test_the_store_uses_a_rollback_journal_not_wal(path):
    # Two containers share the file through a Windows folder, where WAL's shared memory breaks.
    entries.save(path, DAY, {"steps": 1000}, SAVED)

    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    db.close()


def test_a_locked_database_is_retried(path, monkeypatch):
    real = entries._connect
    calls = []

    def flaky(*args, **kwargs):
        calls.append(1)
        if len(calls) < 3:
            raise sqlite3.OperationalError("database is locked")
        return real(*args, **kwargs)

    monkeypatch.setattr(entries, "_connect", flaky)
    monkeypatch.setattr(entries, "RETRY_PAUSE_S", 0)

    entries.save(path, DAY, {"steps": 1000}, SAVED)

    assert len(calls) == 3
    assert entries.load(path)[0].steps == 1000


def test_other_database_errors_are_not_retried(path, monkeypatch):
    calls = []

    def broken(*args, **kwargs):
        calls.append(1)
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(entries, "_connect", broken)

    with pytest.raises(sqlite3.OperationalError):
        entries.save(path, DAY, {"steps": 1000}, SAVED)
    assert len(calls) == 1


def test_entry_as_json_has_every_field(path):
    saved = entries.save(path, DAY, {"steps": 1000}, SAVED)

    assert entries.as_json(saved) == {
        "day": "2026-10-12",
        "steps": 1000,
        "distance_km": None,
        "active_minutes": None,
        "active_kcal": None,
        "total_kcal": None,
        "sleep_score": None,
        "energy_score": None,
        "saved_at": "2026-10-16T09:30:00+00:00",
    }
    assert entries.as_json(Entry(DAY))["saved_at"] is None
