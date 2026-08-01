import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Timeline } from './Timeline'
import { STAGE_LABELS, TIMELINE_NODES } from '../lib/nodes'
import type { NodeStatus } from '../lib/analysisReducer'
import type { Stage } from '../lib/nodes'

const noop = () => {}
const allExpanded = new Set<Stage>(['analysis', 'research', 'trading', 'risk'])

function item(node: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-node="${node}"]`)
  if (!el) throw new Error(`timeline item missing: ${node}`)
  return el
}

describe('Timeline', () => {
  it('renders every node up front so the run has a visible shape', () => {
    render(<Timeline nodes={{}} expandedStages={allExpanded} onToggleStage={noop} />)

    expect(document.querySelectorAll('[data-node]')).toHaveLength(TIMELINE_NODES.length)
    for (const node of TIMELINE_NODES) {
      expect(item(node.node)).toHaveAttribute('data-status', 'pending')
      expect(screen.getByText(node.label)).toBeInTheDocument()
    }
  })

  it('groups nodes under their stage headings', () => {
    render(<Timeline nodes={{}} expandedStages={allExpanded} onToggleStage={noop} />)

    for (const label of Object.values(STAGE_LABELS)) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(screen.getByRole('navigation', { name: '执行进度' })).toBeInTheDocument()
  })

  it('reflects node status transitions', () => {
    const nodes: Record<string, NodeStatus> = { 'Market Analyst': 'running' }
    const { rerender } = render(<Timeline nodes={nodes} expandedStages={allExpanded} onToggleStage={noop} />)

    expect(item('Market Analyst')).toHaveAttribute('data-status', 'running')
    expect(item('News Analyst')).toHaveAttribute('data-status', 'pending')

    rerender(<Timeline nodes={{ 'Market Analyst': 'done', 'News Analyst': 'running' }} expandedStages={allExpanded} onToggleStage={noop} />)

    expect(item('Market Analyst')).toHaveAttribute('data-status', 'done')
    expect(item('News Analyst')).toHaveAttribute('data-status', 'running')
  })

  it('announces status in text for screen readers', () => {
    render(<Timeline nodes={{ Trader: 'running' }} expandedStages={allExpanded} onToggleStage={noop} />)

    expect(item('Trader')).toHaveTextContent('进行中')
    expect(item('Portfolio Manager')).toHaveTextContent('待执行')
  })

  it('ignores nodes it does not know about', () => {
    render(<Timeline nodes={{ 'Some Future Agent': 'running' }} expandedStages={allExpanded} onToggleStage={noop} />)

    expect(document.querySelectorAll('[data-node]')).toHaveLength(TIMELINE_NODES.length)
    expect(screen.queryByText('Some Future Agent')).toBeNull()
  })
})
