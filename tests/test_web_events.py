"""Event derivation from LangGraph state snapshots.

``get_graph_args()`` streams with ``stream_mode="values"``, so every chunk is
the *complete accumulated state*. The single property that makes the UI feed
correct is therefore idempotence: re-seeing state that has already been
reported must produce nothing. Most of what follows pins that.
"""

import pytest

from web.events import EVENT_TYPES, REPORT_KEYS, AnalysisEventDeriver, label_for


def _types(events):
    return [e["type"] for e in events]


@pytest.mark.unit
def test_report_emits_start_report_complete_in_order():
    d = AnalysisEventDeriver()
    events = d.feed({"market_report": "# 技术面"})

    assert _types(events) == ["node_start", "report", "node_complete"]
    assert events[0]["node"] == "Market Analyst"
    assert events[0]["label"] == "市场分析师"
    assert events[1]["report_key"] == "market_report"
    assert events[1]["content"] == "# 技术面"


@pytest.mark.unit
def test_repeating_the_same_full_state_emits_nothing():
    """The core stream_mode="values" contract."""
    d = AnalysisEventDeriver()
    chunk = {"market_report": "A", "sentiment_report": "B"}

    first = d.feed(chunk)
    assert len(first) > 0
    assert d.feed(dict(chunk)) == []
    assert d.feed(dict(chunk)) == []


@pytest.mark.unit
def test_accumulating_state_only_reports_the_new_key():
    d = AnalysisEventDeriver()
    d.feed({"market_report": "A"})
    # Second chunk still carries market_report — it must not be re-emitted.
    events = d.feed({"market_report": "A", "news_report": "N"})

    reports = [e for e in events if e["type"] == "report"]
    assert [r["report_key"] for r in reports] == ["news_report"]


@pytest.mark.unit
def test_reports_in_one_chunk_follow_report_keys_order():
    d = AnalysisEventDeriver()
    events = d.feed({key: f"content-{key}" for key in REPORT_KEYS})

    emitted = [e["report_key"] for e in events if e["type"] == "report"]
    assert emitted == list(REPORT_KEYS)


@pytest.mark.unit
def test_debate_history_emits_only_the_new_tail():
    d = AnalysisEventDeriver()
    d.feed({"investment_debate_state": {"bull_history": "round one"}})
    events = d.feed({"investment_debate_state": {"bull_history": "round one\nround two"}})

    debates = [e for e in events if e["type"] == "debate"]
    assert len(debates) == 1
    assert debates[0]["content"] == "\nround two"
    assert debates[0]["speaker"] == "Bull Researcher"
    assert debates[0]["phase"] == "investment"


@pytest.mark.unit
def test_shrinking_history_emits_nothing():
    """A resumed checkpoint can replay an earlier, shorter state."""
    d = AnalysisEventDeriver()
    d.feed({"investment_debate_state": {"bull_history": "aaaa"}})
    assert d.feed({"investment_debate_state": {"bull_history": "aa"}}) == []


@pytest.mark.unit
def test_investment_judgement_emitted_once():
    d = AnalysisEventDeriver()
    first = d.feed({"investment_debate_state": {"judge_decision": "verdict"}})
    second = d.feed({"investment_debate_state": {"judge_decision": "verdict"}})

    assert [e["type"] for e in first if e["type"] == "debate_decision"] == ["debate_decision"]
    assert second == []


@pytest.mark.unit
def test_risk_debate_covers_all_three_speakers():
    d = AnalysisEventDeriver()
    events = d.feed({"risk_debate_state": {
        "aggressive_history": "A",
        "conservative_history": "C",
        "neutral_history": "N",
    }})

    speakers = [e["speaker"] for e in events if e["type"] == "debate"]
    assert speakers == ["Aggressive Analyst", "Conservative Analyst", "Neutral Analyst"]
    assert all(e["phase"] == "risk" for e in events if e["type"] == "debate")


@pytest.mark.unit
def test_risk_speakers_track_independent_offsets():
    """One speaker growing must not consume another's slice offset."""
    d = AnalysisEventDeriver()
    d.feed({"risk_debate_state": {"aggressive_history": "AAA"}})
    events = d.feed({"risk_debate_state": {
        "aggressive_history": "AAA",
        "conservative_history": "CCCCC",
    }})

    debates = [e for e in events if e["type"] == "debate"]
    assert len(debates) == 1
    assert debates[0]["content"] == "CCCCC"


@pytest.mark.unit
def test_trader_plan_emitted_once():
    d = AnalysisEventDeriver()
    first = d.feed({"trader_investment_plan": "plan"})
    assert [e["type"] for e in first] == ["node_start", "trader_plan", "node_complete"]
    assert d.feed({"trader_investment_plan": "plan"}) == []


@pytest.mark.unit
def test_decision_emitted_once_and_closes_the_active_node():
    d = AnalysisEventDeriver()
    d.feed({"risk_debate_state": {"aggressive_history": "A"}})
    events = d.feed({"final_trade_decision": "Overweight ..."})

    assert _types(events) == ["node_complete", "decision"]
    assert events[0]["node"] == "Aggressive Analyst"
    assert d.feed({"final_trade_decision": "Overweight ..."}) == []


@pytest.mark.unit
def test_node_start_and_complete_are_balanced_over_a_full_run():
    d = AnalysisEventDeriver()
    events = []
    for chunk in (
        {"market_report": "M"},
        {"market_report": "M", "news_report": "N"},
        {"investment_debate_state": {"bull_history": "B"}},
        {"investment_debate_state": {"bull_history": "B", "bear_history": "b"}},
        {"investment_debate_state": {"bull_history": "B", "bear_history": "b",
                                     "judge_decision": "J"}},
        {"trader_investment_plan": "P"},
        {"risk_debate_state": {"aggressive_history": "A"}},
        {"final_trade_decision": "D"},
    ):
        events.extend(d.feed(chunk))
    events.extend(d.finalize())

    starts = _types(events).count("node_start")
    completes = _types(events).count("node_complete")
    assert starts == completes

    # And they strictly alternate: no node opens while another is running.
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
    d.feed({"risk_debate_state": {"neutral_history": "N"}})
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
    assert d.feed({"market_report": ""}) == []


@pytest.mark.unit
def test_every_emitted_type_is_declared_in_event_types():
    d = AnalysisEventDeriver()
    events = []
    for chunk in (
        {"market_report": "M"},
        {"investment_debate_state": {"bull_history": "B", "judge_decision": "J"}},
        {"trader_investment_plan": "P"},
        {"risk_debate_state": {"neutral_history": "N", "judge_decision": "RJ"}},
        {"final_trade_decision": "D"},
    ):
        events.extend(d.feed(chunk))
    events.extend(d.finalize())

    assert {e["type"] for e in events} <= set(EVENT_TYPES)


@pytest.mark.unit
def test_label_for_falls_back_to_the_raw_node_name():
    assert label_for("Market Analyst") == "市场分析师"
    assert label_for("Unknown Node") == "Unknown Node"
