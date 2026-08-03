"""Scripted analysis replay for UI work.

A real run costs three to ten minutes and a pile of API quota, which makes it a
terrible loop for building a frontend. Setting ``TRADINGAGENTS_WEB_DEMO=1``
makes ``POST /api/analyze`` replay the fixture below instead of calling the
graph.

The fixture is a list of *full state snapshots*, not events — exactly the shape
``graph.stream(..., stream_mode="values")`` yields — so the demo drives the same
:class:`~web.events.AnalysisEventDeriver` and :func:`~web.runner.build_result`
as production. A demo that bypassed those would be worth very little.

The content is deliberately representative rather than minimal: the market
report carries a GFM table (the frontend must render it as a real ``<table>``),
the debates arrive in rounds (so history slicing is exercised), and the decision
carries a canonical 5-tier rating.
"""

from __future__ import annotations

import time
from typing import Any

from .events import AnalysisEventDeriver
from .runner import build_result

# One of RATINGS_5_TIER (tradingagents/agents/utils/rating.py). The frontend
# renders the badge from this, never from parsing the decision text.
DEMO_SIGNAL = "Overweight"

# Seconds between snapshots. Small enough to stay a fast dev loop, large enough
# that streaming behaviour (timeline transitions, incremental debate text) is
# actually visible.
DEMO_STEP_DELAY = 0.4

_MARKET_REPORT = """\
## 技术面分析

近 60 个交易日价格重心持续上移，成交量在突破前高时同步放大，属于量价配合的健康形态。

| 指标 | 当前值 | 5 日均值 | 信号 |
| --- | ---: | ---: | --- |
| 收盘价 | 1,682.00 | 1,655.40 | 多头 |
| MA20 | 1,610.25 | 1,598.10 | 多头排列 |
| RSI(14) | 61.3 | 58.7 | 中性偏强 |
| MACD | 12.84 | 9.51 | 金叉延续 |
| 成交量(万手) | 3.12 | 2.68 | 放量 |

**支撑与压力**：下方 1,610 为 MA20 与前期平台重叠支撑；上方 1,720 为年内高点压力。
"""

_SENTIMENT_REPORT = """\
## 舆情分析

雪球与东方财富股吧一周讨论量环比 +38%，情绪指数由 0.41 回升至 0.63（中性偏乐观）。
主要讨论集中在渠道库存去化与提价预期，未见显著的负面事件驱动。
"""

_NEWS_REPORT = """\
## 新闻摘要

| 日期 | 事件 | 影响 |
| --- | --- | --- |
| 07-28 | 公司披露经销商大会纪要，全年目标不变 | 正面 |
| 07-29 | 行业协会发布上半年产量数据，同比 +4.1% | 中性 |
| 07-30 | 北向资金连续三日净买入 | 正面 |

整体新闻面偏正面，无监管或诉讼类风险事件。
"""

_FUNDAMENTALS_REPORT = """\
## 基本面

| 财务指标 | 最新 | 同比 |
| --- | ---: | ---: |
| 营业收入(亿元) | 428.6 | +11.2% |
| 归母净利润(亿元) | 210.3 | +13.5% |
| 毛利率 | 91.6% | +0.4pct |
| ROE(TTM) | 30.2% | +1.1pct |
| 经营现金流(亿元) | 246.8 | +8.7% |

盈利质量稳健，现金流覆盖净利润，资产负债表无明显压力。
"""

_ANNUAL_REPORT = """\
## 年报要点

- 管理层讨论中将"渠道数字化"列为未来三年首要投入方向
- 分红率维持在 51.9%，与上一年度持平
- 审计意见为标准无保留意见
- 风险提示新增"原材料价格波动"一项
"""

_INDUSTRY_REPORT = """\
## 产业链

上游基酒产能利用率维持高位，包装材料价格同比回落约 6%，成本端小幅利好。
中游渠道库存约 1.8 个月，处于健康区间。下游终端动销在节假日前有季节性回补。
"""

_BULL_R1 = "多头研究员：基本面与技术面同向，营收利润双位数增长且现金流扎实，估值处于近三年 35% 分位，具备向上修复空间。"
_BEAR_R1 = "空头研究员：需求端复苏并不均衡，渠道库存虽健康但终端动销仍依赖节假日脉冲，估值修复的前提假设偏乐观。"
_BULL_R2 = "多头研究员：即便按保守假设给到个位数增长，当前价格隐含的预期也已足够低，下行空间有限。"
_BEAR_R2 = "空头研究员：下行空间有限不等于上行确定，若三季度动销不及预期，估值分位会同步下修。"

_INVEST_JUDGE = """\
## 研究主管裁决

双方分歧集中在需求复苏的持续性。多头对盈利质量的论证更具数据支撑，空头对动销的担忧
是有效的风险边界而非否定理由。建议**建立仓位但不打满**，以三季度动销数据作为加仓触发条件。
"""

