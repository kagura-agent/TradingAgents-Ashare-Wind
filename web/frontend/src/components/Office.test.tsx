import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Office } from './Office'
import { EMPTY_VIEW, type ResultView } from '../lib/view'
import { stageNodes } from '../lib/nodes'
import type { NodeStatus } from '../lib/analysisReducer'

type Props = Parameters<typeof Office>[0]

function props(overrides: Partial<Props> = {}): Props {
  return { stage: 'analysis', nodes: {}, view: EMPTY_VIEW, onSelectNode: () => {}, ...overrides }
}

function renderOffice(overrides: Partial<Props> = {}) {
  return render(<Office {...props(overrides)} />)
}

function seat(node: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-seat="${node}"]`)
  if (!el) throw new Error(`seat missing: ${node}`)
  return el
}

const report = (key: string, content: string) => ({
  key,
  node: key,
  label: key,
  title: key,
  content,
})

const debateView: ResultView = {
  ...EMPTY_VIEW,
  investmentDebate: [
    { speaker: 'Bull Researcher', label: '多头研究员', content: '第一轮看多' },
    { speaker: 'Bear Researcher', label: '空头研究员', content: '第一轮看空' },
    { speaker: 'Bull Researcher', label: '多头研究员', content: '第二轮看多' },
  ],
  investmentJudge: '主管采纳多头',
}

describe('Office', () => {
  it('seats the whole team before a run produces anything', () => {
    renderOffice()

    expect(document.querySelectorAll('[data-seat]')).toHaveLength(6)
    for (const node of stageNodes('analysis', 'participant')) {
      expect(seat(node.node)).toHaveAttribute('data-status', 'pending')
      expect(screen.getByText(node.label)).toBeInTheDocument()
    }
    expect(screen.getAllByText('待命')).toHaveLength(6)
  })

  it('never uses the timeline\'s data-node, whose count is pinned elsewhere', () => {
    renderOffice()

    expect(document.querySelectorAll('[data-node]')).toHaveLength(0)
  })

  it('hangs each analyst\'s report above their head, and opens it on click', async () => {
    const onSelectNode = vi.fn()
    renderOffice({
      nodes: { 'Market Analyst': 'done', 'News Analyst': 'running' },
      view: { ...EMPTY_VIEW, reports: [report('market_report', '## 走势\n\n均线多头排列')] },
      onSelectNode,
    })

    expect(seat('Market Analyst')).toHaveTextContent('走势 均线多头排列')
    // Working, but with nothing to show yet.
    expect(seat('News Analyst')).toHaveTextContent('正在写…')

    await userEvent.click(screen.getByRole('button', { name: /市场分析师 — 已完成/ }))
    expect(onSelectNode).toHaveBeenCalledWith('market-analyst')

    // Someone with nothing to say is not a control.
    expect(screen.queryByRole('button', { name: /新闻分析师/ })).toBeNull()
  })

  it('stands the debaters on opposite sides with the manager off the floor', () => {
    renderOffice({ stage: 'research', view: debateView })

    expect(seat('Bull Researcher')).toHaveAttribute('data-side', 'left')
    expect(seat('Bear Researcher')).toHaveAttribute('data-side', 'right')
    expect(seat('Research Manager')).toHaveAttribute('data-role', 'judge')
    expect(document.querySelector('.office__gallery')).toContainElement(seat('Research Manager'))
    expect(document.querySelector('.office__floor')).toContainElement(seat('Bull Researcher'))
  })

  it('shows a debater every recent turn, and says how many it folded away', () => {
    const bull = {
      ...debateView,
      investmentDebate: [
        ...debateView.investmentDebate,
        { speaker: 'Bull Researcher', label: '多头研究员', content: '第三轮看多' },
      ],
    }
    renderOffice({ stage: 'research', view: bull })

    const bubbles = seat('Bull Researcher')
    expect(bubbles).toHaveTextContent('第二轮看多')
    expect(bubbles).toHaveTextContent('第三轮看多')
    expect(bubbles).toHaveTextContent('前 1 轮已折叠')
    expect(bubbles).not.toHaveTextContent('第一轮看多')
  })

  it('reports the rounds of a live run, and none of an archived one', () => {
    const { rerender } = renderOffice({
      stage: 'research',
      view: debateView,
      turns: { 'Bull Researcher': 2, 'Bear Researcher': 1 },
    })

    expect(screen.getByText('已辩论 2 轮')).toBeInTheDocument()

    rerender(<Office {...props({ stage: 'research', view: debateView })} />)

    expect(screen.queryByText(/已辩论/)).toBeNull()
    expect(screen.getByText('多空往返辩论')).toBeInTheDocument()
  })

  it('reads an archived run\'s progress off its content, having no statuses', () => {
    // App passes `nodes={{}}` for a stored run, so a seat with content is done.
    renderOffice({ stage: 'research', nodes: {}, view: debateView })

    expect(seat('Bull Researcher')).toHaveAttribute('data-status', 'done')
    expect(seat('Research Manager')).toHaveAttribute('data-status', 'done')
  })

  it('lets a live status override what the content implies', () => {
    const nodes: Record<string, NodeStatus> = { 'Bull Researcher': 'running' }
    renderOffice({ stage: 'research', nodes, view: debateView })

    expect(seat('Bull Researcher')).toHaveAttribute('data-status', 'running')
  })

  it('sits the three risk seats around a table', () => {
    renderOffice({ stage: 'risk' })

    expect(seat('Aggressive Analyst')).toHaveAttribute('data-side', 'top')
    expect(seat('Conservative Analyst')).toHaveAttribute('data-side', 'left')
    expect(seat('Neutral Analyst')).toHaveAttribute('data-side', 'right')
    expect(document.querySelector('.office__table')).toBeInTheDocument()
  })

  it('puts the final signal beside the manager who called it, and nowhere else', () => {
    const view: ResultView = { ...EMPTY_VIEW, ...debateView, decision: '买入', signal: '买入' }

    const { rerender } = renderOffice({ stage: 'risk', view })
    expect(screen.getByTestId('rating-badge')).toBeInTheDocument()

    rerender(<Office {...props({ stage: 'research', view })} />)
    expect(screen.queryByTestId('rating-badge')).toBeNull()
  })

  it('seats the lone trader with no gallery to rule on them', () => {
    renderOffice({ stage: 'trading', view: { ...EMPTY_VIEW, traderPlan: '分批建仓' } })

    expect(document.querySelectorAll('[data-seat]')).toHaveLength(1)
    expect(seat('Trader')).toHaveTextContent('分批建仓')
    expect(document.querySelector('.office__gallery')).toBeNull()
  })

  it('names the room for a screen reader', () => {
    renderOffice({ stage: 'risk' })

    expect(screen.getByRole('region', { name: '风控与决策办公区' })).toBeInTheDocument()
  })
})
