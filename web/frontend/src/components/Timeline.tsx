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
 * Three levels are selectable, and all three are one `Selection`: the whole
 * office at the top (components/Floorplan.tsx), a stage heading for that team's
 * room (components/Office.tsx), a row for one member's full content. Taking the
 * union rather than a selected-id/handler pair per level keeps the three from
 * disagreeing about what is on screen.
 */

import type { NodeStatus } from '../lib/analysisReducer'
import {
  NODE_STATUS_TEXT,
  OFFICE_ICON,
  OFFICE_LABEL,
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
import type { Selection } from '../lib/route'

interface TimelineProps {
  nodes: Record<string, NodeStatus>
  /** What the main column is showing, or `null` before it has settled. */
  selection: Selection | null
  onSelect: (selection: Selection) => void
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

export function Timeline({ nodes, selection, onSelect, nodeHasContent, turns }: TimelineProps) {
  const selectedSlug = selection?.kind === 'node' ? selection.slug : null
  const selectedStage = selection?.kind === 'stage' ? selection.stage : null
  const onSelectNode = (slug: string) => onSelect({ kind: 'node', slug })

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
      <button
        type="button"
        className="timeline__office"
        data-selected={selection?.kind === 'office' || undefined}
        onClick={() => onSelect({ kind: 'office' })}
        aria-label={`${OFFICE_LABEL} — ${
          selection?.kind === 'office' ? '当前查看' : '点击查看全部四个团队'
        }`}
      >
        <span className="timeline__stage-icon" aria-hidden="true">{OFFICE_ICON}</span>
        <span className="timeline__stage-name">{OFFICE_LABEL}</span>
      </button>

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
              onClick={() => onSelect({ kind: 'stage', stage })}
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
