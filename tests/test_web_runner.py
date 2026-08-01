"""Graph orchestration on the worker thread.

``web.runner`` deliberately mirrors ``TradingAgentsGraph.propagate`` instead of
calling it (propagate exposes no hook for observing node transitions, which is
the whole point of a live UI). Duplicated contracts rot, so the checkpoint
lifecycle is pinned here against the three ways the previous implementation
diverged from it: no ``finally``, no ``clear_checkpoint``, no recompile.
"""

import pytest

from web.runner import build_result, run_analysis, stream_analysis


class FakePropagator:
    def __init__(self, args=None):
        self.args = args if args is not None else {"stream_mode": "values"}
        self.init_kwargs = None

    def create_initial_state(self, ticker, trade_date, **kwargs):
        self.init_kwargs = {"ticker": ticker, "trade_date": trade_date, **kwargs}
        return {"company_of_interest": ticker, "trade_date": trade_date}

    def get_graph_args(self):
        return dict(self.args)


class FakeMemoryLog:
    def __init__(self):
        self.stored = []

    def get_past_context(self, ticker):
        return f"past:{ticker}"

    def store_decision(self, **kwargs):
        self.stored.append(kwargs)


class FakeGraph:
    def __init__(self, chunks, raises=None):
        self.chunks = chunks
        self.raises = raises
        self.stream_calls = []

    def stream(self, init_state, **args):
        self.stream_calls.append((init_state, args))
        yield from self.chunks
        if self.raises is not None:
            raise self.raises


class FakeWorkflow:
    def __init__(self, graph):
        self._graph = graph
        self.compile_calls = []

    def compile(self, checkpointer=None):
        self.compile_calls.append(checkpointer)
        return self._graph


class FakeCheckpointerCtx:
    def __init__(self):
        self.entered = False
        self.exited = False

    def __enter__(self):
        self.entered = True
        return "saver"

    def __exit__(self, *exc_info):
        self.exited = True
        return False


class FakeTA:
    """Stand-in for TradingAgentsGraph exposing only what runner.py touches."""

    def __init__(self, chunks, *, checkpointing=False, raises=None, signal="Overweight"):
        self.graph = FakeGraph(chunks, raises=raises)
        self.workflow = FakeWorkflow(self.graph)
        self.propagator = FakePropagator()
        self.memory_log = FakeMemoryLog()
        self.config = {"checkpoint_enabled": checkpointing, "data_cache_dir": "/cache"}
        self.ticker = None
        self.curr_state = None
        self._checkpointer_ctx = None
        self._signal = signal
        self.resolved = []
        self.logged = []
        self.signalled = []

    def _resolve_pending_entries(self, ticker):
        self.resolved.append(ticker)

    def resolve_instrument_context(self, ticker, asset_type):
        return f"instrument:{ticker}:{asset_type}"

    def _run_signature(self, asset_type):
        return f"sig-{asset_type}"

    def _log_state(self, trade_date, state):
        self.logged.append((trade_date, state))

    def process_signal(self, text):
        self.signalled.append(text)
        return self._signal


@pytest.fixture
def spy_checkpointer(monkeypatch):
    """Replace the checkpointer helpers and record how runner.py drives them."""
    import tradingagents.graph.checkpointer as cp

    calls = {"cleared": [], "ctx": FakeCheckpointerCtx(), "thread_ids": []}

    def fake_get_checkpointer(data_dir, ticker):
        calls["get_args"] = (data_dir, ticker)
        return calls["ctx"]

    def fake_thread_id(ticker, date, signature=""):
        calls["thread_ids"].append((ticker, date, signature))
        return "tid-1234"

    def fake_clear(data_dir, ticker, date, signature=""):
        calls["cleared"].append((data_dir, ticker, date, signature))

    monkeypatch.setattr(cp, "get_checkpointer", fake_get_checkpointer)
    monkeypatch.setattr(cp, "thread_id", fake_thread_id)
    monkeypatch.setattr(cp, "clear_checkpoint", fake_clear)
    return calls


CHUNKS = [
    {"market_report": "# 技术面"},
    {"market_report": "# 技术面", "trader_investment_plan": "计划"},
    {"market_report": "# 技术面", "trader_investment_plan": "计划",
     "final_trade_decision": "增持理由…"},
]


# --- stream_analysis ------------------------------------------------------

@pytest.mark.unit
def test_stream_analysis_returns_merged_state_and_signal():
    ta = FakeTA(CHUNKS)
    events = []

    state, signal = stream_analysis(ta, "600519.SH", "2026-07-31", events.append)

    # stream_mode="values" chunks are cumulative; merging them all is belt and
    # braces, and every key must survive.
    assert state["market_report"] == "# 技术面"
    assert state["trader_investment_plan"] == "计划"
    assert state["final_trade_decision"] == "增持理由…"
    assert signal == "Overweight"
    assert ta.signalled == ["增持理由…"]


