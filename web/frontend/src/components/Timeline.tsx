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
  onSelectStage: (stage: Stage) => void
  stageHasContent: (stage: Stage) => boolean
}

function getStageStatus(stage: Stage, nodes: Record<string, NodeStatus>): 'pending' | 'running' | 'done' | 'partial' {
  const stageNodes = TIMELINE_NODES.filter((n) => n.stage === stage)
  const statuses = stageNodes.map((n) => nodes[n.node] ?? 'pending')
  if (statuses.every((s) => s === 'done')) return 'done'
  if (statuses.some((s) => s === 'running')) return 'running'
  if (statuses.some((s) => s === 'done')) return 'partial'
  return 'pending'
}

export function Timeline({ nodes, onSelectStage, stageHasContent }: TimelineProps) {
  return (
    <nav className="timeline" aria-label="执行进度">
      {STAGES.map((stage) => {
        const status = getStageStatus(stage, nodes)
        const clickable = status === 'done' || status === 'partial' || stageHasContent(stage)

        return (
          <section key={stage} className="timeline__section">
            <button
              type="button"
              className="timeline__stage-btn"
              data-status={status}
              data-clickable={clickable || undefined}
              onClick={() => clickable && onSelectStage(stage)}
              disabled={!clickable}
              aria-label={`${STAGE_LABELS[stage]} — ${status === 'done' ? '已完成，点击查看' : status === 'running' ? '进行中' : '待执行'}`}
            >
              <span className="timeline__stage-icon">{STAGE_ICONS[stage]}</span>
              <span className="timeline__stage-name">{STAGE_LABELS[stage]}</span>
              {clickable && <span className="timeline__stage-arrow" aria-hidden="true">→</span>}
            </button>
            <ul className="timeline__list">
              {TIMELINE_NODES.filter((n) => n.stage === stage).map((node) => {
                const nodeStatus = nodes[node.node] ?? 'pending'
                return (
                  <li
                    key={node.node}
                    className="timeline__item"
                    data-status={nodeStatus}
                    data-node={node.node}
                  >
                    <span className="timeline__dot" aria-hidden="true" />
                    <span>{node.label}</span>
                    <span className="visually-hidden">{STATUS_TEXT[nodeStatus]}</span>
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
