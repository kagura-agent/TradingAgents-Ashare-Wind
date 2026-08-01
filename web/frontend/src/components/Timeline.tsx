/** Left column: every graph node and where the run currently is. */

import type { NodeStatus } from '../lib/analysisReducer'
import { STAGE_LABELS, TIMELINE_NODES, type Stage } from '../lib/nodes'

const STAGES: Stage[] = ['analysis', 'research', 'trading', 'risk']

const STATUS_TEXT: Record<NodeStatus, string> = {
  pending: '待执行',
  running: '进行中',
  done: '已完成',
}

const STAGE_ICONS: Record<Stage, string> = {
  analysis: '📊',
  research: '⚔️',
  trading: '💹',
  risk: '🛡️',
}

interface TimelineProps {
  nodes: Record<string, NodeStatus>
  selectedSlug: string | null
  onSelectNode: (slug: string) => void
  nodeHasContent: (slug: string) => boolean
}

export function Timeline({ nodes, selectedSlug, onSelectNode, nodeHasContent }: TimelineProps) {
  return (
    <nav className="timeline" aria-label="执行进度">
      {STAGES.map((stage) => (
        <section key={stage} className="timeline__section">
          <div className="timeline__stage-header">
            <span className="timeline__stage-icon">{STAGE_ICONS[stage]}</span>
            <span className="timeline__stage-name">{STAGE_LABELS[stage]}</span>
          </div>
          <ul className="timeline__list">
            {TIMELINE_NODES.filter((n) => n.stage === stage).map((node) => {
              const nodeStatus = nodes[node.node] ?? 'pending'
              const clickable = nodeStatus === 'done' || nodeHasContent(node.slug)
              const selected = node.slug === selectedSlug

              return (
                <li
                  key={node.node}
                  className="timeline__item"
                  data-status={nodeStatus}
                  data-clickable={clickable || undefined}
                  data-selected={selected || undefined}
                  data-node={node.node}
                >
                  {clickable ? (
                    <button
                      type="button"
                      className="timeline__node-btn"
                      data-selected={selected || undefined}
                      onClick={() => onSelectNode(node.slug)}
                      aria-label={`${node.label} — ${selected ? '当前查看' : '点击查看'}`}
                    >
                      <span className="timeline__dot" aria-hidden="true" />
                      <span className="timeline__node-label">{node.label}</span>
                      {selected
                        ? <span className="timeline__node-arrow" aria-hidden="true">●</span>
                        : <span className="timeline__node-arrow" aria-hidden="true">→</span>
                      }
                    </button>
                  ) : (
                    <>
                      <span className="timeline__dot" aria-hidden="true" />
                      <span>{node.label}</span>
                      <span className="visually-hidden">{STATUS_TEXT[nodeStatus]}</span>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </nav>
  )
}
