"""Derive UI stream events from LangGraph state snapshots.

The graph is streamed with ``stream_mode="values"`` (see
``GraphPropagator.get_graph_args`` in tradingagents/graph/propagation.py), which
means **every chunk is the complete accumulated state**, not a per-node delta.
A market report written by the first analyst is still present in the chunk
emitted by the last one. So the only way to turn that stream into an
append-only event feed is to remember what has already been emitted and diff
against it — which is exactly what this module does.

Keeping the diffing here, separate from the graph plumbing in
``web/runner.py``, is what makes it testable: ``AnalysisEventDeriver`` performs
no I/O and knows nothing about LangGraph, so its whole contract can be
exercised with hand-built dicts.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Event contract
# ---------------------------------------------------------------------------
# Mirrored by the discriminated union in web/frontend/src/types/events.ts.
# tests/test_web_event_contract.py asserts the two stay in sync — the pair is
# easy to drift apart precisely because nothing else connects them.
EVENT_TYPES: tuple[str, ...] = (
    "status",
    "node_start",
    "node_complete",
    "report",
    "debate",
    "debate_decision",
    "trader_plan",
    "decision",
    "complete",
    "error",
)

# Graph node name -> Chinese label shown in the UI timeline.
NODE_LABELS: dict[str, str] = {
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

# State key -> the analyst node that writes it. Order matters: it drives the
# order reports appear in the UI when several land in the same chunk.
REPORT_KEYS: dict[str, str] = {
    "market_report": "Market Analyst",
    "sentiment_report": "Sentiment Analyst",
    "news_report": "News Analyst",
    "fundamentals_report": "Fundamentals Analyst",
    "annual_report": "Annual Report Analyst",
    "industry_report": "Industry Chain Analyst",
}

# Risk-debate history key -> the node that appends to it.
_RISK_SPEAKERS: tuple[tuple[str, str], ...] = (
    ("aggressive_history", "Aggressive Analyst"),
    ("conservative_history", "Conservative Analyst"),
    ("neutral_history", "Neutral Analyst"),
)

# Investment-debate history key -> the node that appends to it.
_INVEST_SPEAKERS: tuple[tuple[str, str], ...] = (
    ("bull_history", "Bull Researcher"),
    ("bear_history", "Bear Researcher"),
)

# The timeline rendered in the left sidebar, in execution order.
TIMELINE_NODES: tuple[str, ...] = (
    "Market Analyst", "Sentiment Analyst", "News Analyst",
    "Fundamentals Analyst", "Annual Report Analyst", "Industry Chain Analyst",
    "Bull Researcher", "Bear Researcher", "Research Manager",
    "Trader",
    "Aggressive Analyst", "Conservative Analyst", "Neutral Analyst",
    "Portfolio Manager",
)


def label_for(node: str) -> str:
    """Chinese label for a graph node, falling back to the raw name."""
    return NODE_LABELS.get(node, node)


class AnalysisEventDeriver:
    """Turn a stream of full-state snapshots into an append-only event feed.

    Call :meth:`feed` with each chunk from ``graph.stream(...)``; it returns the
    events that chunk newly justifies, in emission order. Feeding the same
    chunk twice yields nothing the second time — the invariant that makes
    ``stream_mode="values"`` usable and the one most worth testing.

    The instance is single-use and not thread-safe: one deriver per analysis
    run, driven by that run's worker thread.
    """

    def __init__(self) -> None:
        self._seen_reports: set[str] = set()
        # Debate histories only ever grow, so the length of what we have
        # already emitted is enough to slice off the new text.
        self._emitted_len: dict[str, int] = {}
        self._seen_judgements: set[str] = set()
        self._had_trader = False
        self._had_decision = False
        self._active_node: str | None = None

    # -- helpers ----------------------------------------------------------
    def _enter(self, node: str, out: list[dict]) -> None:
        """Mark ``node`` as the running one, closing out whichever preceded it."""
        if self._active_node == node:
            return
        if self._active_node is not None:
            out.append({"type": "node_complete", "node": self._active_node,
                        "label": label_for(self._active_node)})
        self._active_node = node
        out.append({"type": "node_start", "node": node, "label": label_for(node)})

    def _exit(self, out: list[dict]) -> None:
        """Close the running node, if any."""
        if self._active_node is None:
            return
        out.append({"type": "node_complete", "node": self._active_node,
                    "label": label_for(self._active_node)})
        self._active_node = None

    def _new_text(self, key: str, history: str) -> str | None:
        """Return the not-yet-emitted tail of a monotonically growing history.

        Returns ``None`` when there is nothing new. A history that somehow
        shrank — a resumed checkpoint replaying an earlier state — also yields
        ``None`` rather than a negative slice or a duplicate re-emission.
        """
        already = self._emitted_len.get(key, 0)
        if not history or len(history) <= already:
            return None
        tail = history[already:]
        self._emitted_len[key] = len(history)
        return tail

    # -- main entry point --------------------------------------------------
    def feed(self, chunk: dict[str, Any]) -> list[dict]:
        """Return the events newly justified by ``chunk``."""
        out: list[dict] = []
        if not isinstance(chunk, dict):
            return out

        self._feed_reports(chunk, out)
        self._feed_investment_debate(chunk, out)
        self._feed_trader(chunk, out)
        self._feed_risk_debate(chunk, out)
        self._feed_decision(chunk, out)
        return out

    def finalize(self) -> list[dict]:
        """Close any node still marked running once the stream ends."""
        out: list[dict] = []
        self._exit(out)
        return out

    # -- per-section handling ---------------------------------------------
    def _feed_reports(self, chunk: dict, out: list[dict]) -> None:
        for key, node in REPORT_KEYS.items():
            content = chunk.get(key) or ""
            if not content or key in self._seen_reports:
                continue
            self._seen_reports.add(key)
            self._enter(node, out)
            out.append({
                "type": "report",
                "node": node,
                "label": label_for(node),
                "report_key": key,
                "content": content,
            })
            self._exit(out)

    def _feed_investment_debate(self, chunk: dict, out: list[dict]) -> None:
        state = chunk.get("investment_debate_state")
        if not isinstance(state, dict):
            return

        for key, node in _INVEST_SPEAKERS:
            text = self._new_text(f"invest.{key}", state.get(key) or "")
            if text is None:
                continue
            self._enter(node, out)
            out.append({
                "type": "debate",
                "phase": "investment",
                "speaker": node,
                "label": label_for(node),
                "content": text,
            })

        judge = state.get("judge_decision") or ""
        if judge and "invest.judge" not in self._seen_judgements:
            self._seen_judgements.add("invest.judge")
            node = "Research Manager"
            self._enter(node, out)
            out.append({
                "type": "debate_decision",
                "phase": "investment",
                "speaker": node,
                "label": label_for(node),
                "content": judge,
            })
            self._exit(out)

    def _feed_trader(self, chunk: dict, out: list[dict]) -> None:
        plan = chunk.get("trader_investment_plan") or ""
        if not plan or self._had_trader:
            return
        self._had_trader = True
        node = "Trader"
        self._enter(node, out)
        out.append({
            "type": "trader_plan",
            "node": node,
            "label": label_for(node),
            "content": plan,
        })
        self._exit(out)

    def _feed_risk_debate(self, chunk: dict, out: list[dict]) -> None:
        state = chunk.get("risk_debate_state")
        if not isinstance(state, dict):
            return

        for key, node in _RISK_SPEAKERS:
            text = self._new_text(f"risk.{key}", state.get(key) or "")
            if text is None:
                continue
            self._enter(node, out)
            out.append({
                "type": "debate",
                "phase": "risk",
                "speaker": node,
                "label": label_for(node),
                "content": text,
            })

        judge = state.get("judge_decision") or ""
        if judge and "risk.judge" not in self._seen_judgements:
            self._seen_judgements.add("risk.judge")
            node = "Portfolio Manager"
            self._enter(node, out)
            out.append({
                "type": "debate_decision",
                "phase": "risk",
                "speaker": node,
                "label": label_for(node),
                "content": judge,
            })

    def _feed_decision(self, chunk: dict, out: list[dict]) -> None:
        final = chunk.get("final_trade_decision") or ""
        if not final or self._had_decision:
            return
        self._had_decision = True
        self._exit(out)
        out.append({"type": "decision", "content": final})