@pytest.mark.unit
def test_stream_analysis_emits_events_ending_in_a_decision():
    ta = FakeTA(CHUNKS)
    events = []

    stream_analysis(ta, "600519.SH", "2026-07-31", events.append)

    types = [e["type"] for e in events]
    assert types[0] == "status"
    assert "report" in types
    assert "trader_plan" in types
    assert types[-1] == "decision"
    assert types.count("node_start") == types.count("node_complete")


@pytest.mark.unit
def test_stream_analysis_records_state_and_memory():
    ta = FakeTA(CHUNKS)

    state, _ = stream_analysis(ta, "600519.SH", "2026-07-31", lambda _e: None)

    assert ta.ticker == "600519.SH"
    assert ta.resolved == ["600519.SH"]
    assert ta.curr_state is state
    assert ta.logged == [("2026-07-31", state)]
    assert ta.memory_log.stored == [{
        "ticker": "600519.SH",
        "trade_date": "2026-07-31",
        "final_trade_decision": "增持理由…",
    }]


@pytest.mark.unit
def test_stream_analysis_builds_initial_state_through_the_propagator():
    ta = FakeTA(CHUNKS)

    stream_analysis(ta, "600519.SH", "2026-07-31", lambda _e: None)

    assert ta.propagator.init_kwargs == {
        "ticker": "600519.SH",
        "trade_date": "2026-07-31",
        "asset_type": "stock",
        "past_context": "past:600519.SH",
        "instrument_context": "instrument:600519.SH:stock",
    }


@pytest.mark.unit
def test_no_checkpointing_leaves_the_graph_alone(spy_checkpointer):
    ta = FakeTA(CHUNKS, checkpointing=False)

    stream_analysis(ta, "600519.SH", "2026-07-31", lambda _e: None)

    assert ta.workflow.compile_calls == []       # never recompiled
    assert spy_checkpointer["ctx"].entered is False
    assert spy_checkpointer["cleared"] == []
    _init, args = ta.graph.stream_calls[0]
    assert "config" not in args                  # no thread_id injected


@pytest.mark.unit
def test_checkpointing_injects_the_thread_id(spy_checkpointer):
    ta = FakeTA(CHUNKS, checkpointing=True)

    stream_analysis(ta, "600519.SH", "2026-07-31", lambda _e: None)

    _init, args = ta.graph.stream_calls[0]
    assert args["config"]["configurable"]["thread_id"] == "tid-1234"
    assert spy_checkpointer["thread_ids"][0] == ("600519.SH", "2026-07-31", "sig-stock")


@pytest.mark.unit
def test_checkpointing_compiles_with_the_saver(spy_checkpointer):
    ta = FakeTA(CHUNKS, checkpointing=True)

    stream_analysis(ta, "600519.SH", "2026-07-31", lambda _e: None)

    assert spy_checkpointer["ctx"].entered is True
    assert ta.workflow.compile_calls[0] == "saver"


@pytest.mark.unit
def test_success_clears_the_checkpoint(spy_checkpointer):
    """Pins B4: leaving a checkpoint behind makes the next run resume a
    finished graph, which then has nothing left to do."""
    ta = FakeTA(CHUNKS, checkpointing=True)

    stream_analysis(ta, "600519.SH", "2026-07-31", lambda _e: None)

    assert spy_checkpointer["cleared"] == [("/cache", "600519.SH", "2026-07-31", "sig-stock")]


@pytest.mark.unit
def test_success_exits_the_checkpointer_and_recompiles(spy_checkpointer):
    """Pins B5: the graph must not keep referencing a closed SqliteSaver."""
    ta = FakeTA(CHUNKS, checkpointing=True)

    stream_analysis(ta, "600519.SH", "2026-07-31", lambda _e: None)

    assert spy_checkpointer["ctx"].exited is True
    assert ta._checkpointer_ctx is None
    assert ta.workflow.compile_calls == ["saver", None]


@pytest.mark.unit
def test_a_mid_run_failure_still_exits_the_checkpointer(spy_checkpointer):
    """Pins B3: the cleanup lives in a finally, not the try body."""
    ta = FakeTA(CHUNKS, checkpointing=True, raises=RuntimeError("Wind timeout"))

    with pytest.raises(RuntimeError, match="Wind timeout"):
        stream_analysis(ta, "600519.SH", "2026-07-31", lambda _e: None)

    assert spy_checkpointer["ctx"].exited is True
    assert ta._checkpointer_ctx is None
    assert ta.workflow.compile_calls == ["saver", None]
    # A failed run must not clear the checkpoint — that is what makes it
    # resumable.
    assert spy_checkpointer["cleared"] == []


