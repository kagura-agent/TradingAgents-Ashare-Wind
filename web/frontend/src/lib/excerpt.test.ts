import { describe, expect, it } from 'vitest'
import { excerpt, smartExcerpt } from './excerpt'

describe('excerpt', () => {
  it('returns short prose untouched', () => {
    expect(excerpt('看多，目标价 18 元。', 64)).toBe('看多，目标价 18 元。')
  })

  it('strips the markdown a speech bubble cannot render', () => {
    const md = [
      '## 市场分析',
      '',
      '> 趋势向上',
      '',
      '- **均线**多头排列',
      '- 参见 [研报](https://example.com/r)',
      '',
      '| 指标 | 值 |',
      '| --- | --- |',
    ].join('\n')

    expect(excerpt(md, 200)).toBe('市场分析 趋势向上 均线多头排列 参见 研报 指标 值')
  })

  it('drops fenced code entirely rather than leaking its contents', () => {
    expect(excerpt('结论如下\n\n```py\nx = 1\n```\n\n买入', 100)).toBe('结论如下 买入')
  })

  it('leaves underscores alone, because identifiers outnumber emphasis here', () => {
    expect(excerpt('见 market_report 一节', 64)).toBe('见 market_report 一节')
  })

  it('truncates with an ellipsis, and only then', () => {
    expect(excerpt('abcdefghij', 5)).toBe('abcde…')
    expect(excerpt('abcdefghij', 10)).toBe('abcdefghij')
    // The cut lands mid-space, which should not leave a dangling gap.
    expect(excerpt('abcde fghij', 6)).toBe('abcde…')
  })
})

describe('smartExcerpt', () => {
  // ---------------------------------------------------------------------------
  // Conclusion markers
  // ---------------------------------------------------------------------------

  it('extracts action from FINAL TRANSACTION PROPOSAL', () => {
    const md = [
      '## 市场分析报告',
      '',
      '经过多维度分析，当前市场环境较为复杂。',
      '技术指标显示均线多头排列，MACD金叉确认。',
      '',
      '## FINAL TRANSACTION PROPOSAL',
      '',
      'HOLD 以当前估值水平，建议持有观望，等待更明确信号。',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toContain('HOLD')
    expect(result).not.toContain('市场分析报告')
  })

  it('extracts BUY action with reason', () => {
    const md = [
      '# Analysis',
      '',
      'Various technical indicators point upward.',
      '',
      '## Recommendation',
      '',
      'BUY: Strong momentum and undervaluation suggest entry.',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toMatch(/^BUY/)
    expect(result).toContain('Strong momentum')
  })

  it('extracts SELL action', () => {
    const md = [
      '# 研报摘要',
      '',
      '多项指标恶化。',
      '',
      '## 结论',
      '',
      'SELL，估值过高且基本面转弱，建议减仓。',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toMatch(/^SELL/)
  })

  it('handles Chinese action keywords like 买入/卖出/持有', () => {
    const md = [
      '# 技术分析',
      '',
      '均线金叉，放量突破。',
      '',
      '## 建议',
      '',
      '买入，技术面强势突破确认。',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toContain('买入')
  })

  it('handles Overall Sentiment marker', () => {
    const md = [
      'Market conditions are mixed.',
      '',
      'Overall Sentiment: HOLD — uncertainty remains elevated.',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toContain('HOLD')
  })

  // ---------------------------------------------------------------------------
  // Debate markers
  // ---------------------------------------------------------------------------

  it('extracts debate stance with I argue', () => {
    const md = [
      '## Round 1',
      '',
      'Looking at the data carefully.',
      '',
      'I argue that the stock is overvalued given current PE ratios.',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toContain('overvalued')
    expect(result).not.toContain('Round 1')
  })

  it('extracts Chinese debate stance', () => {
    const md = [
      '## 第一轮辩论',
      '',
      '从技术面来看，趋势向好。',
      '',
      '我认为当前估值合理，应该看多。',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toContain('我认为')
  })

  it('extracts 立场/观点 marker', () => {
    const md = [
      '数据分析',
      '',
      '观点：看空，基本面恶化明显。',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toContain('看空')
  })

  // ---------------------------------------------------------------------------
  // Fallback: last paragraph
  // ---------------------------------------------------------------------------

  it('falls back to last paragraph when no marker found', () => {
    const md = [
      '# 无特殊标记报告',
      '',
      '第一段是介绍性文字，没有任何特殊内容。这里只是背景描述，用来填充篇幅而已。',
      '',
      '第二段也是分析过程，包含了很多技术细节，但仍然没有出现任何标记词。',
      '',
      '综合来看，短期偏多操作为宜。',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    // Should NOT start with the first paragraph
    expect(result).not.toContain('第一段')
    // Should contain content from the end
    expect(result).toContain('短期偏多')
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('returns short text directly', () => {
    expect(smartExcerpt('看多。', 64)).toBe('看多。')
  })

  it('handles empty string', () => {
    expect(smartExcerpt('', 64)).toBe('')
  })

  it('respects max char limit', () => {
    const md = [
      '## 建议',
      '',
      'BUY: This is a very long recommendation that goes on and on about the stock.',
    ].join('\n')

    const result = smartExcerpt(md, 30)
    expect(result.length).toBeLessThanOrEqual(31) // +1 for ellipsis char
    expect(result).toContain('BUY')
    expect(result.endsWith('…')).toBe(true)
  })

  it('strips markdown formatting in conclusion', () => {
    const md = [
      '## Analysis',
      '',
      'Lots of stuff.',
      '',
      '## 结论',
      '',
      '**HOLD** — 等待 `CPI` 数据公布后再做决策。',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toContain('HOLD')
    expect(result).not.toContain('**')
    expect(result).not.toContain('`')
  })

  it('prefers earlier (more specific) conclusion marker', () => {
    const md = [
      '## 建议',
      '',
      '减持，风险偏大。',
      '',
      '## 结论',
      '',
      'SELL: 建议卖出。',
    ].join('\n')

    // FINAL TRANSACTION PROPOSAL > Overall Sentiment > Recommendation > 结论 > 建议
    // Here 结论 comes before 建议 in marker priority, but 建议 appears first in text.
    // Our markers list has 结论 before 建议, so 结论 should be tried first,
    // and since it exists, it should win.
    const result = smartExcerpt(md, 64)
    expect(result).toContain('SELL')
  })

  it('handles multi-line conclusion paragraph', () => {
    const md = [
      '# Report',
      '',
      'Introduction text.',
      '',
      '## FINAL TRANSACTION PROPOSAL',
      '',
      'BUY the stock.',
      'Target price is 25 CNY.',
      'Risk is moderate.',
      '',
      'Disclaimer: this is not advice.',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toContain('BUY')
    // Should include the follow-up lines from the same paragraph
    expect(result).toContain('Target price')
  })

  it('works with 最终判断 marker', () => {
    const md = [
      '分析过程略。',
      '',
      '最终判断：看多，建议买入。',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toContain('看多')
  })

  it('handles action keyword without following reason gracefully', () => {
    const md = [
      '## 结论',
      '',
      'HOLD',
    ].join('\n')

    const result = smartExcerpt(md, 64)
    expect(result).toBe('HOLD')
  })
})
