/**
 * Left column: every graph node, where the run currently is, and how the
 * stages are actually wired.
 *
 * The graph is not the straight line a flat list implies. Each stage carries a
 * `data-shape` so the stylesheet can draw its real topology — a fan-out rail
 * for the independent analysts, a loop rail for the two debates — and the
 * judges that the debate loops exit *to* are split into their own list so they
 * sit a level above the participants rather than queued behind them.
 *
 * Two levels are selectable: a stage heading opens that team's office
 * (components/Office.tsx), a row opens one member's full content.
 */

import type { NodeStatus } from '../lib/analysisReducer'
import {
  NODE_STATUS_TEXT,
  STAGES,
  STAGE_ICONS,
  STAGE_LABELS,
  STAGE_SHAPES,
  stageHint,
  stageNodes,
  type NodeRole,
  type Stage,
  type TimelineNode,
} from '../lib/nodes'

interface TimelineProps {
  nodes: Record<string, NodeStatus>
  selectedSlug: string | null
  /** The stage whose office is on screen, if any. */
  selectedStage: Stage | null
  onSelectNode: (slug: string) => void
  onSelectStage: (stage: Stage) => void
  nodeHasContent: (slug: string) => boolean
  /**
   * Turns taken per speaker, for the two cyclic stages. Omitted for an
   * archived run, whose stored histories cannot report a truthful count.
   */
  turns?: Record<string, number>
}

interface ItemProps {
  node: TimelineNode
  status: NodeStatus
  selectedSlug: string | null
  onSelectNode: (slug: string) => void
  nodeHasContent: (slug: string) => boolean
  turns?: Record<string, number>
}

function TimelineItem({ node, status, selectedSlug, onSelectNode, nodeHasContent, turns }: ItemProps) {
  const clickable = status === 'done' || nodeHasContent(node.slug)
  const selected = node.slug === selectedSlug
  const taken = turns?.[node.node] ?? 0
  const badge = taken > 1
    ? <span className="timeline__turn-badge" aria-hidden="true">×{taken}</span>
    : null
  const spoken = taken > 1 ? `，发言 ${taken} 次` : ''

  return (
    <li
      className="timeline__item"
      data-status={status}
      data-clickable={clickable || undefined}
      data-selected={selected || undefined}
      data-node={node.node}
      data-role={node.role}
    >
      {clickable ? (
        <button
          type="button"
          className="timeline__node-btn"
          data-selected={selected || undefined}
          onClick={() => onSelectNode(node.slug)}
          aria-label={`${node.label} — ${selected ? '当前查看' : '点击查看'}${spoken}`}
        >
          <span className="timeline__dot" aria-hidden="true" />
          <span className="timeline__node-label">{node.label}</span>
          {badge}
          {selected
            ? <span className="timeline__node-arrow" aria-hidden="true">●</span>
            : <span className="timeline__node-arrow" aria-hidden="true">→</span>
          }
        </button>
      ) : (
        <>
          <span className="timeline__dot" aria-hidden="true" />
          <span>{node.label}</span>
          {badge}
          <span className="visually-hidden">{NODE_STATUS_TEXT[status]}{spoken}</span>
        </>
      )}
    </li>
  )
}

export function Timeline({
  nodes,
  selectedSlug,
  selectedStage,
  onSelectNode,
  onSelectStage,
  nodeHasContent,
  turns,
}: TimelineProps) {
  const renderList = (stage: Stage, role: NodeRole) => {
    const members = stageNodes(stage, role)
    if (members.length === 0) return null

    return (
      <ul className="timeline__list" data-shape={STAGE_SHAPES[stage]} data-role={role}>
        {members.map((node) => (
          <TimelineItem
            key={node.node}
            node={node}
            status={nodes[node.node] ?? 'pending'}
            selectedSlug={selectedSlug}
            onSelectNode={onSelectNode}
            nodeHasContent={nodeHasContent}
            turns={turns}
          />
        ))}
      </ul>
    )
  }

  return (
    <nav className="timeline" aria-label="执行进度">
      {STAGES.map((stage) => {
        const hint = stageHint(stage, turns)
        const selected = stage === selectedStage

        return (
          <section key={stage} className="timeline__section">
            <button
              type="button"
              className="timeline__stage-header"
              data-stage={stage}
              data-selected={selected || undefined}
              onClick={() => onSelectStage(stage)}
              aria-label={`${STAGE_LABELS[stage]} — ${selected ? '当前查看' : '点击查看团队办公区'}`}
            >
              <span className="timeline__stage-icon" aria-hidden="true">{STAGE_ICONS[stage]}</span>
              <span className="timeline__stage-name">{STAGE_LABELS[stage]}</span>
              {hint && <span className="timeline__stage-hint">{hint}</span>}
            </button>
            {renderList(stage, 'participant')}
            {renderList(stage, 'judge')}
          </section>
        )
      })}
    </nav>
  )
}
