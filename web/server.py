"""TradingAgents Web UI — FastAPI backend with WebSocket streaming.

Starts an analysis job in a background thread, streams LangGraph node
completions to connected WebSocket clients in real time, and persists
results to SQLite for later retrieval.

Usage:
    cd web && python server.py          # binds 0.0.0.0:8501
    uvicorn server:app --host 0.0.0.0 --port 8501 --reload
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Ensure the project root is on sys.path so we can import tradingagents
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))

# Load .env from project root (LLM keys, provider config, etc.)
load_dotenv(_PROJECT_ROOT / ".env")

# Clear proxy env vars — LLM calls should go direct
for _proxy_var in ("http_proxy", "https_proxy", "all_proxy",
                   "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    os.environ.pop(_proxy_var, None)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tradingagents.web")

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
DB_PATH = _PROJECT_ROOT / "web" / "analysis.db"


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    conn = _get_db()
    conn.execute("""
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
    """)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# In-memory job registry — maps job_id → state + subscriber list
# ---------------------------------------------------------------------------
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _register_job(job_id: str, ticker: str, trade_date: str) -> None:
    with _jobs_lock:
        _jobs[job_id] = {
            "ticker": ticker,
            "trade_date": trade_date,
            "status": "running",
            "events": [],       # ordered list of event dicts
            "subscribers": [],  # list of asyncio.Queue
        }


def _push_event(job_id: str, event: dict) -> None:
    """Append an event and notify all WebSocket subscribers."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job["events"].append(event)
        for q in job["subscribers"]:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass  # slow consumer — drop


def _subscribe(job_id: str) -> asyncio.Queue | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        # Replay past events so late-joiners see history
        for ev in job["events"]:
            q.put_nowait(ev)
        job["subscribers"].append(q)
        return q


def _unsubscribe(job_id: str, q: asyncio.Queue) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job and q in job["subscribers"]:
            job["subscribers"].remove(q)


# ---------------------------------------------------------------------------
# Graph node → human-readable label mapping
# ---------------------------------------------------------------------------
_NODE_LABELS: dict[str, str] = {
    "Market Analyst": "市场分析师",
    "Sentiment Analyst": "舆情分析师",
    "News Analyst": "新闻分析师",
    "Fundamentals Analyst": "基本面分析师",
    "Annual Report Analyst": "年报分析师",
    "Industry Chain Analyst": "产业链分析师",
    "Bull Researcher": "多头研究员",
    "Bear Researcher": "空头研究员",
    "Research Manager": "研究主管",
    "Trader": "交易员",
    "Aggressive Analyst": "激进风控",
    "Conservative Analyst": "保守风控",
    "Neutral Analyst": "中性风控",
    "Portfolio Manager": "组合经理",
}

# Report state keys and their corresponding analyst node names
_REPORT_KEYS: dict[str, str] = {
    "market_report": "Market Analyst",
    "sentiment_report": "Sentiment Analyst",
    "news_report": "News Analyst",
    "fundamentals_report": "Fundamentals Analyst",
    "annual_report": "Annual Report Analyst",
    "industry_report": "Industry Chain Analyst",
}

# All graph nodes in expected execution order (for timeline tracking)
_ALL_NODES_ORDER = [
    "Market Analyst", "Sentiment Analyst", "News Analyst",
    "Fundamentals Analyst", "Annual Report Analyst", "Industry Chain Analyst",
    "Bull Researcher", "Bear Researcher", "Research Manager",
    "Trader",
    "Aggressive Analyst", "Conservative Analyst", "Neutral Analyst",
    "Portfolio Manager",
]


