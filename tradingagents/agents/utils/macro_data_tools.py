from typing import Annotated

from langchain_core.tools import tool

from tradingagents.dataflows.interface import route_to_vendor


@tool
def get_macro_indicators(
    indicator: Annotated[
        str,
        "China macro or industry indicator query, e.g. '中国CPI同比', "
        "'社会融资规模', '制造业PMI', '人民币汇率', '新能源汽车产销'.",
    ],
    curr_date: Annotated[str, "Current date in yyyy-mm-dd format; the end of the window"],
    look_back_days: Annotated[
        int | None, "Trailing window length in days; omit for a 1-year window"
    ] = None,
) -> str:
    """
    Retrieve a macroeconomic or industry indicator time series using the
    configured macro_data vendor. In the A-share Wind build this routes to Wind
    EDB and should be used for China macro, policy, liquidity, and industry
    context.

    Args:
        indicator (str): Natural-language China macro or industry indicator
        curr_date (str): Current date in yyyy-mm-dd format
        look_back_days (int): Trailing window length; omit for a 1-year window

    Returns:
        str: A formatted markdown report of the macro series
    """
    return route_to_vendor("get_macro_indicators", indicator, curr_date, look_back_days)
