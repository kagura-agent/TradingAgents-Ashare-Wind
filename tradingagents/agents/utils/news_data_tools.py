from typing import Annotated

from langchain_core.tools import tool

from tradingagents.dataflows.interface import route_to_vendor


@tool
def get_news(
    ticker: Annotated[str, "Ticker symbol"],
    start_date: Annotated[str, "Start date in yyyy-mm-dd format"],
    end_date: Annotated[str, "End date in yyyy-mm-dd format"],
) -> str:
    """
    Retrieve news data for a given ticker symbol.
    Uses the configured news_data vendor.
    Args:
        ticker (str): Ticker symbol
        start_date (str): Start date in yyyy-mm-dd format
        end_date (str): End date in yyyy-mm-dd format
    Returns:
        str: A formatted string containing news data
    """
    return route_to_vendor("get_news", ticker, start_date, end_date)

@tool
def get_global_news(
    curr_date: Annotated[str, "Current date in yyyy-mm-dd format"],
    look_back_days: Annotated[int | None, "Days to look back; omit to use the configured default"] = None,
    limit: Annotated[int | None, "Max articles to return; omit to use the configured default"] = None,
) -> str:
    """
    Retrieve global news data.
    Uses the configured news_data vendor. Defaults for look_back_days and
    limit come from DEFAULT_CONFIG (global_news_lookback_days,
    global_news_article_limit); pass explicit values to override.

    Args:
        curr_date (str): Current date in yyyy-mm-dd format
        look_back_days (int): Number of days to look back; omit to inherit config
        limit (int): Maximum number of articles to return; omit to inherit config

    Returns:
        str: A formatted string containing global news data
    """
    return route_to_vendor("get_global_news", curr_date, look_back_days, limit)

@tool
def get_insider_transactions(
    ticker: Annotated[str, "ticker symbol"],
    curr_date: Annotated[str, "Current analysis date in yyyy-mm-dd format. Required for backtesting to avoid look-ahead bias."] = "",
) -> str:
    """
    Retrieve insider transaction information about a company.
    Uses the configured news_data vendor.
    Args:
        ticker (str): Ticker symbol of the company
        curr_date (str): Analysis date cutoff. When provided, events are
            restricted to those available as of this date. When empty,
            returns the latest available data (live/real-time mode).
    Returns:
        str: A report of insider transaction data
    """
    return route_to_vendor("get_insider_transactions", ticker, curr_date or None)


@tool
def get_earnings_preannouncements(
    ticker: Annotated[str, "ticker symbol"],
    curr_date: Annotated[str, "Current date in yyyy-mm-dd format"],
    look_back_days: Annotated[int, "Days to look back for earnings previews, alerts, and preliminary results"] = 180,
) -> str:
    """
    Retrieve A-share earnings preannouncements, preliminary results, revisions,
    and earnings alert disclosures before the current analysis date.
    Uses the configured news_data vendor.
    """
    return route_to_vendor("get_earnings_preannouncements", ticker, curr_date, look_back_days)


@tool
def get_industry_chain_context(
    ticker: Annotated[str, "ticker symbol"],
    curr_date: Annotated[str, "Current date in yyyy-mm-dd format"],
    look_back_days: Annotated[int, "Days to look back for industry-chain news, policies, and events"] = 180,
) -> str:
    """
    Retrieve A-share industry-chain context: industry positioning, upstream and
    downstream drivers, peers, policy themes, sector heat, comparable companies,
    and supply-chain events.
    """
    return route_to_vendor("get_industry_chain_context", ticker, curr_date, look_back_days)
