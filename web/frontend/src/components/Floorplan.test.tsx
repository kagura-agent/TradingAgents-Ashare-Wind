import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Floorplan } from './Floorplan'
import { EMPTY_VIEW, type ResultView } from '../lib/view'
import { STAGES, TIMELINE_NODES } from '../lib/nodes'
import type { NodeStatus } from '../lib/analysisReducer'

type Props = Parameters<typeof Floorplan>[0]

function props(overrides: Partial<Props> = {}): Props {
  return {
    nodes: {},
    view: EMPTY_VIEW,
    onSelectNode: () => {},
    onSelectStage: () => {},
    ...overrides,
  }
}

function renderFloorplan(overrides: Partial<Props> = {}) {
  return render(<Floorplan {...props(overrides)} />)
}

function room(stage: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.office[data-stage="${stage}"]`)
  if (!el) throw new Error(`room missing: ${stage}`)
  return el
}

const marketReport = {
  key: 'market_report',
  node: 'market_report',
  label: '市场分析',
  title: '市场分析',
  content: '## 走势\n\n均线多头排列',
}

describe('Floorplan', () => {
  it('puts every team in one room and everyone at a desk', () => {
    renderFloorplan()

    for (const stage of STAGES) expect(room(stage)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-seat]')).toHaveLength(TIMELINE_NODES.length)
  })

  it('never uses the timeline\'s data-node, whose count is pinned elsewhere', () => {
    renderFloorplan()

    expect(document.querySelectorAll('[data-node]')).toHaveLength(0)
  })

  it('gives a bubble to everyone who has spoken, and to nobody else', () => {
    const nodes: Record<string, NodeStatus> = {
      'Market Analyst': 'done',
      'News Analyst': 'running',
    }
    renderFloorplan({ nodes, view: { ...EMPTY_VIEW, reports: [marketReport] } })

    // Two of fourteen have anything to say. The other twelve get a lamp and a
    // nameplate — fourteen 「待命」 placeholders is the noise the overview avoids.
    expect(document.querySelectorAll('.office__bubble')).toHaveLength(2)
    expect(room('analysis')).toHaveTextContent('均线多头排列')
    expect(room('analysis')).toHaveTextContent('正在写…')
    expect(screen.queryByText('待命')).toBeNull()
  })

  it('keeps a bubble up after its owner finishes, rather than blinking it away', () => {
    // A node starts, emits and completes within one frame, and the next only
    // starts a few hundred milliseconds later. Anything bound to `running`
    // alone was empty for most of the run, once per step.
    const view = { ...EMPTY_VIEW, reports: [marketReport] }
    const { rerender } = renderFloorplan({ nodes: { 'Market Analyst': 'running' }, view })

    rerender(<Floorplan {...props({ nodes: { 'Market Analyst': 'done' }, view })} />)

    expect(document.querySelectorAll('.office__bubble')).toHaveLength(1)
    expect(room('analysis')).toHaveTextContent('均线多头排列')
  })

  it('lights the rooms the run has reached, and leaves them lit', () => {
    const { rerender } = renderFloorplan({ nodes: { 'Market Analyst': 'running' } })

    expect(room('analysis')).toHaveAttribute('data-reached')
    expect(room('research')).not.toHaveAttribute('data-reached')

    rerender(
      <Floorplan
        {...props({ nodes: { 'Market Analyst': 'done', 'Bull Researcher': 'running' } })}
      />,
    )

    // The analyst room does not go dark behind the run; the office fills up.
    expect(room('analysis')).toHaveAttribute('data-reached')
    expect(room('research')).toHaveAttribute('data-reached')
    expect(room('trading')).not.toHaveAttribute('data-reached')
  })

  it('opens a room from its heading', async () => {
    const onSelectStage = vi.fn()
    renderFloorplan({ onSelectStage })

    await userEvent.click(screen.getByRole('button', { name: /研究团队办公区 — 点击放大查看/ }))

    expect(onSelectStage).toHaveBeenCalledWith('research')
  })

  it('opens a person from their desk', async () => {
    const onSelectNode = vi.fn()
    renderFloorplan({
      view: { ...EMPTY_VIEW, reports: [marketReport] },
      onSelectNode,
    })

    await userEvent.click(screen.getByRole('button', { name: /市场分析师 — 已完成/ }))

    expect(onSelectNode).toHaveBeenCalledWith('market-analyst')
  })

  it('shows the run\'s verdict from the overview, in the room that called it', () => {
    const view: ResultView = { ...EMPTY_VIEW, decision: '买入', signal: '买入' }
    renderFloorplan({ view })

    expect(room('risk')).toContainElement(screen.getByTestId('rating-badge'))
  })

  it('reads an archived run off its content, having no statuses', () => {
    renderFloorplan({ nodes: {}, view: { ...EMPTY_VIEW, reports: [marketReport] } })

    expect(document.querySelector('[data-seat="Market Analyst"]')).toHaveAttribute(
      'data-status',
      'done',
    )
    // What was said is still on the wall; the outline is not, since a stored run
    // has no progress left to trace through the office.
    expect(room('analysis')).toHaveTextContent('均线多头排列')
    expect(document.querySelector('.office[data-reached]')).toBeNull()
  })

  it('keeps both debate turns in the overview, with nothing folded away', () => {
    // How many turns a desk shows belongs to the floor plan, not to `compact`:
    // capping the debaters at one bubble left a permanent 「前 1 轮已折叠」 saying
    // what the room heading's 「已辩论 N 轮」 already says.
    const view: ResultView = {
      ...EMPTY_VIEW,
      investmentDebate: [
        { speaker: 'Bull Researcher', label: '多头研究员', content: '第一轮看多' },
        { speaker: 'Bull Researcher', label: '多头研究员', content: '第二轮看多' },
      ],
    }
    renderFloorplan({ view })

    const bull = document.querySelector('[data-seat="Bull Researcher"]')
    expect(bull).toHaveTextContent('第一轮看多')
    expect(bull).toHaveTextContent('第二轮看多')
    expect(screen.queryByText(/已折叠/)).toBeNull()
  })

  it('names the floor for a screen reader', () => {
    renderFloorplan()

    expect(screen.getByRole('region', { name: '总办公室' })).toBeInTheDocument()
  })
})
