"""HTTP and WebSocket surface of the web UI.

Everything here runs against the demo fixture (``TRADINGAGENTS_WEB_DEMO=1``),
so the routes are exercised end to end — job creation, streaming, replay,
persistence — without an LLM or a Wind terminal in the loop.
"""

import pytest

pytest.importorskip("fastapi", reason="web extra not installed")
pytest.importorskip("httpx", reason="pip install 'tradingagents[dev]'")

from fastapi.testclient import TestClient  # noqa: E402

from web.jobs import JobRegistry  # noqa: E402
from web.store import AnalysisStore  # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A TestClient with an isolated database, registry and no replay delay."""
    import web.demo as demo
    import web.server as server

    monkeypatch.setenv("TRADINGAGENTS_WEB_DEMO", "1")
    monkeypatch.setattr(server, "store", AnalysisStore(tmp_path / "analysis.db"))
    monkeypatch.setattr(server, "registry", JobRegistry())
    monkeypatch.setattr(demo, "DEMO_STEP_DELAY", 0.0)
    with TestClient(server.app) as c:
        yield c


def _start(client, ticker="600519.SH", date="2026-07-31"):
    response = client.post("/api/analyze", json={"ticker": ticker, "date": date})
    assert response.status_code == 200
    return response.json()["job_id"]


def _stream(client, job_id):
    """Collect a job's events until it terminates."""
    events = []
    with client.websocket_connect(f"/ws/{job_id}") as ws:
        while True:
            event = ws.receive_json()
            events.append(event)
            if event["type"] in ("complete", "error"):
                return events


@pytest.mark.unit
def test_meta_reports_demo_mode(client, monkeypatch):
    assert client.get("/api/meta").json() == {"demo": True}
    monkeypatch.setenv("TRADINGAGENTS_WEB_DEMO", "0")
    assert client.get("/api/meta").json() == {"demo": False}


@pytest.mark.unit
@pytest.mark.parametrize("payload", [
    {},
    {"date": "2026-07-31"},
    {"ticker": "   ", "date": "2026-07-31"},
])
def test_missing_ticker_is_rejected(client, payload):
    response = client.post("/api/analyze", json=payload)
    assert response.status_code == 400
    assert "股票代码" in response.json()["error"]


@pytest.mark.unit
def test_missing_date_is_rejected(client):
    response = client.post("/api/analyze", json={"ticker": "600519.SH"})
    assert response.status_code == 400
    assert "交易日期" in response.json()["error"]


@pytest.mark.unit
@pytest.mark.parametrize("bad_date", ["2026/07/31", "31-07-2026", "tomorrow", "2026-13-01"])
def test_malformed_date_is_rejected(client, bad_date):
    response = client.post("/api/analyze", json={"ticker": "600519.SH", "date": bad_date})
    assert response.status_code == 400
    assert "YYYY-MM-DD" in response.json()["error"]


@pytest.mark.unit
def test_analyze_returns_a_job_id(client):
    body = client.post("/api/analyze", json={"ticker": "600519.SH", "date": "2026-07-31"}).json()
    assert body["status"] == "running"
    assert body["job_id"]


@pytest.mark.unit
def test_websocket_streams_a_full_run(client):
    events = _stream(client, _start(client))

    types = [e["type"] for e in events]
    assert types[0] == "status"
    assert types[-1] == "complete"
    assert types.count("report") == 6           # the six A-share analysts
    assert "decision" in types
    assert types.count("node_start") == types.count("node_complete")
    assert events[-1]["signal"] == "Overweight"


@pytest.mark.unit
def test_reports_carry_markdown_not_prerendered_html(client):
    """The frontend renders Markdown; the backend must not do it for them."""
    events = _stream(client, _start(client))

    market = next(e for e in events if e.get("report_key") == "market_report")
    assert "| 指标 |" in market["content"]
    assert "<table" not in market["content"]


@pytest.mark.unit
def test_reconnecting_after_completion_replays_everything(client):
    """Pins the reconnect contract the frontend depends on (F3)."""
    job_id = _start(client)
    first = _stream(client, job_id)
    second = _stream(client, job_id)

    assert second == first


@pytest.mark.unit
def test_subscribing_to_an_unknown_job_reports_an_error(client):
    with client.websocket_connect("/ws/does-not-exist") as ws:
        event = ws.receive_json()
    assert event["type"] == "error"
    assert "任务不存在" in event["message"]


@pytest.mark.unit
def test_idle_websocket_receives_a_keepalive(client, monkeypatch):
    """Analyses routinely idle for minutes inside one LLM call."""
    import web.server as server

    monkeypatch.setattr(server, "_PING_INTERVAL", 0.05)
    server.registry.register("idle-job", "600519.SH", "2026-07-31")

    with client.websocket_connect("/ws/idle-job") as ws:
        assert ws.receive_json() == {"type": "ping"}


@pytest.mark.unit
def test_history_lists_the_completed_run(client):
    job_id = _start(client)
    _stream(client, job_id)

    rows = client.get("/api/history").json()
    assert [r["id"] for r in rows] == [job_id]
    assert rows[0]["status"] == "completed"
    assert rows[0]["decision"] == "Overweight"


@pytest.mark.unit
def test_history_is_empty_before_any_run(client):
    assert client.get("/api/history").json() == []


@pytest.mark.unit
def test_history_detail_returns_the_stored_result(client):
    job_id = _start(client)
    _stream(client, job_id)

    record = client.get(f"/api/history/{job_id}").json()
    assert record["status"] == "completed"
    assert record["result"]["signal"] == "Overweight"
    assert "| 指标 |" in record["result"]["market_report"]
    assert "result_json" not in record


@pytest.mark.unit
def test_history_detail_404s_for_an_unknown_job(client):
    response = client.get("/api/history/does-not-exist")
    assert response.status_code == 404
    assert "未找到" in response.json()["error"]


@pytest.mark.unit
def test_non_demo_mode_dispatches_to_the_real_runner(client, monkeypatch):
    """The demo switch must select the worker, and nothing else."""
    import web.runner as runner

    monkeypatch.setenv("TRADINGAGENTS_WEB_DEMO", "0")
    calls = []
    monkeypatch.setattr(runner, "run_analysis",
                        lambda *args, **kwargs: calls.append(args))

    job_id = _start(client)
    # The worker runs on a daemon thread; drain the (empty) stream to join it.
    with client.websocket_connect(f"/ws/{job_id}") as ws:
        ws.close()

    for _ in range(200):
        if calls:
            break
        import time
        time.sleep(0.01)

    assert calls and calls[0][0] == job_id
    assert calls[0][1:3] == ("600519.SH", "2026-07-31")
