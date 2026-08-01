import { describe, expect, it } from 'vitest'
import {
  analysisReducer,
  initialAnalysisState,
  isTerminal,
  type AnalysisState,
} from './analysisReducer'
import type { AnalysisEvent } from '../types/events'

/** Fold a whole stream in, as the hook does, starting at `from`. */
function feed(state: AnalysisState, events: AnalysisEvent[], from = 0): AnalysisState {
  return events.reduce(
    (acc, event, i) => analysisReducer(acc, { kind: 'event', index: from + i, event }),
    state,
  )
}

const RUN: AnalysisEvent[] = [
  { type: 'status', status: 'running', message: '分析引擎已就绪' },
  { type: 'node_start', node: 'Market Analyst', label: '市场分析师' },
  { type: 'report', node: 'Market Analyst', label: '市场分析师', report_key: 'market_report', content: '# 技术面' },
  { type: 'node_complete', node: 'Market Analyst', label: '市场分析师' },
  { type: 'node_start', node: 'Bull Researcher', label: '多头研究员' },
  { type: 'debate', phase: 'investment', speaker: 'Bull Researcher', label: '多头研究员', content: '第一轮' },
  { type: 'debate', phase: 'investment', speaker: 'Bull Researcher', label: '多头研究员', content: '第二轮' },
  { type: 'node_complete', node: 'Bull Researcher', label: '多头研究员' },
  { type: 'debate_decision', phase: 'investment', speaker: 'Research Manager', label: '研究主管', content: '裁决' },
  { type: 'trader_plan', node: 'Trader', label: '交易员', content: '计划' },
  { type: 'debate', phase: 'risk', speaker: 'Neutral Analyst', label: '中性风控', content: '中性意见' },
  { type: 'debate_decision', phase: 'risk', speaker: 'Portfolio Manager', label: '组合经理', content: '风控裁决' },
  { type: 'decision', content: '## 最终决策' },
  { type: 'complete', signal: 'Overweight', message: '分析完成' },
]

describe('analysisReducer', () => {
  it('builds the full view from one pass of the stream', () => {
    const state = feed(initialAnalysisState, RUN)

    expect(state.runStatus).toBe('completed')
    expect(state.signal).toBe('Overweight')
    expect(state.reports.market_report.content).toBe('# 技术面')
    expect(state.investmentDebate.map((e) => e.content)).toEqual(['第一轮', '第二轮'])
    expect(state.investmentJudge).toBe('裁决')
    expect(state.traderPlan).toBe('计划')
    expect(state.riskDebate).toHaveLength(1)
    expect(state.riskJudge).toBe('风控裁决')
    expect(state.decision).toBe('## 最终决策')
    expect(state.applied).toBe(RUN.length)
  })

  it('is idempotent when the server replays the whole stream', () => {
    // The reconnect contract: a fresh connection replays from index 0.
    const once = feed(initialAnalysisState, RUN)
    const twice = feed(once, RUN)

    expect(twice).toEqual(once)
  })

  it('is idempotent under repeated partial replays', () => {
    const direct = feed(initialAnalysisState, RUN)

    // Drop at event 6, reconnect, replay from the top, then finish.
    let state = feed(initialAnalysisState, RUN.slice(0, 6))
    state = feed(state, RUN) // full replay: prefix skipped, tail applied

    expect(state).toEqual(direct)
  })

  it('does not duplicate debate turns across a reconnect', () => {
    let state = feed(initialAnalysisState, RUN.slice(0, 6))
    expect(state.investmentDebate).toHaveLength(1)

    state = feed(state, RUN.slice(0, 7))
    expect(state.investmentDebate.map((e) => e.content)).toEqual(['第一轮', '第二轮'])
  })

  it('ignores events already applied', () => {
    const state = feed(initialAnalysisState, RUN.slice(0, 3))
    const again = analysisReducer(state, { kind: 'event', index: 0, event: RUN[0] })

    expect(again).toBe(state) // same reference: no work done
  })

  it('tracks node status transitions', () => {
    let state = analysisReducer(initialAnalysisState, {
      kind: 'event',
      index: 0,
      event: { type: 'node_start', node: 'Trader', label: '交易员' },
    })
    expect(state.nodes.Trader).toBe('running')

    state = analysisReducer(state, {
      kind: 'event',
      index: 1,
      event: { type: 'node_complete', node: 'Trader', label: '交易员' },
    })
    expect(state.nodes.Trader).toBe('done')
  })

  it('closes any still-running node when the run completes', () => {
    let state = feed(initialAnalysisState, [
      { type: 'node_start', node: 'Portfolio Manager', label: '组合经理' },
    ])
    state = feed(state, [{ type: 'complete', signal: 'Hold', message: '完成' }], 1)

    expect(state.nodes['Portfolio Manager']).toBe('done')
  })

  it('keys reports so a repeated report does not stack up', () => {
    const report: AnalysisEvent = {
      type: 'report',
      node: 'News Analyst',
      label: '新闻分析师',
      report_key: 'news_report',
      content: '新闻',
    }
    const state = feed(initialAnalysisState, [report, report])

    expect(Object.keys(state.reports)).toEqual(['news_report'])
  })

  it('records errors as a failed run', () => {
    const state = feed(initialAnalysisState, [{ type: 'error', message: '分析失败: Wind 超时' }])

    expect(state.runStatus).toBe('failed')
    expect(state.error).toContain('Wind 超时')
  })

  it('does not let a late status event revive a finished run', () => {
    const state = feed(initialAnalysisState, [
      { type: 'complete', signal: 'Sell', message: '完成' },
      { type: 'status', status: 'running', message: '迟到的状态' },
    ])

    expect(state.runStatus).toBe('completed')
  })

  it('resets to the initial state', () => {
    const state = feed(initialAnalysisState, RUN)

    expect(analysisReducer(state, { kind: 'reset' })).toEqual(initialAnalysisState)
    expect(analysisReducer(state, { kind: 'starting' }).runStatus).toBe('starting')
    expect(analysisReducer(state, { kind: 'starting' }).reports).toEqual({})
  })
})

describe('isTerminal', () => {
  it('is true only for completed and failed', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('running')).toBe(false)
    expect(isTerminal('starting')).toBe(false)
    expect(isTerminal('idle')).toBe(false)
  })
})
