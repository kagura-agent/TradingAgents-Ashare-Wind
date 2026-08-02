import { describe, expect, it } from 'vitest'
import { nodeHasContent, nodeTexts } from './nodeContent'
import { EMPTY_VIEW, type ResultView } from './view'
import { TIMELINE_NODES } from './nodes'

function view(overrides: Partial<ResultView> = {}): ResultView {
  return { ...EMPTY_VIEW, ...overrides }
}

const debate = view({
  investmentDebate: [
    { speaker: 'Bull Researcher', label: '多头研究员', content: '多一' },
    { speaker: 'Bear Researcher', label: '空头研究员', content: '空一' },
    { speaker: 'Bull Researcher', label: '多头研究员', content: '多二' },
  ],
  riskDebate: [
    { speaker: 'Aggressive Analyst', label: '激进风控', content: '激进' },
    { speaker: 'Conservative Analyst', label: '保守风控', content: '保守' },
    { speaker: 'Neutral Analyst', label: '中性风控', content: '中性' },
  ],
})

describe('nodeTexts', () => {
  it('finds an analyst report by its state key', () => {
    const v = view({
      reports: [{ key: 'market_report', node: 'Market Analyst', label: '市场分析师', title: '市场分析', content: '走势向上' }],
    })

    expect(nodeTexts('market-analyst', v)).toEqual(['走势向上'])
    expect(nodeTexts('news-analyst', v)).toEqual([])
  })

  it('gives a debater every turn they took, in order', () => {
    expect(nodeTexts('bull-researcher', debate)).toEqual(['多一', '多二'])
    expect(nodeTexts('bear-researcher', debate)).toEqual(['空一'])
  })

  it('keeps the two debates apart', () => {
    // Both phases hold "analysts"; a risk slug must not reach the investment
    // history, nor a researcher slug the risk one.
    expect(nodeTexts('aggressive-analyst', debate)).toEqual(['激进'])
    expect(nodeTexts('conservative-analyst', debate)).toEqual(['保守'])
    expect(nodeTexts('neutral-analyst', debate)).toEqual(['中性'])
  })

  it('gives each judge its own verdict', () => {
    const v = view({ investmentJudge: '裁决', traderPlan: '计划', decision: '买入' })

    expect(nodeTexts('research-manager', v)).toEqual(['裁决'])
    expect(nodeTexts('trader', v)).toEqual(['计划'])
    expect(nodeTexts('portfolio-manager', v)).toEqual(['买入'])
  })

  it('returns nothing for a slug it does not know', () => {
    expect(nodeTexts('janitor', debate)).toEqual([])
  })
})

describe('nodeHasContent', () => {
  it('agrees with nodeTexts for every node, empty or not', () => {
    for (const node of TIMELINE_NODES) {
      expect(nodeHasContent(node.slug, EMPTY_VIEW)).toBe(false)
      expect(nodeHasContent(node.slug, debate)).toBe(nodeTexts(node.slug, debate).length > 0)
    }
  })
})
