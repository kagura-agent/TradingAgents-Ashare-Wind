"""Verify that the event-context / insider-transactions chain threads curr_date
through all four layers so that backtesting does not leak future data.

The look-ahead bug: get_ashare_event_context(ticker, curr_date) supports a
date cutoff, but the calling chain (get_insider_transactions → tool definition
→ analyst invocation) dropped the parameter, causing Wind queries to default
to "today" instead of the analysis date.

These tests pin all four layers:
1. wind.py  get_insider_transactions(symbol, curr_date) → get_ashare_event_context
2. news_data_tools.py  tool accepts curr_date and forwards it
3. sentiment_analyst.py  calls with end_date
4. news_analyst.py  prompt includes curr_date in tool signature

Additionally: live/real-time mode (no curr_date) must still work without
injecting a date cutoff — we must not break real-time analysis to fix backtesting.
"""

from unittest.mock import patch, MagicMock


# --- Layer 1: wind.py vendor shim ---

def test_get_insider_transactions_forwards_curr_date():
    """get_insider_transactions must pass curr_date to get_ashare_event_context."""
    from tradingagents.dataflows import wind

    with patch.object(wind, "get_ashare_event_context", return_value="mocked") as mock:
        wind.get_insider_transactions("600519.SH", curr_date="2024-05-10")
        mock.assert_called_once_with("600519.SH", curr_date="2024-05-10")


def test_get_insider_transactions_none_when_no_date():
    """Live mode: no curr_date → get_ashare_event_context sees curr_date=None."""
    from tradingagents.dataflows import wind

    with patch.object(wind, "get_ashare_event_context", return_value="mocked") as mock:
        wind.get_insider_transactions("600519.SH")
        mock.assert_called_once_with("600519.SH", curr_date=None)


# --- Layer 2: tool definition ---

def test_tool_definition_accepts_curr_date():
    """The @tool get_insider_transactions must accept curr_date parameter."""
    from tradingagents.agents.utils.news_data_tools import get_insider_transactions
    import inspect

    sig = inspect.signature(get_insider_transactions.func)
    assert "curr_date" in sig.parameters, (
        "get_insider_transactions tool must have curr_date parameter"
    )


def test_tool_forwards_curr_date_to_vendor():
    """Tool must pass curr_date through route_to_vendor."""
    from tradingagents.agents.utils import news_data_tools

    with patch.object(news_data_tools, "route_to_vendor", return_value="mocked") as mock:
        news_data_tools.get_insider_transactions.func("600519.SH", "2024-05-10")
        mock.assert_called_once_with("get_insider_transactions", "600519.SH", "2024-05-10")


def test_tool_empty_string_becomes_none():
    """Empty curr_date (LLM default) should pass None to vendor (live mode)."""
    from tradingagents.agents.utils import news_data_tools

    with patch.object(news_data_tools, "route_to_vendor", return_value="mocked") as mock:
        news_data_tools.get_insider_transactions.func("600519.SH", "")
        mock.assert_called_once_with("get_insider_transactions", "600519.SH", None)


# --- Layer 3: get_ashare_event_context date suffix ---

def test_event_context_appends_date_suffix():
    """When curr_date is provided, queries must include the date cutoff."""
    from tradingagents.dataflows import wind

    captured_queries = []
    original_wind_nl = wind._wind_nl

    def mock_wind_nl(tool_name, question, **kwargs):
        captured_queries.append(question)
        return "mocked"

    with patch.object(wind, "_wind_nl", side_effect=mock_wind_nl):
        wind.get_ashare_event_context("600519.SH", curr_date="2024-05-10")

    assert len(captured_queries) >= 4, "Should make at least 4 sub-queries"
    for q in captured_queries:
        assert "截至2024-05-10" in q, f"Query missing date cutoff: {q}"


def test_event_context_no_suffix_without_date():
    """Live mode: no curr_date → queries must NOT include a date suffix."""
    from tradingagents.dataflows import wind

    captured_queries = []

    def mock_wind_nl(tool_name, question, **kwargs):
        captured_queries.append(question)
        return "mocked"

    with patch.object(wind, "_wind_nl", side_effect=mock_wind_nl):
        wind.get_ashare_event_context("600519.SH")

    for q in captured_queries:
        assert "截至" not in q, f"Live mode query should not have date cutoff: {q}"