# ---------------------------------------------------------------------------
# Background analysis runner
# ---------------------------------------------------------------------------
def _run_analysis(job_id: str, ticker: str, trade_date: str) -> None:
    """Run TradingAgentsGraph.propagate() in a background thread, emitting
    WebSocket events as each LangGraph node completes."""
    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    _push_event(job_id, {
        "type": "status",
        "status": "initializing",
        "message": f"正在初始化分析引擎 — {ticker} @ {trade_date}",
    })

    try:
        config = DEFAULT_CONFIG.copy()
        # Default analyst set — the 6 analysts for A-share
        selected_analysts = ("market", "social", "news", "fundamentals",
                             "annual_report", "industry_chain")

        ta = TradingAgentsGraph(
            selected_analysts=selected_analysts,
            debug=False,   # We drive streaming ourselves below
            config=config,
        )

        # --- Build initial state (same as propagate() internals) ---
        ta.ticker = ticker
        ta._resolve_pending_entries(ticker)

        if config.get("checkpoint_enabled"):
            from tradingagents.graph.checkpointer import get_checkpointer, thread_id as _tid
            ta._checkpointer_ctx = get_checkpointer(config["data_cache_dir"], ticker)
            saver = ta._checkpointer_ctx.__enter__()
            ta.graph = ta.workflow.compile(checkpointer=saver)

        past_context = ta.memory_log.get_past_context(ticker)
        instrument_context = ta.resolve_instrument_context(ticker)
        init_state = ta.propagator.create_initial_state(
            ticker, trade_date,
            past_context=past_context,
            instrument_context=instrument_context,
        )
        args = ta.propagator.get_graph_args()

        if config.get("checkpoint_enabled"):
            from tradingagents.graph.checkpointer import thread_id as _tid
            sig = ta._run_signature("stock")
            tid = _tid(ticker, str(trade_date), sig)
            args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = tid

        _push_event(job_id, {"type": "status", "status": "running",
                             "message": "分析引擎已就绪，开始执行…"})

        # --- Stream the graph, detect node transitions ---
        seen_reports: set[str] = set()
        prev_debate_bull_len = 0
        prev_debate_bear_len = 0
        prev_risk_agg_len = 0
        prev_risk_con_len = 0
        prev_risk_neu_len = 0
        had_trader = False
        had_final = False
        active_node: str | None = None
        trace = []

        for chunk in ta.graph.stream(init_state, **args):
            trace.append(chunk)

            # -- Analyst reports --
            for rkey, node_name in _REPORT_KEYS.items():
                content = chunk.get(rkey, "")
                if content and rkey not in seen_reports:
                    seen_reports.add(rkey)
                    if active_node != node_name:
                        if active_node:
                            _push_event(job_id, {"type": "node_complete", "node": active_node})
                        active_node = node_name
                        _push_event(job_id, {"type": "node_start", "node": node_name,
                                             "label": _NODE_LABELS.get(node_name, node_name)})
                    _push_event(job_id, {
                        "type": "report",
                        "node": node_name,
                        "label": _NODE_LABELS.get(node_name, node_name),
                        "report_key": rkey,
                        "content": content,
                    })
                    _push_event(job_id, {"type": "node_complete", "node": node_name,
                                         "label": _NODE_LABELS.get(node_name, node_name)})
                    active_node = None

            # -- Investment debate --
            ids = chunk.get("investment_debate_state")
            if ids and isinstance(ids, dict):
                bull = ids.get("bull_history", "")
                bear = ids.get("bear_history", "")
                judge = ids.get("judge_decision", "")

                if bull and len(bull) > prev_debate_bull_len:
                    node = "Bull Researcher"
                    if active_node != node:
                        if active_node:
                            _push_event(job_id, {"type": "node_complete", "node": active_node})
                        active_node = node
                        _push_event(job_id, {"type": "node_start", "node": node,
                                             "label": _NODE_LABELS[node]})
                    new_text = bull[prev_debate_bull_len:]
                    _push_event(job_id, {
                        "type": "debate",
                        "phase": "investment",
                        "speaker": "Bull Researcher",
                        "label": "多头研究员",
                        "content": new_text,
                    })
                    prev_debate_bull_len = len(bull)

                if bear and len(bear) > prev_debate_bear_len:
                    node = "Bear Researcher"
                    if active_node != node:
                        if active_node:
                            _push_event(job_id, {"type": "node_complete", "node": active_node})
                        active_node = node
                        _push_event(job_id, {"type": "node_start", "node": node,
                                             "label": _NODE_LABELS[node]})
                    new_text = bear[prev_debate_bear_len:]
                    _push_event(job_id, {
                        "type": "debate",
                        "phase": "investment",
                        "speaker": "Bear Researcher",
                        "label": "空头研究员",
                        "content": new_text,
                    })
                    prev_debate_bear_len = len(bear)

                if judge:
                    node = "Research Manager"
                    if active_node != node:
                        if active_node:
                            _push_event(job_id, {"type": "node_complete", "node": active_node})
                        active_node = node
                        _push_event(job_id, {"type": "node_start", "node": node,
                                             "label": _NODE_LABELS[node]})
                    _push_event(job_id, {
                        "type": "debate_decision",
                        "phase": "investment",
                        "speaker": "Research Manager",
                        "label": "研究主管",
                        "content": judge,
                    })
                    _push_event(job_id, {"type": "node_complete", "node": node,
                                         "label": _NODE_LABELS[node]})
                    active_node = None

            # -- Trader plan --
            trader_plan = chunk.get("trader_investment_plan", "")
            if trader_plan and not had_trader:
                had_trader = True
                node = "Trader"
                if active_node:
                    _push_event(job_id, {"type": "node_complete", "node": active_node})
                active_node = node
                _push_event(job_id, {"type": "node_start", "node": node,
                                     "label": _NODE_LABELS[node]})
                _push_event(job_id, {
                    "type": "trader_plan",
                    "node": node,
                    "label": _NODE_LABELS[node],
                    "content": trader_plan,
                })
                _push_event(job_id, {"type": "node_complete", "node": node,
                                     "label": _NODE_LABELS[node]})
                active_node = None

            # -- Risk debate --
            rds = chunk.get("risk_debate_state")
            if rds and isinstance(rds, dict):
                agg = rds.get("aggressive_history", "")
                con = rds.get("conservative_history", "")
                neu = rds.get("neutral_history", "")
                rjudge = rds.get("judge_decision", "")

                for history_val, prev_len_ref, node_name, label in [
                    (agg, "prev_risk_agg_len", "Aggressive Analyst", "激进风控"),
                    (con, "prev_risk_con_len", "Conservative Analyst", "保守风控"),
                    (neu, "prev_risk_neu_len", "Neutral Analyst", "中性风控"),
                ]:
                    prev_len = locals()[prev_len_ref]
                    if history_val and len(history_val) > prev_len:
                        if active_node != node_name:
                            if active_node:
                                _push_event(job_id, {"type": "node_complete", "node": active_node})
                            active_node = node_name
                            _push_event(job_id, {"type": "node_start", "node": node_name,
                                                 "label": label})
                        new_text = history_val[prev_len:]
                        _push_event(job_id, {
                            "type": "debate",
                            "phase": "risk",
                            "speaker": node_name,
                            "label": label,
                            "content": new_text,
                        })
                        # Update via the mutable name lookup
                        if prev_len_ref == "prev_risk_agg_len":
                            prev_risk_agg_len = len(history_val)
                        elif prev_len_ref == "prev_risk_con_len":
                            prev_risk_con_len = len(history_val)
                        else:
                            prev_risk_neu_len = len(history_val)

                if rjudge:
                    node = "Portfolio Manager"
                    if active_node != node:
                        if active_node:
                            _push_event(job_id, {"type": "node_complete", "node": active_node})
                        active_node = node
                        _push_event(job_id, {"type": "node_start", "node": node,
                                             "label": _NODE_LABELS[node]})
                    _push_event(job_id, {
                        "type": "debate_decision",
                        "phase": "risk",
                        "speaker": "Portfolio Manager",
                        "label": "组合经理",
                        "content": rjudge,
                    })

            # -- Final decision --
            final = chunk.get("final_trade_decision", "")
            if final and not had_final:
                had_final = True
                if active_node:
                    _push_event(job_id, {"type": "node_complete", "node": active_node})
                    active_node = None
                _push_event(job_id, {
                    "type": "decision",
                    "content": final,
                })

        # Merge streamed chunks into final state
        final_state: dict[str, Any] = {}
        for c in trace:
            final_state.update(c)

        # Store decision
        ta.curr_state = final_state
        ta._log_state(trade_date, final_state)
        ta.memory_log.store_decision(
            ticker=ticker,
            trade_date=trade_date,
            final_trade_decision=final_state.get("final_trade_decision", ""),
        )

        # Extract signal
        decision_text = final_state.get("final_trade_decision", "")
        signal = ta.process_signal(decision_text)

        # Clean up checkpointer
        if ta._checkpointer_ctx is not None:
            ta._checkpointer_ctx.__exit__(None, None, None)
            ta._checkpointer_ctx = None

        # Persist to SQLite
        result_data = {
            "market_report": final_state.get("market_report", ""),
            "sentiment_report": final_state.get("sentiment_report", ""),
            "news_report": final_state.get("news_report", ""),
            "fundamentals_report": final_state.get("fundamentals_report", ""),
            "annual_report": final_state.get("annual_report", ""),
            "industry_report": final_state.get("industry_report", ""),
            "investment_debate": {
                "bull_history": final_state.get("investment_debate_state", {}).get("bull_history", ""),
                "bear_history": final_state.get("investment_debate_state", {}).get("bear_history", ""),
                "judge_decision": final_state.get("investment_debate_state", {}).get("judge_decision", ""),
            },
            "trader_plan": final_state.get("trader_investment_plan", ""),
            "risk_debate": {
                "aggressive_history": final_state.get("risk_debate_state", {}).get("aggressive_history", ""),
                "conservative_history": final_state.get("risk_debate_state", {}).get("conservative_history", ""),
                "neutral_history": final_state.get("risk_debate_state", {}).get("neutral_history", ""),
                "judge_decision": final_state.get("risk_debate_state", {}).get("judge_decision", ""),
            },
            "final_decision": decision_text,
            "signal": signal,
        }

        conn = _get_db()
        conn.execute(
            "UPDATE analyses SET status=?, result_json=?, decision=?, finished_at=? WHERE id=?",
            ("completed", json.dumps(result_data, ensure_ascii=False),
             str(signal), datetime.now().isoformat(), job_id),
        )
        conn.commit()
        conn.close()

        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["status"] = "completed"

        _push_event(job_id, {
            "type": "complete",
            "signal": signal,
            "message": "分析完成",
        })

    except Exception as exc:
        logger.exception("Analysis job %s failed", job_id)
        error_msg = str(exc)

        conn = _get_db()
        conn.execute(
            "UPDATE analyses SET status=?, result_json=?, finished_at=? WHERE id=?",
            ("failed", json.dumps({"error": error_msg}, ensure_ascii=False),
             datetime.now().isoformat(), job_id),
        )
        conn.commit()
        conn.close()

        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["status"] = "failed"

        _push_event(job_id, {
            "type": "error",
            "message": f"分析失败: {error_msg}",
        })


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    yield

