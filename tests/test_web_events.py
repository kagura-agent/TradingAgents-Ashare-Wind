"""Event derivation from LangGraph state updates.

``get_graph_args()`` streams with ``stream_mode="updates"``, so every chunk is
a per-node state delta. The runner unpacks `{node_name: state_delta}` and passes
``active_node`` to ``feed()``. Node lifecycle events (node_start / node_complete)
are driven entirely by ``active_node`` transitions.
"""

import pytest

from web.events import EVENT_TYPES, REPORT_KEYS, AnalysisEventDeriver, label_for


def _types(events):
    return [e["type"] for e in events]


@pytest.mark.unit
def test_report_emits_start_and_report():
    d = AnalysisEventDeriver()
    events = d.feed({"market_report": "# 技术面"}, active_node="Market Analyst")

    assert _types(events) == ["node_start", "report"]
    assert events[0]["node"] == "Market Analyst"
    assert events[0]["label"] == "市场分析师"
    assert events[1]["report_key"] == "market_report"
    assert events[1]["content"] == "# 技术面"


@pytest.mark.unit
def test_repeating_the_same_state_emits_nothing():
    d = AnalysisEventDeriver()
    chunk = {"market_report": "A", "sentiment_report": "B"}

    first = d.feed(chunk, active_node="Market Analyst")
    assert len(first) > 0
    assert d.feed(dict(chunk), active_node="Market Analyst") == []


@pytest.mark.unit
def test_new_node_emits_complete_for_previous():
    d = AnalysisEventDeriver()
    d.feed({"market_report": "A"}, active_node="Market Analyst")
    events = d.feed({"news_report": "N"}, active_node="News Analyst")

    assert events[0] == {"type": "node_complete", "node": "Market Analyst", "label": "市场分析师"}
    assert events[1] == {"type": "node_start", "node": "News Analyst", "label": "新闻分析师"}
    reports = [e for e in events if e["type"] == "report"]
    assert [r["report_key"] for r in reports] == ["news_report"]


@pytest.mark.unit
def test_reports_in_one_chunk_follow_report_keys_order():
    d = AnalysisEventDeriver()
    events = d.feed({key: f"content-{key}" for key in REPORT_KEYS},
                    active_node="Market Analyst")

    emitted = [e["report_key"] for e in events if e["type"] == "report"]
    assert emitted == list(REPORT_KEYS)


@pytest.mark.unit
def test_debate_history_emits_only_the_new_tail():
    d = AnalysisEventDeriver()
    d.feed({"investment_debate_state": {"bull_history": "round one"}},
           active_node="Bull Researcher")
    events = d.feed({"investment_debate_state": {"bull_history": "round one\nround two"}},
                    active_node="Bull Researcher")

    debates = [e for e in events if e["type"] == "debate"]
    assert len(debates) == 1
    assert debates[0]["content"] == "\nround two"
    assert debates[0]["speaker"] == "Bull Researcher"
    assert debates[0]["phase"] == "investment"


@pytest.mark.unit
def test_shrinking_history_emits_nothing():
    """A resumed checkpoint can replay an earlier, shorter state."""
    d = AnalysisEventDeriver()
    d.feed({"investment_debate_state": {"bull_history": "aaaa"}},
           active_node="Bull Researcher")
    assert d.feed({"investment_debate_state": {"bull_history": "aa"}},
                  active_node="Bull Researcher") == []


@pytest.mark.unit
def test_investment_judgement_emitted_once():
    d = AnalysisEventDeriver()
    first = d.feed({"investment_debate_state": {"judge_decision": "verdict"}},
                   active_node="Research Manager")
    second = d.feed({"investment_debate_state": {"judge_decision": "verdict"}},
                    active_node="Research Manager")

    assert [e["type"] for e in first if e["type"] == "debate_decision"] == ["debate_decision"]
    assert second == []


@pytest.mark.unit
def test_risk_debate_covers_all_three_speakers():
    d = AnalysisEventDeriver()
    events = d.feed({"risk_debate_state": {
        "aggressive_history": "A",
        "conservative_history": "C",
        "neutral_history": "N",
    }}, active_node="Aggressive Analyst")

    speakers = [e["speaker"] for e in events if e["type"] == "debate"]
    assert speakers == ["Aggressive Analyst", "Conservative Analyst", "Neutral Analyst"]
    assert all(e["phase"] == "risk" for e in events if e["type"] == "debate")


@pytest.mark.unit
def test_risk_speakers_track_independent_offsets():
    """One speaker growing must not consume another's slice offset."""
    d = AnalysisEventDeriver()
    d.feed({"risk_debate_state": {"aggressive_history": "AAA"}},
           active_node="Aggressive Analyst")
    events = d.feed({"risk_debate_state": {
        "aggressive_history": "AAA",
        "conservative_history": "CCCCC",
    }}, active_node="Conservative Analyst")

    debates = [e for e in events if e["type"] == "debate"]
    assert len(debates) == 1
    assert debates[0]["content"] == "CCCCC"


