import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReportCard } from './ReportCard'

// The analyst prompts require "a Markdown table at the end of the report"
// (tradingagents/agents/analysts/news_analyst.py). The previous UI assigned
// report bodies with .textContent, so those tables reached the user as raw
// pipes and dashes. These tests pin the fix.
const TABLE = `# 技术面

近五日放量上行。

| 指标 | 数值 | 判断 |
| --- | --- | --- |
| MACD | 金叉 | 偏多 |
| RSI | 68 | 中性偏高 |
`

describe('ReportCard', () => {
  it('renders a Markdown table as a real table', () => {
    render(<ReportCard title="市场分析" label="市场分析师" content={TABLE} />)

    const table = screen.getByRole('table')
    expect(table).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '指标' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'MACD' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '中性偏高' })).toBeInTheDocument()
    // Two data rows of three columns.
    expect(table.querySelectorAll('td')).toHaveLength(6)
  })

  it('does not leak table syntax as literal text', () => {
    const { container } = render(<ReportCard title="市场分析" label="市场分析师" content={TABLE} />)

    expect(container.textContent).not.toContain('| --- |')
    expect(container.textContent).not.toContain('| 指标 |')
  })

  it('renders headings and emphasis rather than escaping them', () => {
    render(<ReportCard title="新闻分析" label="新闻分析师" content={'## 摘要\n\n**重大利好**'} />)

    expect(screen.getByRole('heading', { level: 2, name: '摘要' })).toBeInTheDocument()
    expect(screen.getByText('重大利好').tagName).toBe('STRONG')
  })

  it('shows the section title and the producing analyst', () => {
    render(<ReportCard title="基本面分析" label="基本面分析师" content="正文" />)

    expect(screen.getByRole('heading', { level: 3, name: '基本面分析' })).toBeInTheDocument()
    expect(screen.getByText('基本面分析师')).toBeInTheDocument()
  })
})