app = FastAPI(title="TradingAgents Web UI", lifespan=lifespan)

# Serve static files (index.html, CSS, JS)
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the single-page UI."""
    html_path = Path(__file__).parent / "static" / "index.html"
    return HTMLResponse(content=html_path.read_text(encoding="utf-8"))


@app.post("/api/analyze")
async def start_analysis(payload: dict):
    """Start a new analysis job.

    Body: {"ticker": "600519.SH", "date": "2026-07-31"}
    Returns: {"job_id": "...", "status": "running"}
    """
    ticker = payload.get("ticker", "").strip()
    trade_date = payload.get("date", "").strip()

    if not ticker:
        return JSONResponse({"error": "请输入股票代码"}, status_code=400)
    if not trade_date:
        return JSONResponse({"error": "请选择交易日期"}, status_code=400)

    job_id = str(uuid.uuid4())

    # Persist to DB
    conn = _get_db()
    conn.execute(
        "INSERT INTO analyses (id, ticker, trade_date, status) VALUES (?, ?, ?, ?)",
        (job_id, ticker, trade_date, "running"),
    )
    conn.commit()
    conn.close()

    # Register in-memory
    _register_job(job_id, ticker, trade_date)

    # Launch background thread
    t = threading.Thread(target=_run_analysis, args=(job_id, ticker, trade_date),
                         daemon=True, name=f"analysis-{job_id[:8]}")
    t.start()

    return {"job_id": job_id, "status": "running"}


@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    """Stream analysis events to the client."""
    await websocket.accept()

    q = _subscribe(job_id)
    if q is None:
        await websocket.send_json({"type": "error", "message": "任务不存在"})
        await websocket.close()
        return

    try:
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=30.0)
                await websocket.send_json(event)
                if event.get("type") in ("complete", "error"):
                    break
            except asyncio.TimeoutError:
                # Send keepalive ping
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error for job %s", job_id)
    finally:
        _unsubscribe(job_id, q)


@app.get("/api/history")
async def list_history():
    """List past analyses, newest first."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT id, ticker, trade_date, status, decision, created_at, finished_at "
        "FROM analyses ORDER BY created_at DESC LIMIT 50"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/history/{job_id}")
async def get_history(job_id: str):
    """Get full result of a past analysis."""
    conn = _get_db()
    row = conn.execute("SELECT * FROM analyses WHERE id=?", (job_id,)).fetchone()
    conn.close()
    if not row:
        return JSONResponse({"error": "未找到该分析记录"}, status_code=404)
    result = dict(row)
    if result.get("result_json"):
        result["result"] = json.loads(result["result_json"])
        del result["result_json"]
    return result


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8501, log_level="info")