@pytest.mark.unit
def test_a_failure_without_checkpointing_propagates_cleanly(spy_checkpointer):
    ta = FakeTA(CHUNKS, checkpointing=False, raises=RuntimeError("boom"))

    with pytest.raises(RuntimeError, match="boom"):
        stream_analysis(ta, "600519.SH", "2026-07-31", lambda _e: None)

    assert ta.workflow.compile_calls == []


# --- build_result ---------------------------------------------------------

@pytest.mark.unit
def test_build_result_shape():
    state = {
        "market_report": "M",
        "sentiment_report": "S",
        "news_report": "N",
        "fundamentals_report": "F",
        "annual_report": "A",
        "industry_report": "I",
        "investment_debate_state": {"bull_history": "B", "bear_history": "b",
                                    "judge_decision": "J"},
        "trader_investment_plan": "P",
        "risk_debate_state": {"aggressive_history": "agg", "conservative_history": "con",
                              "neutral_history": "neu", "judge_decision": "RJ"},
    }

    result = build_result(state, "决策文本", "Overweight")

    assert result["market_report"] == "M"
    assert result["investment_debate"] == {"bull_history": "B", "bear_history": "b",
                                           "judge_decision": "J"}
    assert result["risk_debate"]["neutral_history"] == "neu"
    assert result["trader_plan"] == "P"
    assert result["final_decision"] == "决策文本"
    assert result["signal"] == "Overweight"


@pytest.mark.unit
def test_build_result_tolerates_a_partial_state():
    result = build_result({}, "", "")

    assert result["market_report"] == ""
    assert result["investment_debate"]["bull_history"] == ""
    assert result["risk_debate"]["judge_decision"] == ""


# --- run_analysis ---------------------------------------------------------

class FakeRegistry:
    def __init__(self):
        self.events = []
        self.status = None

    def push(self, job_id, event):
        self.events.append(event)

    def set_status(self, job_id, status):
        self.status = status


class FakeStore:
    def __init__(self):
        self.completed = None
        self.failed = None

    def mark_completed(self, job_id, result, decision):
        self.completed = (job_id, result, decision)

    def mark_failed(self, job_id, error):
        self.failed = (job_id, error)


@pytest.mark.unit
def test_run_analysis_persists_and_completes(spy_checkpointer):
    reg, store = FakeRegistry(), FakeStore()

    run_analysis("job-1", "600519.SH", "2026-07-31", reg, store,
                 graph_factory=lambda: FakeTA(CHUNKS))

    job_id, result, decision = store.completed
    assert job_id == "job-1"
    assert decision == "Overweight"
    assert result["signal"] == "Overweight"
    assert result["final_decision"] == "增持理由…"
    assert reg.status == "completed"
    assert reg.events[-1] == {"type": "complete", "signal": "Overweight", "message": "分析完成"}


@pytest.mark.unit
def test_run_analysis_emits_an_initializing_status_first():
    reg, store = FakeRegistry(), FakeStore()

    run_analysis("job-1", "600519.SH", "2026-07-31", reg, store,
                 graph_factory=lambda: FakeTA(CHUNKS))

    assert reg.events[0]["type"] == "status"
    assert reg.events[0]["status"] == "initializing"
    assert "600519.SH" in reg.events[0]["message"]


@pytest.mark.unit
def test_run_analysis_reports_failures_instead_of_raising():
    """The worker thread has nowhere to raise to; the UI is the error channel."""
    reg, store = FakeRegistry(), FakeStore()

    run_analysis("job-1", "600519.SH", "2026-07-31", reg, store,
                 graph_factory=lambda: FakeTA(CHUNKS, raises=RuntimeError("Wind timeout")))

    assert store.failed == ("job-1", "Wind timeout")
    assert store.completed is None
    assert reg.status == "failed"
    assert reg.events[-1]["type"] == "error"
    assert "Wind timeout" in reg.events[-1]["message"]


@pytest.mark.unit
def test_run_analysis_reports_a_failing_graph_factory():
    reg, store = FakeRegistry(), FakeStore()

    def boom():
        raise ValueError("no API key")

    run_analysis("job-1", "600519.SH", "2026-07-31", reg, store, graph_factory=boom)

    assert store.failed == ("job-1", "no API key")
    assert reg.events[-1]["type"] == "error"
