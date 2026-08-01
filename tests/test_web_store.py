"""SQLite persistence for analysis runs."""

import json
import sqlite3

import pytest

from web.store import AnalysisStore


@pytest.fixture
def store(tmp_path):
    s = AnalysisStore(tmp_path / "analysis.db")
    s.init()
    return s


@pytest.mark.unit
def test_init_creates_the_table_and_parent_directory(tmp_path):
    s = AnalysisStore(tmp_path / "nested" / "dir" / "analysis.db")
    s.init()

    assert s.db_path.exists()
    conn = sqlite3.connect(str(s.db_path))
    try:
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()
    assert "analyses" in names


@pytest.mark.unit
def test_init_is_idempotent(store):
    store.create("j1", "600519.SH", "2026-07-31")
    store.init()
    assert store.get("j1") is not None


@pytest.mark.unit
def test_create_records_a_running_analysis(store):
    store.create("j1", "600519.SH", "2026-07-31")

    record = store.get("j1")
    assert record["ticker"] == "600519.SH"
    assert record["trade_date"] == "2026-07-31"
    assert record["status"] == "running"
    assert record["created_at"]
    assert record["finished_at"] is None
    assert record["result"] is None


@pytest.mark.unit
def test_mark_completed_stores_result_and_decision(store):
    store.create("j1", "600519.SH", "2026-07-31")
    store.mark_completed("j1", {"final_decision": "增持", "signal": "Overweight"}, "Overweight")

    record = store.get("j1")
    assert record["status"] == "completed"
    assert record["decision"] == "Overweight"
    assert record["result"]["signal"] == "Overweight"
    assert record["finished_at"]
    # The raw column is unpacked, never leaked to the API layer.
    assert "result_json" not in record


@pytest.mark.unit
def test_result_json_keeps_chinese_readable(store):
    store.create("j1", "600519.SH", "2026-07-31")
    store.mark_completed("j1", {"final_decision": "增持"}, "Overweight")

    conn = sqlite3.connect(str(store.db_path))
    try:
        raw = conn.execute("SELECT result_json FROM analyses WHERE id='j1'").fetchone()[0]
    finally:
        conn.close()
    # ensure_ascii=False, so the column holds readable text rather than \uXXXX
    # escapes — worth pinning because the DB is browsed by hand during triage.
    assert "增持" in raw
    assert json.loads(raw)["final_decision"] == "增持"


@pytest.mark.unit
def test_mark_failed_records_the_error(store):
    store.create("j1", "600519.SH", "2026-07-31")
    store.mark_failed("j1", "Wind connection refused")

    record = store.get("j1")
    assert record["status"] == "failed"
    assert record["result"]["error"] == "Wind connection refused"
    assert record["finished_at"]


@pytest.mark.unit
def test_get_returns_none_for_an_unknown_job(store):
    assert store.get("nope") is None


@pytest.mark.unit
def test_corrupt_result_json_degrades_to_none(store):
    """A truncated write should not 500 the history endpoint."""
    store.create("j1", "600519.SH", "2026-07-31")
    conn = sqlite3.connect(str(store.db_path))
    try:
        conn.execute("UPDATE analyses SET result_json='{not json' WHERE id='j1'")
        conn.commit()
    finally:
        conn.close()

    assert store.get("j1")["result"] is None


@pytest.mark.unit
def test_list_recent_is_newest_first(store):
    for i in range(3):
        store.create(f"j{i}", f"60000{i}.SH", "2026-07-31")

    # created_at has second resolution, so same-second inserts tie; the rowid
    # tiebreaker is what keeps the order deterministic.
    assert [r["id"] for r in store.list_recent()] == ["j2", "j1", "j0"]


@pytest.mark.unit
def test_list_recent_honours_the_limit(store):
    for i in range(5):
        store.create(f"j{i}", "600519.SH", "2026-07-31")

    rows = store.list_recent(limit=2)
    assert [r["id"] for r in rows] == ["j4", "j3"]


@pytest.mark.unit
def test_list_recent_omits_the_bulky_result_payload(store):
    store.create("j1", "600519.SH", "2026-07-31")
    store.mark_completed("j1", {"market_report": "x" * 10_000}, "Hold")

    row = store.list_recent()[0]
    assert set(row) == {"id", "ticker", "trade_date", "status", "decision",
                        "created_at", "finished_at"}


@pytest.mark.unit
def test_list_recent_on_an_empty_database(store):
    assert store.list_recent() == []


@pytest.mark.unit
def test_two_stores_share_one_database_file(tmp_path):
    """The worker thread and the event loop each open their own connection."""
    writer = AnalysisStore(tmp_path / "analysis.db")
    writer.init()
    writer.create("j1", "600519.SH", "2026-07-31")

    reader = AnalysisStore(tmp_path / "analysis.db")
    assert reader.get("j1")["ticker"] == "600519.SH"
