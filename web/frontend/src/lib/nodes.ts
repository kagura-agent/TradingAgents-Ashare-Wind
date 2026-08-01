/**
 * The execution timeline shown in the left column.
 *
 * Mirrors `TIMELINE_NODES` and `NODE_LABELS` in web/events.py; the labels are
 * duplicated so the timeline can render every step as "pending" before the run
 * emits anything. tests/test_web_event_contract.py pins both against Python.
 *
 * `stage` groups the nodes into the four phases the UI draws dividers between.
 */

export type Stage = 'analysis' | 'research' | 'trading' | 'risk'

export interface TimelineNode {
  node: string
  label: string
  stage: Stage
  slug: string
}

export const STAGE_LABELS: Record<Stage, string> = {
  analysis: '分析师团队',
  research: '研究团队',
  trading: '交易执行',
  risk: '风控与决策',
}

export const TIMELINE_NODES: readonly TimelineNode[] = [
  { node: 'Market Analyst', label: '市场分析师', stage: 'analysis', slug: 'market-analyst' },
  { node: 'Sentiment Analyst', label: '舆情分析师', stage: 'analysis', slug: 'sentiment-analyst' },
  { node: 'News Analyst', label: '新闻分析师', stage: 'analysis', slug: 'news-analyst' },
  { node: 'Fundamentals Analyst', label: '基本面分析师', stage: 'analysis', slug: 'fundamentals-analyst' },
  { node: 'Annual Report Analyst', label: '年报分析师', stage: 'analysis', slug: 'annual-report-analyst' },
  { node: 'Industry Chain Analyst', label: '产业链分析师', stage: 'analysis', slug: 'industry-chain-analyst' },
  { node: 'Bull Researcher', label: '多头研究员', stage: 'research', slug: 'bull-researcher' },
  { node: 'Bear Researcher', label: '空头研究员', stage: 'research', slug: 'bear-researcher' },
  { node: 'Research Manager', label: '研究主管', stage: 'research', slug: 'research-manager' },
  { node: 'Trader', label: '交易员', stage: 'trading', slug: 'trader' },
  { node: 'Aggressive Analyst', label: '激进风控', stage: 'risk', slug: 'aggressive-analyst' },
  { node: 'Conservative Analyst', label: '保守风控', stage: 'risk', slug: 'conservative-analyst' },
  { node: 'Neutral Analyst', label: '中性风控', stage: 'risk', slug: 'neutral-analyst' },
  { node: 'Portfolio Manager', label: '组合经理', stage: 'risk', slug: 'portfolio-manager' },
]

/** Look up a timeline node by its URL slug. */
export function nodeBySlug(slug: string): TimelineNode | undefined {
  return TIMELINE_NODES.find((n) => n.slug === slug)
}

/** Set of all valid node slugs for route validation. */
export const VALID_SLUGS = new Set(TIMELINE_NODES.map((n) => n.slug))

/** Report state key -> section heading, in the order reports are produced. */
export const REPORT_SECTIONS: readonly { key: string; title: string }[] = [
  { key: 'market_report', title: '市场分析' },
  { key: 'sentiment_report', title: '舆情分析' },
  { key: 'news_report', title: '新闻分析' },
  { key: 'fundamentals_report', title: '基本面分析' },
  { key: 'annual_report', title: '年报分析' },
  { key: 'industry_report', title: '产业链分析' },
]
