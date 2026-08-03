/**
 * What a single graph node produced, as raw text.
 *
 * The office needs each member's output as prose it can excerpt into a speech
 * bubble, which `NodeDetail`'s renderer cannot give it — that returns JSX. So
 * the lookup lives here, and "does this node have anything to show?" is derived
 * from it rather than kept as a second switch that could disagree.
 */

import type { ResultView } from './view'

/** Node slug -> the report state key it produces (analyst nodes only). */
export const SLUG_TO_REPORT_KEY: Record<string, string> = {
  'market-analyst': 'market_report',
  'sentiment-analyst': 'sentiment_report',
  'news-analyst': 'news_report',
  'fundamentals-analyst': 'fundamentals_report',
  'annual-report-analyst': 'annual_report',
  'industry-chain-analyst': 'industry_report',
}

/**
 * Node slug -> which debate it speaks in, under which graph node name.
 *
 * `speaker` on a debate event is the graph node name verbatim (web/events.py
 * `_feed_investment_debate`), and `viewFromHistory` uses the same names, so an
 * exact match is safe on both paths.
 */
const DEBATERS: Record<string, { node: string; phase: 'investment' | 'risk' }> = {
  'bull-researcher': { node: 'Bull Researcher', phase: 'investment' },
  'bear-researcher': { node: 'Bear Researcher', phase: 'investment' },
  'aggressive-analyst': { node: 'Aggressive Analyst', phase: 'risk' },
  'conservative-analyst': { node: 'Conservative Analyst', phase: 'risk' },
  'neutral-analyst': { node: 'Neutral Analyst', phase: 'risk' },
}

/**
 * Everything a node has said, newest last — one entry per turn for a debater,
 * a single entry for everyone else, and empty when it has not run.
 */
export function nodeTexts(slug: string, view: ResultView): string[] {
  const reportKey = SLUG_TO_REPORT_KEY[slug]
  if (reportKey) {
    const report = view.reports.find((r) => r.key === reportKey)
    return report ? [report.content] : []
  }

  const debater = DEBATERS[slug]
  if (debater) {
    const entries = debater.phase === 'risk' ? view.riskDebate : view.investmentDebate
    return entries.filter((e) => e.speaker === debater.node).map((e) => e.content)
  }

  switch (slug) {
    case 'research-manager':
      return view.investmentJudge ? [view.investmentJudge] : []
    case 'trader':
      return view.traderPlan ? [view.traderPlan] : []
    case 'portfolio-manager':
      return view.decision ? [view.decision] : []
    default:
      return []
  }
}

/** Whether a node has anything to show; drives clickability in both views. */
export function nodeHasContent(slug: string, view: ResultView): boolean {
  return nodeTexts(slug, view).length > 0
}

/**
 * One-line summary for a node, or null if unavailable.
 *
 * Structured agents produce a summary alongside their report; free-form
 * agents append a SUMMARY line that the backend extracts.  The frontend
 * prefers this over `excerpt(content)` when displaying speech bubbles.
 */
export function nodeSummary(slug: string, view: ResultView): string | null {
  const reportKey = SLUG_TO_REPORT_KEY[slug]
  if (reportKey) {
    const report = view.reports.find((r) => r.key === reportKey)
    return report?.summary || null
  }

  switch (slug) {
    case 'research-manager':
      return view.investmentJudgeSummary || null
    case 'trader':
      return view.traderPlanSummary || null
    case 'portfolio-manager':
      return view.decisionSummary || null
    default:
      return null
  }
}
