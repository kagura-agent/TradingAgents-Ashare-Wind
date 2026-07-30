"""Backwards-compatibility shim for the renamed module.

The agent is now ``sentiment_analyst``. In this A-share build it aggregates
Wind news, market context, and company-event blocks into a single sentiment
report. Import from ``tradingagents.agents.analysts.sentiment_analyst`` going
forward; this module will be removed in a future release.
"""

import warnings as _warnings

from tradingagents.agents.analysts.sentiment_analyst import (  # noqa: F401
    create_sentiment_analyst,
    create_social_media_analyst,
)

_warnings.warn(
    "tradingagents.agents.analysts.social_media_analyst is deprecated. "
    "Import from tradingagents.agents.analysts.sentiment_analyst instead.",
    DeprecationWarning,
    stacklevel=2,
)
