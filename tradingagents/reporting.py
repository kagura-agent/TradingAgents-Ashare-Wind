"""Reusable report-tree writer shared by the CLI and the programmatic API.

Writes a run's per-section markdown (analysts, research, trading, risk,
portfolio) plus a consolidated ``complete_report.md`` under ``save_path``. The
CLI and ``TradingAgentsGraph.save_reports`` both call this, so a headless / API
run produces the same on-disk report tree a CLI run does.
"""

import re
from datetime import datetime
from pathlib import Path

NON_CHINA_SERVICE_TERMS = (
    "Yahoo",
    "yfinance",
    "Reddit",
    "StockTwits",
    "FRED",
    "Polymarket",
    "Alpha Vantage",
)

OVERCONFIDENT_DATA_PHRASES = (
    "数据已全部获取",
    "全部所需数据",
    "all data has been obtained",
    "data is complete",
)

KNOWN_A_SHARE_NAME_CONFLICTS = (
    ("东山精密", "苏州固锝"),
)


def _collect_text(final_state: dict) -> str:
    parts = []
    for key in ("market_report", "sentiment_report", "news_report", "fundamentals_report", "annual_report", "industry_report", "trader_investment_plan", "final_trade_decision"):
        if final_state.get(key):
            parts.append(str(final_state[key]))
    debate = final_state.get("investment_debate_state") or {}
    for key in ("bull_history", "bear_history", "judge_decision"):
        if debate.get(key):
            parts.append(str(debate[key]))
    risk = final_state.get("risk_debate_state") or {}
    for key in ("aggressive_history", "conservative_history", "neutral_history", "judge_decision"):
        if risk.get(key):
            parts.append(str(risk[key]))
    return "\n\n".join(parts)


def _extract_final_proposals(text: str) -> list[str]:
    proposals = []
    for match in re.finditer(r"FINAL TRANSACTION PROPOSAL:\s*\**\s*(BUY|HOLD|SELL)\b", text, flags=re.IGNORECASE):
        proposals.append(match.group(1).upper())
    return proposals


def build_quality_review(final_state: dict) -> str:
    text = _collect_text(final_state)
    proposals = _extract_final_proposals(text)
    missing_sections = [
        name
        for key, name in (
            ("market_report", "Market Analyst"),
            ("sentiment_report", "Sentiment Analyst"),
            ("news_report", "News Analyst"),
            ("fundamentals_report", "Fundamentals Analyst"),
            ("trader_investment_plan", "Trader"),
            ("final_trade_decision", "Portfolio Manager"),
        )
        if not final_state.get(key)
    ]
    non_china_hits = [term for term in NON_CHINA_SERVICE_TERMS if term.lower() in text.lower()]
    identity_conflicts = [
        f"{a} / {b}"
        for a, b in KNOWN_A_SHARE_NAME_CONFLICTS
        if a in text and b in text
    ]
    overconfident_hits = [term for term in OVERCONFIDENT_DATA_PHRASES if term.lower() in text.lower()]
    data_unavailable_count = text.count("DATA_UNAVAILABLE")
    no_data_count = text.count("NO_DATA_AVAILABLE")
    rating_match = re.search(
        r"\*\*(?:Rating|评级):?\*\*:?\s*([^\n]+)",
        str(final_state.get("final_trade_decision") or ""),
        flags=re.IGNORECASE,
    )
    final_rating = rating_match.group(1).strip() if rating_match else "Not parsed"

    checks = [
        ("Missing sections", "PASS" if not missing_sections else "WARN", ", ".join(missing_sections) or "All expected sections are present."),
        ("Non-China service residue", "PASS" if not non_china_hits else "WARN", ", ".join(non_china_hits) or "No Yahoo/Reddit/StockTwits/FRED/Polymarket residue detected."),
        ("Instrument identity consistency", "PASS" if not identity_conflicts else "WARN", ", ".join(identity_conflicts) or "No known ticker/name conflict detected."),
        ("Overconfident data wording", "PASS" if not overconfident_hits else "WARN", ", ".join(overconfident_hits) or "No overconfident data-completeness wording detected."),
        ("Unavailable data surfaced", "PASS" if data_unavailable_count == 0 and no_data_count == 0 else "INFO", f"DATA_UNAVAILABLE={data_unavailable_count}; NO_DATA_AVAILABLE={no_data_count}."),
        ("Agent proposal consistency", "PASS" if len(set(proposals)) <= 1 else "WARN", f"Proposals found: {', '.join(proposals) if proposals else 'none'}."),
        ("Final portfolio rating", "INFO", final_rating),
        ("Account-context caveat", "INFO", "No real account/position context is wired yet; sizing language should be treated as model portfolio guidance."),
    ]

    lines = [
        "# Report Quality Review",
        "",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "| Check | Status | Detail |",
        "|---|---|---|",
    ]
    for name, status, detail in checks:
        lines.append(f"| {name} | {status} | {detail.replace('|', '/')} |")
    lines.extend(
        [
            "",
            "## Reading Notes",
            "",
            "- `WARN` means the saved report deserves manual review before using the conclusion.",
            "- `INFO` is not necessarily a bug; it records limits such as unavailable data or missing account context.",
            "- This is a deterministic quality pass, not a second investment opinion.",
        ]
    )
    return "\n".join(lines)


