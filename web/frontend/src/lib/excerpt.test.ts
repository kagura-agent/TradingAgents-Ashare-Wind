import { describe, expect, it } from 'vitest'
import { excerpt } from './excerpt'

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