_TRADER_PLAN = """\
## 交易计划

- 首笔建仓 4%，1,610-1,640 区间分两笔完成
- 跌破 1,585（MA20 下方 1.5%）无条件止损
- 三季度动销数据兑现后可加仓至 7%
- 目标区间 1,780-1,820，触及后减半仓
"""

_RISK_AGG = "激进风控：趋势与基本面共振时仓位过轻本身就是风险，建议首笔提高到 6%。"
_RISK_CON = "保守风控：单一标的 7% 上限偏高，且止损位距离建仓区间过近，容易被日内波动扫出。"
_RISK_NEU = "中性风控：维持 4% 首笔，但止损放宽至 1,570，用仓位而非止损距离来控制风险敞口。"

_RISK_JUDGE = """\
## 组合经理裁决

采纳中性方案：首笔 4%、止损 1,570、上限 7%。激进方案在动销数据未兑现前缺乏依据，
保守方案的止损担忧已通过放宽止损位解决。
"""

_FINAL_DECISION = """\
## 最终决策：Overweight（增持）

**理由**：盈利质量与现金流稳健，技术面量价配合，估值处于历史中低分位；主要不确定性
（终端动销）已通过分批建仓与明确止损位纳入管理。

**执行**：首笔 4%，区间 1,610-1,640；止损 1,570；动销数据兑现后加仓至 7%；
目标区间 1,780-1,820。
"""


def demo_chunks(ticker: str, trade_date: str) -> list[tuple[str, dict[str, Any]]]:
    """Per-node state deltas imitating ``stream_mode="updates"`` output.

    Each entry is ``(node_name, state_delta)`` — the same shape the real runner
    unpacks from ``{node_name: state_delta}`` chunks.
    """
    out: list[tuple[str, dict[str, Any]]] = []

    out.append(("Market Analyst", {"market_report": _MARKET_REPORT}))
    out.append(("Sentiment Analyst", {"sentiment_report": _SENTIMENT_REPORT}))
    out.append(("News Analyst", {"news_report": _NEWS_REPORT}))
    out.append(("Fundamentals Analyst", {"fundamentals_report": _FUNDAMENTALS_REPORT}))
    out.append(("Annual Report Analyst", {"annual_report": _ANNUAL_REPORT}))
    out.append(("Industry Chain Analyst", {"industry_report": _INDUSTRY_REPORT}))

    bull, bear = _BULL_R1, _BEAR_R1
    out.append(("Bull Researcher", {"investment_debate_state": {"bull_history": bull}}))
    out.append(("Bear Researcher", {"investment_debate_state": {"bear_history": bear}}))
    bull += "\n\n" + _BULL_R2
    bear += "\n\n" + _BEAR_R2
    out.append(("Bull Researcher", {"investment_debate_state": {"bull_history": bull}}))
    out.append(("Bear Researcher", {"investment_debate_state": {"bear_history": bear}}))
    out.append(("Research Manager", {"investment_debate_state": {"judge_decision": _INVEST_JUDGE}}))

    out.append(("Trader", {"trader_investment_plan": _TRADER_PLAN}))

    out.append(("Aggressive Analyst", {"risk_debate_state": {"aggressive_history": _RISK_AGG}}))
    out.append(("Conservative Analyst", {"risk_debate_state": {"conservative_history": _RISK_CON}}))
    out.append(("Neutral Analyst", {"risk_debate_state": {"neutral_history": _RISK_NEU}}))
    out.append(("Portfolio Manager", {"risk_debate_state": {"judge_decision": _RISK_JUDGE}}))

    out.append(("Portfolio Manager", {"final_trade_decision": _FINAL_DECISION}))
    return out


def run_demo_analysis(job_id: str, ticker: str, trade_date: str, registry: Any, store: Any,
                      step_delay: float | None = None) -> None:
    """Worker-thread entry point mirroring :func:`web.runner.run_analysis`.

    ``step_delay`` defaults to :data:`DEMO_STEP_DELAY` at *call* time rather
    than as a default argument, so tests can set the module constant to 0 and
    replay the whole fixture without sleeping.
    """
    if step_delay is None:
        step_delay = DEMO_STEP_DELAY

    def emit(event: dict) -> None:
        registry.push(job_id, event)

    emit({
        "type": "status",
        "status": "initializing",
        "message": f"[演示模式] 正在初始化 — {ticker} @ {trade_date}",
    })
    emit({"type": "status", "status": "running", "message": "[演示模式] 回放示例分析…"})

    deriver = AnalysisEventDeriver()
    final_state: dict[str, Any] = {}
    for node_name, state_delta in demo_chunks(ticker, trade_date):
        if step_delay:
            time.sleep(step_delay)
        final_state.update(state_delta)
        for event in deriver.feed(state_delta, active_node=node_name):
            emit(event)
    for event in deriver.finalize():
        emit(event)

    decision_text = final_state.get("final_trade_decision", "")
    result = build_result(final_state, decision_text, DEMO_SIGNAL)
    store.mark_completed(job_id, result, DEMO_SIGNAL)
    registry.set_status(job_id, "completed")
    emit({"type": "complete", "signal": DEMO_SIGNAL, "message": "分析完成（演示模式）"})
