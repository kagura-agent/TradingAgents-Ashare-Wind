import { describe, expect, it } from 'vitest'
import { EMPTY_VIEW, viewFromHistory, viewFromState } from './view'
import { initialAnalysisState, type AnalysisState } from './analysisReducer'
import type { AnalysisResult } from './api'

const RESULT: AnalysisResult = {
  market_report: '市场',
  sentiment_report: '',
  news_report: '新闻',
  fundamentals_report: '基本面',
  annual_report: '',
  industry_report: '产业链',
  investment_debate: { bull_history: '多头', bear_history: '空头', judge_decision: '裁决' },
  trader_plan: '计划',
  risk_debate: {
    aggressive_history: '激进',
    conservative_history: '',
    neutral_history: '中性',
    judge_decision: '风控裁决',
  },
  final_decision: '决策',
  signal: 'Underweight',
}

describe('viewFromState', () => {
  it('orders reports canonically regardless of arrival order', () => {
    const state: AnalysisState = {
      ...initialAnalysisState,
      reports: {
        news_report: { key: 'news_report', node: 'News Analyst', label: '新闻分析师', content: 'n' },
        market_report: { key: 'market_report', node: 'Market Analyst', label: '市场分析师', content: 'm' },
      },
    }

    expect(viewFromState(state).reports.map((r) => r.key)).toEqual(['market_report', 'news_report'])
  })

  it('titles each report with its section heading', () => {
    const state: AnalysisState = {
      ...initialAnalysisState,
      reports: {
        industry_report: { key: 'industry_report', node: 'x', label: '产业链分析师', content: 'i' },
      },
    }

    expect(viewFromState(state).reports[0].title).toBe('产业链分析')
  })

  it('skips report keys the backend has not produced', () => {
    expect(viewFromState(initialAnalysisState)).toEqual(EMPTY_VIEW)
  })
})

describe('viewFromHistory', () => {
  it('renders a stored run through the same model as a live one', () => {
    const view = viewFromHistory(RESULT)

    expect(view.reports.map((r) => r.key)).toEqual([
      'market_report',
      'news_report',
      'fundamentals_report',
      'industry_report',
    ])
    expect(view.signal).toBe('Underweight')
    expect(view.decision).toBe('决策')
    expect(view.traderPlan).toBe('计划')
  })

  it('collapses each speaker history into one entry', () => {
    const view = viewFromHistory(RESULT)

    expect(view.investmentDebate.map((e) => e.label)).toEqual(['多头研究员', '空头研究员'])
    // The conservative analyst produced nothing, so it is not shown at all.
    expect(view.riskDebate.map((e) => e.label)).toEqual(['激进风控', '中性风控'])
    expect(view.investmentJudge).toBe('裁决')
    expect(view.riskJudge).toBe('风控裁决')
  })

  it('turns empty strings into nulls so nothing renders an empty card', () => {
    const empty: AnalysisResult = {
      ...RESULT,
      investment_debate: { bull_history: '', bear_history: '', judge_decision: '' },
      trader_plan: '',
      risk_debate: {
        aggressive_history: '',
        conservative_history: '',
        neutral_history: '',
        judge_decision: '',
      },
      final_decision: '',
      signal: '',
    }
    const view = viewFromHistory(empty)

    expect(view.investmentDebate).toEqual([])
    expect(view.riskDebate).toEqual([])
    expect(view.investmentJudge).toBeNull()
    expect(view.traderPlan).toBeNull()
    expect(view.riskJudge).toBeNull()
    expect(view.decision).toBeNull()
    expect(view.signal).toBeNull()
  })
})
