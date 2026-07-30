from typing import Annotated

from langchain_core.tools import tool

from tradingagents.dataflows.config import get_config
from tradingagents.dataflows.interface import route_to_vendor


@tool
def get_prediction_markets(
    topic: Annotated[
        str,
        "Disabled in the A-share Wind build; use Wind news, policy, sector, "
        "and market data instead.",
    ],
    limit: Annotated[int | None, "Max markets to return; omit for a default of 6"] = None,
) -> str:
    """
    Prediction markets are disabled in the A-share Wind build because they are
    not a reliable China-market signal source. This tool returns a clear
    unavailable sentinel instead of calling external prediction-market services.

    Args:
        topic (str): Event keyword(s) to search
        limit (int): Max markets to return; omit for a default of 6

    Returns:
        str: A formatted markdown report of matching prediction markets
    """
    if get_config().get("data_vendors", {}).get("prediction_markets") == "disabled":
        return (
            "DATA_UNAVAILABLE: prediction-market tools are disabled in the "
            "A-share Wind build. Use Wind news, announcements, policy, sector, "
            "and market data instead; do not fabricate Polymarket-style odds."
        )
    return route_to_vendor("get_prediction_markets", topic, limit)
