from __future__ import annotations

from datetime import datetime

SECTION_KEYS = (
    ("Market Analyst", "market_report", 3500),
    ("Sentiment Analyst", "sentiment_report", 3500),
    ("News Analyst", "news_report", 3500),
    ("Fundamentals Analyst", "fundamentals_report", 4500),
    ("Annual Report Analyst", "annual_report", 5000),
    ("Industry Chain Analyst", "industry_report", 4500),
    ("Research Manager", "investment_plan", 3500),
    ("Trader", "trader_investment_plan", 2500),
    ("Portfolio Manager", "final_trade_decision", 3500),
)


def _clip(text: str, limit: int) -> str:
    text = str(text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n...[TRUNCATED_FOR_REVIEW]"


def _section_text(final_state: dict) -> str:
    parts = []
    for title, key, limit in SECTION_KEYS:
        if final_state.get(key):
            parts.append(f"## {title}\n{_clip(final_state[key], limit)}")

    debate = final_state.get("investment_debate_state") or {}
    if debate.get("bull_history") or debate.get("bear_history"):
        parts.append(
            "## Research Debate\n"
            + _clip(
                f"Bull:\n{debate.get('bull_history', '')}\n\nBear:\n{debate.get('bear_history', '')}",
                4000,
            )
        )

    risk = final_state.get("risk_debate_state") or {}
    if risk.get("aggressive_history") or risk.get("conservative_history") or risk.get("neutral_history"):
        parts.append(
            "## Risk Debate\n"
            + _clip(
                "Aggressive:\n"
                + str(risk.get("aggressive_history", ""))
                + "\n\nConservative:\n"
                + str(risk.get("conservative_history", ""))
                + "\n\nNeutral:\n"
                + str(risk.get("neutral_history", "")),
                4500,
            )
        )
    return "\n\n".join(parts)


def run_ai_report_review(llm, final_state: dict, ticker: str, trade_date: str) -> str:
    """Ask a lightweight reviewer LLM to audit the finished report.

    This is post-processing: failures should be caught by the caller so report
    saving never depends on another LLM call.
    """
    context = _section_text(final_state)
    prompt = f"""You are a skeptical investment-report reviewer for an A-share Wind-based TradingAgents report.

Ticker: {ticker}
Analysis date: {trade_date}
Generated at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

Review the report sections below. Do not write a new investment report. Audit the quality of the existing report.

Focus on:
1. Evidence/claim conflicts.
2. Missing data that may have been treated as fact.
3. Future-data leakage relative to the analysis date.
4. Overconfident language, especially around data completeness.
5. Non-China data-source residue or claims unsupported by Wind evidence.
6. Internal disagreement between analysts, trader, risk team, and portfolio manager.
7. Position-sizing language that is unsafe without real account context.
8. The strongest reason to trust the final rating and the strongest reason to distrust it.

Output in Chinese. Use this exact Markdown structure:

# AI Report Review

## Verdict
One of: PASS / REVIEW_NEEDED / HIGH_RISK

## Key Findings
A concise bullet list. Include severity tags [High], [Medium], [Low].

## Evidence Conflicts
Bullets for contradictions or say "未发现明确冲突".

## Data Gaps
Bullets for unavailable or weakly sourced data.

## Final Rating Check
State whether the final rating is supported, partially supported, or weakly supported.

## Follow-up Checks
Concrete checks the user should perform before relying on the report.

<REPORT_SECTIONS>
{context}
</REPORT_SECTIONS>
"""
    response = llm.invoke(prompt)
    return str(getattr(response, "content", response)).strip()