def write_report_tree(final_state: dict, ticker: str, save_path) -> Path:
    """Save a completed run's reports to ``save_path``; return the complete-report path."""
    save_path = Path(save_path)
    save_path.mkdir(parents=True, exist_ok=True)
    sections = []

    # 1. Analysts
    analysts_dir = save_path / "1_analysts"
    analyst_parts = []
    if final_state.get("market_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "market.md").write_text(final_state["market_report"], encoding="utf-8")
        analyst_parts.append(("Market Analyst", final_state["market_report"]))
    if final_state.get("sentiment_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "sentiment.md").write_text(final_state["sentiment_report"], encoding="utf-8")
        analyst_parts.append(("Sentiment Analyst", final_state["sentiment_report"]))
    if final_state.get("news_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "news.md").write_text(final_state["news_report"], encoding="utf-8")
        analyst_parts.append(("News Analyst", final_state["news_report"]))
    if final_state.get("fundamentals_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "fundamentals.md").write_text(final_state["fundamentals_report"], encoding="utf-8")
        analyst_parts.append(("Fundamentals Analyst", final_state["fundamentals_report"]))
    if final_state.get("annual_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "annual_report.md").write_text(final_state["annual_report"], encoding="utf-8")
        analyst_parts.append(("Annual Report Analyst", final_state["annual_report"]))
    if final_state.get("industry_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "industry.md").write_text(final_state["industry_report"], encoding="utf-8")
        analyst_parts.append(("Industry Chain Analyst", final_state["industry_report"]))
    if analyst_parts:
        content = "\n\n".join(f"### {name}\n{text}" for name, text in analyst_parts)
        sections.append(f"## I. Analyst Team Reports\n\n{content}")

    # 2. Research
    if final_state.get("investment_debate_state"):
        research_dir = save_path / "2_research"
        debate = final_state["investment_debate_state"]
        research_parts = []
        if debate.get("bull_history"):
            research_dir.mkdir(exist_ok=True)
            (research_dir / "bull.md").write_text(debate["bull_history"], encoding="utf-8")
            research_parts.append(("Bull Researcher", debate["bull_history"]))
        if debate.get("bear_history"):
            research_dir.mkdir(exist_ok=True)
            (research_dir / "bear.md").write_text(debate["bear_history"], encoding="utf-8")
            research_parts.append(("Bear Researcher", debate["bear_history"]))
        if debate.get("judge_decision"):
            research_dir.mkdir(exist_ok=True)
            (research_dir / "manager.md").write_text(debate["judge_decision"], encoding="utf-8")
            research_parts.append(("Research Manager", debate["judge_decision"]))
        if research_parts:
            content = "\n\n".join(f"### {name}\n{text}" for name, text in research_parts)
            sections.append(f"## II. Research Team Decision\n\n{content}")

    # 3. Trading
    if final_state.get("trader_investment_plan"):
        trading_dir = save_path / "3_trading"
        trading_dir.mkdir(exist_ok=True)
        (trading_dir / "trader.md").write_text(final_state["trader_investment_plan"], encoding="utf-8")
        sections.append(f"## III. Trading Team Plan\n\n### Trader\n{final_state['trader_investment_plan']}")

    # 4. Risk Management
    if final_state.get("risk_debate_state"):
        risk_dir = save_path / "4_risk"
        risk = final_state["risk_debate_state"]
        risk_parts = []
        if risk.get("aggressive_history"):
            risk_dir.mkdir(exist_ok=True)
            (risk_dir / "aggressive.md").write_text(risk["aggressive_history"], encoding="utf-8")
            risk_parts.append(("Aggressive Analyst", risk["aggressive_history"]))
        if risk.get("conservative_history"):
            risk_dir.mkdir(exist_ok=True)
            (risk_dir / "conservative.md").write_text(risk["conservative_history"], encoding="utf-8")
            risk_parts.append(("Conservative Analyst", risk["conservative_history"]))
        if risk.get("neutral_history"):
            risk_dir.mkdir(exist_ok=True)
            (risk_dir / "neutral.md").write_text(risk["neutral_history"], encoding="utf-8")
            risk_parts.append(("Neutral Analyst", risk["neutral_history"]))
        if risk_parts:
            content = "\n\n".join(f"### {name}\n{text}" for name, text in risk_parts)
            sections.append(f"## IV. Risk Management Team Decision\n\n{content}")

        # 5. Portfolio Manager
        if risk.get("judge_decision"):
            portfolio_dir = save_path / "5_portfolio"
            portfolio_dir.mkdir(exist_ok=True)
            (portfolio_dir / "decision.md").write_text(risk["judge_decision"], encoding="utf-8")
            sections.append(f"## V. Portfolio Manager Decision\n\n### Portfolio Manager\n{risk['judge_decision']}")

    quality_dir = save_path / "6_quality"
    quality_dir.mkdir(exist_ok=True)
    quality_review = build_quality_review(final_state)
    (quality_dir / "review.md").write_text(quality_review, encoding="utf-8")
    sections.append(f"## VI. Report Quality Review\n\n{quality_review}")
    if final_state.get("ai_quality_review"):
        (quality_dir / "ai_review.md").write_text(final_state["ai_quality_review"], encoding="utf-8")
        sections.append(f"## VII. AI Report Review\n\n{final_state['ai_quality_review']}")

    # Write consolidated report
    header = f"# Trading Analysis Report: {ticker}\n\nGenerated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    (save_path / "complete_report.md").write_text(header + "\n\n".join(sections), encoding="utf-8")
    return save_path / "complete_report.md"
