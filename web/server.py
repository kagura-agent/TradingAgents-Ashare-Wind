"""TradingAgents Web UI — FastAPI routes.

This module is deliberately thin. Everything with logic worth testing lives
next door: event derivation in :mod:`web.events`, the thread-to-loop bridge in
:mod:`web.jobs`, persistence in :mod:`web.store`, graph orchestration in
:mod:`web.runner`. What is left here is HTTP and WebSocket plumbing.

Run it with::

    python -m web.server                  # binds 127.0.0.1:8501
    uvicorn web.server:app --reload

The frontend is built separately (``cd web/frontend && npm run build``) into
``web/static``. A fresh clone has no such directory, so the server starts
without it and says so rather than failing at import time.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .jobs import registry
from .store import AnalysisStore

logger = logging.getLogger("tradingagents.web")

_STATIC_DIR = Path(__file__).resolve().parent / "static"

# Seconds a WebSocket waits for an event before sending a keepalive. Analyses
# routinely spend minutes inside one LLM call, which is long enough for an
# intermediate proxy to consider the connection dead.
_PING_INTERVAL = 25.0

store = AnalysisStore()


def _demo_mode() -> bool:
    """Whether to replay the fixture instead of calling the graph.

    Read per-request rather than cached at import so tests can flip it with
    ``monkeypatch.setenv``.
    """
    return os.environ.get("TRADINGAGENTS_WEB_DEMO", "").strip() not in ("", "0", "false", "False")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(store.init)
    if not (_STATIC_DIR / "index.html").exists():
        logger.warning(
            "web/static/index.html is missing — run `cd web/frontend && npm run build`. "
            "The API is up; only the UI is unavailable."
        )
    yield


app = FastAPI(title="TradingAgents Web UI", lifespan=lifespan)


@app.get("/api/meta")
async def meta() -> dict:
    """Small capability probe; the UI shows a badge when demo mode is on."""
    return {"demo": _demo_mode()}


# response_model=None: the union return annotation is a Python type hint, not a
# response schema — FastAPI would otherwise try to make a Pydantic model of it.
@app.post("/api/analyze", response_model=None)
async def start_analysis(payload: dict) -> JSONResponse | dict:
    """Start an analysis job.

    Body: ``{"ticker": "600519.SH", "date": "2026-07-31"}``.
    """
    ticker = str(payload.get("ticker") or "").strip()
    trade_date = str(payload.get("date") or "").strip()

    if not ticker:
        return JSONResponse({"error": "请输入股票代码"}, status_code=400)
    if not trade_date:
        return JSONResponse({"error": "请选择交易日期"}, status_code=400)
    try:
        datetime.strptime(trade_date, "%Y-%m-%d")
    except ValueError:
        return JSONResponse({"error": "日期格式应为 YYYY-MM-DD"}, status_code=400)

    job_id = str(uuid.uuid4())
    await asyncio.to_thread(store.create, job_id, ticker, trade_date)
    registry.register(job_id, ticker, trade_date)

    if _demo_mode():
        from .demo import run_demo_analysis as target
    else:
        from .runner import run_analysis as target

    # daemon=True so Ctrl-C on the server does not wait out a running analysis.
    threading.Thread(
        target=target,
        args=(job_id, ticker, trade_date, registry, store),
        daemon=True,
        name=f"analysis-{job_id[:8]}",
    ).start()

    return {"job_id": job_id, "status": "running"}


@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str) -> None:
    """Stream a job's events, replaying everything emitted so far first.

    Replay is what makes the client's reconnect loop safe: a browser that drops
    off mid-analysis reattaches and receives the full history, so its reducer
    only has to be idempotent.
    """
    await websocket.accept()

    sub = registry.subscribe(job_id, asyncio.get_running_loop())
    if sub is None:
        await websocket.send_json({"type": "error", "message": "任务不存在"})
        await websocket.close()
        return

    try:
        while True:
            try:
                event = await asyncio.wait_for(sub.get(), timeout=_PING_INTERVAL)
            except asyncio.TimeoutError:
                # Not the builtin TimeoutError: the two are only aliases from
                # Python 3.11 on, and this package supports 3.10.
                await websocket.send_json({"type": "ping"})
                continue
            await websocket.send_json(event)
            if event.get("type") in ("complete", "error"):
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error for job %s", job_id)
    finally:
        registry.unsubscribe(job_id, sub)


@app.get("/api/history")
async def list_history() -> list[dict]:
    """Past analyses, newest first."""
    return await asyncio.to_thread(store.list_recent, 50)


@app.get("/api/history/{job_id}", response_model=None)
async def get_history(job_id: str) -> JSONResponse | dict:
    """Full stored result of one analysis."""
    record = await asyncio.to_thread(store.get, job_id)
    if record is None:
        return JSONResponse({"error": "未找到该分析记录"}, status_code=404)
    return record


if (_STATIC_DIR / "index.html").exists():
    # Mounted last: Starlette matches routes in registration order, so the API
    # and WebSocket routes above still win over this catch-all.
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
else:
    @app.get("/", response_class=HTMLResponse)
    async def missing_frontend() -> HTMLResponse:
        return HTMLResponse(
            "<h1>前端尚未构建</h1>"
            "<p>请先运行 <code>cd web/frontend &amp;&amp; npm ci &amp;&amp; npm run build</code>，"
            "然后刷新本页。</p>",
            status_code=503,
        )


def main() -> None:
    """``python -m web.server`` entry point."""
    import uvicorn
    from dotenv import load_dotenv

    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env")

    # LLM calls should go direct. Done here rather than at import time so that
    # importing this module (tests, `uvicorn web.server:app`) has no side
    # effects on the environment.
    for var in ("http_proxy", "https_proxy", "all_proxy",
                "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        os.environ.pop(var, None)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    uvicorn.run(app, host=os.environ.get("TRADINGAGENTS_WEB_HOST", "127.0.0.1"),
                port=int(os.environ.get("TRADINGAGENTS_WEB_PORT", "8501")),
                log_level="info")


if __name__ == "__main__":
    main()