@pytest.mark.unit
def test_trader_plan_emitted_once():
    d = AnalysisEventDeriver()
    first = d.feed({"trader_investment_plan": "plan"}, active_node="Trader")
    assert "node_start" in _types(first)
    assert "trader_plan" in _types(first)
    assert d.feed({"trader_investment_plan": "plan"}, active_node="Trader") == []


@pytest.mark.unit
def test_decision_emitted_once_and_closes_the_active_node():
    d = AnalysisEventDeriver()
    d.feed({"risk_debate_state": {"aggressive_history": "A"}},
           active_node="Aggressive Analyst")
    events = d.feed({"final_trade_decision": "Overweight ..."},
                    active_node="Portfolio Manager")

    assert "node_complete" in _types(events)
    assert "decision" in _types(events)
    # The node_complete should be for the previous node (Aggressive Analyst)
    complete_evt = next(e for e in events if e["type"] == "node_complete")
    assert complete_evt["node"] == "Aggressive Analyst"
    # decision calls _exit internally, so re-feeding same node re-emits node_start
    # but no duplicate decision content
    repeat = d.feed({"final_trade_decision": "Overweight ..."},
                    active_node="Portfolio Manager")
    assert "decision" not in _types(repeat)


@pytest.mark.unit
def test_node_start_and_complete_are_balanced_over_a_full_run():
    d = AnalysisEventDeriver()
    events = []
    steps = [
        ({"market_report": "M"}, "Market Analyst"),
        ({"news_report": "N"}, "News Analyst"),
        ({"investment_debate_state": {"bull_history": "B"}}, "Bull Researcher"),
        ({"investment_debate_state": {"bear_history": "b"}}, "Bear Researcher"),
        ({"investment_debate_state": {"judge_decision": "J"}}, "Research Manager"),
        ({"trader_investment_plan": "P"}, "Trader"),
        ({"risk_debate_state": {"aggressive_history": "A"}}, "Aggressive Analyst"),
        ({"final_trade_decision": "D"}, "Portfolio Manager"),
    ]
    for chunk, node in steps:
        events.extend(d.feed(chunk, active_node=node))
    events.extend(d.finalize())

    starts = _types(events).count("node_start")
    completes = _types(events).count("node_complete")
    assert starts == completes

    depth = 0
    for kind in _types(events):
        if kind == "node_start":
            depth += 1
        elif kind == "node_complete":
            depth -= 1
        assert depth in (0, 1)
    assert depth == 0


@pytest.mark.unit
def test_finalize_closes_a_still_running_node():
    d = AnalysisEventDeriver()
    d.feed({"risk_debate_state": {"neutral_history": "N"}},
           active_node="Neutral Analyst")
    events = d.finalize()

    assert _types(events) == ["node_complete"]
    assert events[0]["node"] == "Neutral Analyst"
    assert d.finalize() == []


@pytest.mark.unit
def test_non_dict_and_empty_chunks_are_ignored():
    d = AnalysisEventDeriver()
    assert d.feed(None) == []
    assert d.feed([1, 2]) == []
    assert d.feed({}) == []
    assert d.feed({"market_report": ""}, active_node="Market Analyst") == [
        {"type": "node_start", "node": "Market Analyst", "label": "市场分析师"},
    ]


@pytest.mark.unit
def test_every_emitted_type_is_declared_in_event_types():
    d = AnalysisEventDeriver()
    events = []
    steps = [
        ({"market_report": "M"}, "Market Analyst"),
        ({"investment_debate_state": {"bull_history": "B", "judge_decision": "J"}}, "Research Manager"),
        ({"trader_investment_plan": "P"}, "Trader"),
        ({"risk_debate_state": {"neutral_history": "N", "judge_decision": "RJ"}}, "Portfolio Manager"),
        ({"final_trade_decision": "D"}, "Portfolio Manager"),
    ]
    for chunk, node in steps:
        events.extend(d.feed(chunk, active_node=node))
    events.extend(d.finalize())

    assert {e["type"] for e in events} <= set(EVENT_TYPES)


@pytest.mark.unit
def test_label_for_falls_back_to_the_raw_node_name():
    assert label_for("Market Analyst") == "市场分析师"
    assert label_for("Unknown Node") == "Unknown Node"


@pytest.mark.unit
def test_tool_nodes_are_ignored():
    """Internal tool nodes should not trigger node_start."""
    d = AnalysisEventDeriver()
    d.feed({"market_report": "M"}, active_node="Market Analyst")
    events = d.feed({}, active_node="tools")
    assert events == []
    assert d._active_node == "Market Analyst"


@pytest.mark.unit
def test_underscore_nodes_are_ignored():
    d = AnalysisEventDeriver()
    d.feed({"market_report": "M"}, active_node="Market Analyst")
    events = d.feed({}, active_node="__end__")
    assert events == []
    assert d._active_node == "Market Analyst"


@pytest.mark.unit
def test_feed_without_active_node_still_processes_content():
    """Backward compat: feed without active_node emits content but no lifecycle."""
    d = AnalysisEventDeriver()
    events = d.feed({"market_report": "M"})
    assert [e["type"] for e in events] == ["report"]
