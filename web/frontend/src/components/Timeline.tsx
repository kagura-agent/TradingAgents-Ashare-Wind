/** Left column: every graph node and where the run currently is. */

import type { NodeStatus } from '../lib/analysisReducer'
import { STAGE_LABELS, TIMELINE_NODES, type Stage } from '../lib/nodes'

const STAGES: Stage[] = ['analysis', 'research', 'trading', 'risk']

const STATUS_TEXT: Record<NodeStatus, string> = {
  pending: '待执行',
  running: '进行中',
  done: '已完成',
}

interface TimelineProps {
  nodes: Record<string, NodeStatus>
  expandedStages: Set<Stage>
  onToggleStage: (stage: Stage) => void
}

export function Timeline({ nodes, expandedStages, onToggleStage }: TimelineProps) {
  return (
    <nav className="timeline" aria-label="执行进度">
      {STAGES.map((stage) => {
        const expanded = expandedStages.has(stage)
        return (
          <section key={stage} className="timeline__section">
            <button
              type="button"
              className="timeline__stage-label"
              onClick={() => onToggleStage(stage)}
              aria-expanded={expanded}
            >
              <span
                className="timeline__chevron"
                data-open={expanded || undefined}
                aria-hidden="true"
              >
                ▶
              </span>
              {STAGE_LABELS[stage]}
            </button>
            <ul className="timeline__list">
              {TIMELINE_NODES.filter((n) => n.stage === stage).map((node) => {
                const status = nodes[node.node] ?? 'pending'
                return (
                  <li
                    key={node.node}
                    className="timeline__item"
                    data-status={status}
                    data-node={node.node}
                    onClick={() => onToggleStage(stage)}
                  >
                    <span className="timeline__dot" aria-hidden="true" />
                    <span>{node.label}</span>
                    <span className="visually-hidden">{STATUS_TEXT[status]}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </nav>
  )
}
