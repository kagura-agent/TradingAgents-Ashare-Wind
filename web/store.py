"""SQLite persistence for analysis runs.

Every method is synchronous and opens its own short-lived connection, which
suits SQLite fine and keeps the store trivially usable from both the worker
thread and the event loop. Callers on the loop must wrap these in
``asyncio.to_thread`` — see ``web/server.py`` — so a slow disk cannot stall
WebSocket delivery.

The database path is a constructor argument rather than a module constant so
tests get a tmp_path instance instead of writing to the developer's real
history.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "analysis.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS analyses (
    id          TEXT PRIMARY KEY,
    ticker      TEXT NOT NULL,
    trade_date  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    decision    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    finished_at TEXT
)
"""


class AnalysisStore:
    """Records analysis runs and their results."""

    def __init__(self, db_path: Path | str = DEFAULT_DB_PATH) -> None:
        self.db_path = Path(db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        # WAL lets the worker thread write while the event loop reads history.
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def init(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(_SCHEMA)

    def create(self, job_id: str, ticker: str, trade_date: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO analyses (id, ticker, trade_date, status) VALUES (?, ?, ?, ?)",
                (job_id, ticker, trade_date, "running"),
            )

    def mark_completed(self, job_id: str, result: dict[str, Any], decision: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE analyses SET status=?, result_json=?, decision=?, finished_at=? "
                "WHERE id=?",
                ("completed", json.dumps(result, ensure_ascii=False), decision,
                 datetime.now().isoformat(timespec="seconds"), job_id),
            )

    def mark_failed(self, job_id: str, error: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE analyses SET status=?, result_json=?, finished_at=? WHERE id=?",
                ("failed", json.dumps({"error": error}, ensure_ascii=False),
                 datetime.now().isoformat(timespec="seconds"), job_id),
            )

    def list_recent(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, ticker, trade_date, status, decision, created_at, finished_at "
                "FROM analyses ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM analyses WHERE id=?", (job_id,)).fetchone()
        if row is None:
            return None
        record = dict(row)
        raw = record.pop("result_json", None)
        if raw:
            try:
                record["result"] = json.loads(raw)
            except json.JSONDecodeError:
                # A truncated write should degrade to "no detail", not a 500.
                record["result"] = None
        else:
            record["result"] = None
        return record
