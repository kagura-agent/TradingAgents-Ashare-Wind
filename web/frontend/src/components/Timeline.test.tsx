import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Timeline } from './Timeline'
import { STAGE_LABELS, TIMELINE_NODES } from '../lib/nodes'
import type { NodeStatus } from '../lib/analysisReducer'

const noop = () => {}
const noContent = () => false

function item(node: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-node="${node}"]`)
  if (!el) throw new Error(`timeline item missing: ${node}`)
  return el
}

describe('Timeline', () => {
  it('renders every node up front so the run has a visible shape', () => {
    render(<Timeline nodes={{}} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    expect(document.querySelectorAll('[data-node]')).toHaveLength(TIMELINE_NODES.length)
    for (const node of TIMELINE_NODES) {
      expect(item(node.node)).toHaveAttribute('data-status', 'pending')
      expect(screen.getByText(node.label)).toBeInTheDocument()
    }
  })

  it('groups nodes under their stage headings', () => {
    render(<Timeline nodes={{}} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    for (const label of Object.values(STAGE_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByRole('navigation', { name: '执行进度' })).toBeInTheDocument()
  })

  it('reflects node status transitions', () => {
    const nodes: Record<string, NodeStatus> = { 'Market Analyst': 'running' }
    const { rerender } = render(<Timeline nodes={nodes} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    expect(item('Market Analyst')).toHaveAttribute('data-status', 'running')
    expect(item('News Analyst')).toHaveAttribute('data-status', 'pending')

    rerender(<Timeline nodes={{ 'Market Analyst': 'done', 'News Analyst': 'running' }} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    expect(item('Market Analyst')).toHaveAttribute('data-status', 'done')
    expect(item('News Analyst')).toHaveAttribute('data-status', 'running')
  })

  it('announces status in text for screen readers', () => {
    render(<Timeline nodes={{ Trader: 'running' }} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    expect(item('Trader')).toHaveTextContent('进行中')
    expect(item('Portfolio Manager')).toHaveTextContent('待执行')
  })

  it('ignores nodes it does not know about', () => {
    render(<Timeline nodes={{ 'Some Future Agent': 'running' }} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    expect(document.querySelectorAll('[data-node]')).toHaveLength(TIMELINE_NODES.length)
    expect(screen.queryByText('Some Future Agent')).toBeNull()
  })

  it('marks done nodes as clickable', () => {
    const nodes: Record<string, NodeStatus> = { 'Market Analyst': 'done' }
    // Only market-analyst has content
    const hasContent = (slug: string) => slug === 'market-analyst'
    render(<Timeline nodes={nodes} selectedSlug={null} onSelectNode={noop} nodeHasContent={hasContent} />)

    expect(item('Market Analyst')).toHaveAttribute('data-clickable')
    expect(item('News Analyst')).not.toHaveAttribute('data-clickable')
  })

  it('marks only the selected node as selected', () => {
    const hasContent = () => true
    const { rerender } = render(
      <Timeline nodes={{}} selectedSlug="market-analyst" onSelectNode={noop} nodeHasContent={hasContent} />,
    )

    expect(item('Market Analyst')).toHaveAttribute('data-selected')
    expect(item('News Analyst')).not.toHaveAttribute('data-selected')
    expect(screen.getByRole('button', { name: /市场分析师 — 当前查看/ })).toBeInTheDocument()

    rerender(<Timeline nodes={{}} selectedSlug={null} onSelectNode={noop} nodeHasContent={hasContent} />)

    expect(item('Market Analyst')).not.toHaveAttribute('data-selected')
  })

  it('labels each stage with how it is wired', () => {
    render(<Timeline nodes={{}} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    expect(screen.getByText('并行')).toBeInTheDocument()
    expect(screen.getByText('多空往返辩论')).toBeInTheDocument()
    expect(screen.getByText('三方轮转')).toBeInTheDocument()
  })

  it('separates the judges from the participants they rule on', () => {
    render(<Timeline nodes={{}} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    expect(item('Research Manager')).toHaveAttribute('data-role', 'judge')
    expect(item('Portfolio Manager')).toHaveAttribute('data-role', 'judge')
    expect(item('Bull Researcher')).toHaveAttribute('data-role', 'participant')
    // Each judge sits in its own list so it can be drawn a level above.
    expect(document.querySelectorAll('[data-role="judge"].timeline__list')).toHaveLength(2)
  })

  it('marks the cyclic stages so their loop can be drawn', () => {
    render(<Timeline nodes={{}} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    const shapes = [...document.querySelectorAll('.timeline__list[data-role="participant"]')]
      .map((el) => el.getAttribute('data-shape'))

    expect(shapes).toEqual(['parallel', 'debate', 'linear', 'round-robin'])
  })

  it('reports rounds and per-speaker turns from a live run', () => {
    const turns = { 'Bull Researcher': 2, 'Bear Researcher': 2, 'Aggressive Analyst': 1 }
    render(
      <Timeline nodes={{}} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} turns={turns} />,
    )

    expect(screen.getByText('已辩论 2 轮')).toBeInTheDocument()
    expect(screen.getByText('已轮转 1 轮')).toBeInTheDocument()
    expect(item('Bull Researcher')).toHaveTextContent('×2')
    // One turn is not worth a badge.
    expect(item('Aggressive Analyst')).not.toHaveTextContent('×')
  })

  it('reports no rounds for an archived run, whose turns cannot be counted', () => {
    // A stored run collapses each speaker's whole history into one entry, so
    // App passes no turns rather than a count that would understate the run.
    render(<Timeline nodes={{}} selectedSlug={null} onSelectNode={noop} nodeHasContent={noContent} />)

    expect(screen.queryByText(/已辩论/)).toBeNull()
    expect(screen.queryByText(/已轮转/)).toBeNull()
    expect(item('Bull Researcher')).not.toHaveTextContent('×')
  })
})
