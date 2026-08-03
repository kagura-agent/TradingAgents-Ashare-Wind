"""Run an analysis on a worker thread, streaming events as the graph advances.

This is deliberately the only place in ``web/`` that knows about
``TradingAgentsGraph``. It mirrors what ``TradingAgentsGraph.propagate`` does
(tradingagents/graph/trading_graph.py) rather than calling it, because
``propagate`` returns only the final state — it has no hook for observing node
transitions as they happen, which is the entire point of the live UI.

That duplication is a liability, so the checkpoint lifecycle here is kept
deliberately identical to ``propagate``'s, including the parts easy to forget:

* the checkpointer context exits in a ``finally``, so a mid-run exception
  cannot leak the SqliteSaver;
* ``clear_checkpoint`` runs on success, so re-running the same ticker+date
  starts fresh instead of resuming an already-finished graph;
* the graph is recompiled without the saver afterwards.

Everything else is reused rather than reimplemented: state construction goes
through ``ta.propagator``, and signal extraction, state logging and memory
recording go through the same ``ta`` methods the CLI uses.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from .events import AnalysisEventDeriver

logger = logging.getLogger("tradingagents.web")

# The six A-share analysts, matching the CLI's default selection.
DEFAULT_ANALYSTS: tuple[str, ...] = (
    "market", "social", "news", "fundamentals", "annual_report", "industry_chain",
)

EventSink = Callable[[dict], None]


def build_result(final_state: dict[str, Any], decision_text: str, signal: str) -> dict[str, Any]:
    """Shape the persisted result payload consumed by /api/history/{id}."""
    invest = final_state.get("investment_debate_state") or {}
    risk = final_state.get("risk_debate_state") or {}
    return {
        "market_report": final_state.get("market_report", ""),
        "sentiment_report": final_state.get("sentiment_report", ""),
        "news_report": final_state.get("news_report", ""),
        "fundamentals_report": final_state.get("fundamentals_report", ""),
        "annual_report": final_state.get("annual_report", ""),
        "industry_report": final_state.get("industry_report", ""),
        # Summaries for each report
        "market_report_summary": final_state.get("market_report_summary", ""),
        "sentiment_report_summary": final_state.get("sentiment_report_summary", ""),
        "news_report_summary": final_state.get("news_report_summary", ""),
        "fundamentals_report_summary": final_state.get("fundamentals_report_summary", ""),
        "annual_report_summary": final_state.get("annual_report_summary", ""),
        "industry_report_summary": final_state.get("industry_report_summary", ""),
        "investment_debate": {
            "bull_history": invest.get("bull_history", ""),
            "bear_history": invest.get("bear_history", ""),
            "bull_summary": invest.get("bull_summary", ""),
            "bear_summary": invest.get("bear_summary", ""),
            "judge_decision": invest.get("judge_decision", ""),
            "judge_decision_summary": invest.get("judge_decision_summary", ""),
        },
        "trader_plan": final_state.get("trader_investment_plan", ""),
        "trader_plan_summary": final_state.get("trader_plan_summary", ""),
        "risk_debate": {
            "aggressive_history": risk.get("aggressive_history", ""),
            "conservative_history": risk.get("conservative_history", ""),
            "neutral_history": risk.get("neutral_history", ""),
            "aggressive_summary": risk.get("aggressive_summary", ""),
            "conservative_summary": risk.get("conservative_summary", ""),
            "neutral_summary": risk.get("neutral_summary", ""),
            "judge_decision": risk.get("judge_decision", ""),
            "judge_decision_summary": risk.get("judge_decision_summary", ""),
        },
        "final_decision": decision_text,
        "final_decision_summary": final_state.get("final_decision_summary", ""),
        "signal": signal,
    }


def stream_analysis(ta: Any, ticker: str, trade_date: str,
                    emit: EventSink) -> tuple[dict[str, Any], str]:
    """Stream the graph for ``ticker`` on ``trade_date``, emitting UI events.

    ``ta`` is a configured ``TradingAgentsGraph``. Returns the merged final
    state and the extracted 5-tier signal. Raises whatever the graph raises —
    the caller owns error reporting.
    """
    from tradingagents.graph.checkpointer import (
        clear_checkpoint,
        get_checkpointer,
        thread_id,
    )

    asset_type = "stock"
    config = ta.config
    checkpointing = bool(config.get("checkpoint_enabled"))

    ta.ticker = ticker
    ta._resolve_pending_entries(ticker)

    if checkpointing:
        ta._checkpointer_ctx = get_checkpointer(config["data_cache_dir"], ticker)
        saver = ta._checkpointer_ctx.__enter__()
        ta.graph = ta.workflow.compile(checkpointer=saver)

    try:
        init_state = ta.propagator.create_initial_state(
            ticker,
            trade_date,
            asset_type=asset_type,
            past_context=ta.memory_log.get_past_context(ticker),
            instrument_context=ta.resolve_instrument_context(ticker, asset_type),
        )
        args = ta.propagator.get_graph_args()

        if checkpointing:
            tid = thread_id(ticker, str(trade_date), ta._run_signature(asset_type))
            args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = tid

        emit({"type": "status", "status": "running", "message": "分析引擎已就绪，开始执行…"})

        deriver = AnalysisEventDeriver()
        final_state: dict[str, Any] = {}
        for chunk in ta.graph.stream(init_state, **args):
            # stream_mode="values" yields the full accumulated state, so the
            # last chunk alone would suffice — but merging every chunk keeps
            # this robust if a future chunk omits an untouched key.
            if isinstance(chunk, dict):
                final_state.update(chunk)
            for event in deriver.feed(chunk):
                emit(event)
        for event in deriver.finalize():
            emit(event)

        decision_text = final_state.get("final_trade_decision", "")
        signal = ta.process_signal(decision_text)

        ta.curr_state = final_state
        ta._log_state(trade_date, final_state)
        ta.memory_log.store_decision(
            ticker=ticker,
            trade_date=trade_date,
            final_trade_decision=decision_text,
        )

        if checkpointing:
            # Mirrors _run_graph: a finished run must not leave a checkpoint
            # behind, or the next run of the same ticker+date resumes a graph
            # that has nothing left to do.
            clear_checkpoint(
                config["data_cache_dir"], ticker, str(trade_date),
                ta._run_signature(asset_type),
            )

        return final_state, signal
    finally:
        if getattr(ta, "_checkpointer_ctx", None) is not None:
            ta._checkpointer_ctx.__exit__(None, None, None)
            ta._checkpointer_ctx = None
            ta.graph = ta.workflow.compile()


def run_analysis(job_id: str, ticker: str, trade_date: str, registry: Any, store: Any,
                 graph_factory: Callable[[], Any] | None = None) -> None:
    """Worker-thread entry point: run one analysis end to end.

    ``graph_factory`` exists so tests can supply a stand-in graph; production
    passes nothing and gets a real ``TradingAgentsGraph``.
    """
    def emit(event: dict) -> None:
        registry.push(job_id, event)

    emit({
        "type": "status",
        "status": "initializing",
        "message": f"正在初始化分析引擎 — {ticker} @ {trade_date}",
    })

    try:
        if graph_factory is None:
            graph_factory = _default_graph_factory
        ta = graph_factory()

        final_state, signal = stream_analysis(ta, ticker, trade_date, emit)
        decision_text = final_state.get("final_trade_decision", "")

        store.mark_completed(job_id, build_result(final_state, decision_text, signal), str(signal))
        registry.set_status(job_id, "completed")
        emit({"type": "complete", "signal": signal, "message": "分析完成"})

    except Exception as exc:  # noqa: BLE001 - surfaced to the UI, then logged
        logger.exception("Analysis job %s failed", job_id)
        store.mark_failed(job_id, str(exc))
        registry.set_status(job_id, "failed")
        emit({"type": "error", "message": f"分析失败: {exc}"})


def _default_graph_factory() -> Any:
    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    return TradingAgentsGraph(
        selected_analysts=DEFAULT_ANALYSTS,
        debug=False,          # this module drives the streaming itself
        config=DEFAULT_CONFIG.copy(),
    )
