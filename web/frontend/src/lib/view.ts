/**
 * Normalises the two sources of analysis content into one render model.
 *
 * A live run arrives as an event stream (incremental debate turns); a stored
 * run arrives from /api/history/{id} as whole accumulated histories. Rendering
 * both through a single view model keeps one set of components — and one set
 * of visual decisions — instead of two that drift.
 */

import type { AnalysisResult } from './api'
import type { AnalysisState, DebateEntry, ReportEntry } from './analysisReducer'
import { REPORT_SECTIONS } from './nodes'

export interface ResultView {
  reports: (ReportEntry & { title: string })[]
  investmentDebate: DebateEntry[]
  investmentJudge: string | null
  investmentJudgeSummary: string | null
  traderPlan: string | null
  traderPlanSummary: string | null
  riskDebate: DebateEntry[]
  riskJudge: string | null
  riskJudgeSummary: string | null
  decision: string | null
  decisionSummary: string | null
  signal: string | null
}

export const EMPTY_VIEW: ResultView = {
  reports: [],
  investmentDebate: [],
  investmentJudge: null,
  investmentJudgeSummary: null,
  traderPlan: null,
  traderPlanSummary: null,
  riskDebate: [],
  riskJudge: null,
  riskJudgeSummary: null,
  decision: null,
  decisionSummary: null,
  signal: null,
}

/** Reports in the canonical analyst order, skipping ones not yet produced. */
function orderReports(reports: Record<string, ReportEntry>) {
  return REPORT_SECTIONS.flatMap((section) => {
    const entry = reports[section.key]
    return entry ? [{ ...entry, title: section.title }] : []
  })
}

export function viewFromState(state: AnalysisState): ResultView {
  return {
    reports: orderReports(state.reports),
    investmentDebate: state.investmentDebate,
    investmentJudge: state.investmentJudge,
    investmentJudgeSummary: state.investmentJudgeSummary,
    traderPlan: state.traderPlan,
    traderPlanSummary: state.traderPlanSummary,
    riskDebate: state.riskDebate,
    riskJudge: state.riskJudge,
    riskJudgeSummary: state.riskJudgeSummary,
    decision: state.decision,
    decisionSummary: state.decisionSummary,
    signal: state.signal,
  }
}

function entry(speaker: string, label: string, content: string): DebateEntry[] {
  return content ? [{ speaker, label, content }] : []
}

export function viewFromHistory(result: AnalysisResult): ResultView {
  const reports: Record<string, ReportEntry> = {}
  for (const section of REPORT_SECTIONS) {
    const content = (result as unknown as Record<string, string>)[section.key]
    if (content) {
      reports[section.key] = { key: section.key, node: section.key, label: section.title, content }
    }
  }

  return {
    reports: orderReports(reports),
    // A stored run keeps whole histories rather than per-turn slices, so each
    // speaker collapses to a single entry.
    investmentDebate: [
      ...entry('Bull Researcher', '多头研究员', result.investment_debate.bull_history),
      ...entry('Bear Researcher', '空头研究员', result.investment_debate.bear_history),
    ],
    investmentJudge: result.investment_debate.judge_decision || null,
    investmentJudgeSummary: null,
    traderPlan: result.trader_plan || null,
    traderPlanSummary: null,
    riskDebate: [
      ...entry('Aggressive Analyst', '激进风控', result.risk_debate.aggressive_history),
      ...entry('Conservative Analyst', '保守风控', result.risk_debate.conservative_history),
      ...entry('Neutral Analyst', '中性风控', result.risk_debate.neutral_history),
    ],
    riskJudge: result.risk_debate.judge_decision || null,
    riskJudgeSummary: null,
    decision: result.final_decision || null,
    decisionSummary: null,
    signal: result.signal || null,
  }
}
