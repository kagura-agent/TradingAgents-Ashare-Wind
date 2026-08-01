"""A-share sentiment analyst backed by Wind-sourced Chinese market data."""

from datetime import datetime, timedelta

from langchain_core.messages import AIMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from tradingagents.agents.schemas import SentimentReport, render_sentiment_report
from tradingagents.agents.utils.agent_utils import (
    get_earnings_preannouncements,
    get_global_news,
    get_insider_transactions,
    get_instrument_context_from_state,
    get_language_instruction,
    get_news,
)
from tradingagents.agents.utils.structured import (
    bind_structured,
    invoke_structured_or_freetext,
)


def _seven_days_back(trade_date: str) -> str:
    return (datetime.strptime(trade_date, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")


def create_sentiment_analyst(llm):
    """Create an A-share sentiment analyst node for the trading graph."""
    structured_llm = bind_structured(llm, SentimentReport, "Sentiment Analyst")

    def sentiment_analyst_node(state):
        ticker = state["company_of_interest"]
        end_date = state["trade_date"]
        start_date = _seven_days_back(end_date)
        instrument_context = get_instrument_context_from_state(state)

        news_block = get_news.func(ticker, start_date, end_date)
        market_block = get_global_news.func(end_date, 7, 10)
        events_block = get_insider_transactions.func(ticker)
        earnings_block = get_earnings_preannouncements.func(ticker, end_date, 180)

        system_message = _build_system_message(
            ticker=ticker,
            start_date=start_date,
            end_date=end_date,
            news_block=news_block,
            market_block=market_block,
            events_block=events_block,
            earnings_block=earnings_block,
        )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a helpful AI assistant, collaborating with other assistants."
                    " If you or any other assistant has the FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** or deliverable,"
                    " prefix your response with FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** so the team knows to stop."
                    " Today's date is {current_date}; treat it as 'now' for all analysis and tool-call date ranges. {instrument_context}"
                    "\n{system_message}",
                ),
                MessagesPlaceholder(variable_name="messages"),
            ]
        )

        prompt = prompt.partial(system_message=system_message)
        prompt = prompt.partial(current_date=end_date)
        prompt = prompt.partial(instrument_context=instrument_context)

        # Format the template into a concrete message list so the structured
        # and free-text paths receive the same input. No bind_tools — the
        # data is already in the prompt.
        formatted_messages = prompt.format_messages(messages=state["messages"])

        report_text = invoke_structured_or_freetext(
            structured_llm,
            llm,
            formatted_messages,
            render_sentiment_report,
            "Sentiment Analyst",
        )

        return {
            "messages": [AIMessage(content=report_text)],
            "sentiment_report": report_text,
        }

    return sentiment_analyst_node


def _build_system_message(
    *,
    ticker: str,
    start_date: str,
    end_date: str,
    news_block: str,
    market_block: str,
    events_block: str,
    earnings_block: str,
) -> str:
    """Assemble the A-share sentiment system message with structured data blocks."""
    return f"""You are an A-share market sentiment analyst. Produce a comprehensive sentiment report for {ticker} covering {start_date} to {end_date}, using only the Wind-sourced Chinese market data blocks collected below.

## Data sources (pre-fetched, in this prompt)

### Company news and disclosures — Wind, past 7 days
Company-specific media reports, announcements, and event coverage.

<start_of_news>
{news_block}
<end_of_news>

### A-share market and policy context — Wind
Market-wide A-share headlines, policy, industry themes, and macro context.

<start_of_market_context>
{market_block}
<end_of_market_context>

### A-share microstructure, attention, and event proxy — Wind
Margin financing, short selling, Dragon Tiger List, limit-up/limit-down, turnover, abnormal volume, investor-relations or survey events when available, insider/holder changes, repurchases, risk events, and other company events. Treat these as Chinese A-share sentiment proxies when direct retail-platform text (雪球、股吧、同花顺评论) is not available in the data.

<start_of_events>
{events_block}
<end_of_events>

### Earnings preannouncements and preliminary results — Wind
A-share performance forecasts, preliminary results, earnings revisions, and formal-report verification points.

<start_of_earnings_preannouncements>
{earnings_block}
<end_of_earnings_preannouncements>

## How to analyze this data (best practices)

1. **Separate confirmed disclosure from rumor.** Company announcements and exchange disclosures carry more weight than media speculation or market chatter.

2. **Use news tone as a sentiment proxy, not as fact beyond the source.** Label bullish, bearish, and mixed narratives and explain the evidence.

3. **Account for A-share microstructure.** Explicitly discuss margin financing/deleveraging, Dragon Tiger List signals, limit-up/limit-down behavior, abnormal turnover, high成交额/换手率, shareholder changes, repurchases, and regulatory/event risk when present in the data.

4. **Look for policy and sector-theme reinforcement.** A single company headline matters more when it aligns with a broader A-share sector or policy theme.

5. **Identify recurring narrative themes.** What topic keeps appearing across company news, market context, and event data? That is the dominant sentiment driver.

6. **Be honest about data limits.** If a block says DATA_UNAVAILABLE or contains few items, lower confidence and explicitly state the gap. Do not invent social-media opinions, retail posts, or fund-flow data that is not shown. If no direct retail-platform text is provided, say that the report uses Wind news, announcements, financing, turnover, Dragon Tiger List, limit-up/down, and company events as sentiment proxies.

7. **Identify catalysts and risks** from the Wind data: earnings previews, order wins/losses, regulatory actions, repurchases, shareholder changes, sector policy, or abnormal event headlines.

7a. **Treat earnings preannouncements as sentiment catalysts.** Extract the disclosed profit range and YoY range when available, but clearly separate disclosure facts from expectation or price reaction. Flag whether the next formal report must confirm cash flow, margins, and balance-sheet quality.

8. **Past sentiment is not predictive.** Frame conclusions as a signal to weigh alongside fundamentals and technicals, not as a standalone price call.

## Output fields

Fill the following fields:

- **overall_band**: Exactly one of Bullish / Mildly Bullish / Neutral / Mixed / Mildly Bearish / Bearish. Use Mixed when sources point in clearly different directions; Neutral only when all sources are genuinely silent.
- **overall_score**: A number from 0 (maximally bearish) to 10 (maximally bullish); 5 is neutral. Keep it consistent with overall_band.
- **confidence**: low / medium / high, based on data quality and sample size.
- **narrative**: Full source-by-source breakdown, divergences, dominant narrative themes, catalysts and risks, and a markdown summary table of key sentiment signals (direction, source, supporting evidence).

{get_language_instruction()}"""


# ---------------------------------------------------------------------------
# Backwards-compatibility shim
# ---------------------------------------------------------------------------
def create_social_media_analyst(llm):
    """Deprecated alias for :func:`create_sentiment_analyst`.

    Kept so existing code that imports ``create_social_media_analyst``
    continues to work.

    .. deprecated::
        Import :func:`create_sentiment_analyst` directly instead.
    """
    import warnings
    warnings.warn(
        "create_social_media_analyst is deprecated and will be removed in a "
        "future version. Use create_sentiment_analyst instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return create_sentiment_analyst(llm)
