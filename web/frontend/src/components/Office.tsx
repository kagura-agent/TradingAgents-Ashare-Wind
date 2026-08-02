/**
 * A team at work, seen from above.
 *
 * The sidebar says how a stage is wired; this says what that looks like. Each
 * stage's shape (lib/nodes.ts `STAGE_SHAPES`) picks its floor plan — six
 * analysts at their own desks, two researchers standing at opposite ends of a
 * debate with their manager listening from the gallery, three risk seats around
 * a table — and everyone's latest output hangs above their head. Clicking a
 * person opens their full content.
 *
 * Layout is CSS Grid throughout: no absolute coordinates, so it reflows on a
 * phone and every desk is a real focusable control rather than a hit region.
 */

import type { NodeStatus } from '../lib/analysisReducer'
import { excerpt } from '../lib/excerpt'
import { nodeTexts } from '../lib/nodeContent'
import {
  NODE_STATUS_TEXT,
  STAGE_ICONS,
  STAGE_LABELS,
  STAGE_SHAPES,
  stageHint,
  stageNodes,
  type Stage,
  type TimelineNode,
} from '../lib/nodes'
import type { Pose } from '../lib/sprites'
import type { ResultView } from '../lib/view'
import { PixelAvatar } from './PixelAvatar'
import { RatingBadge } from './RatingBadge'

/** Roughly one line of a bubble at the widest desk. */
const BUBBLE_CHARS = 64

/** A debater's last two turns hang above them; earlier rounds collapse. */
const DEBATE_BUBBLES = 2

/** Where each risk seat sits around the table, in `stageNodes` order. */
const RING_SEATS = ['top', 'left', 'right']

/** Clothes colour per role. A-share convention: bulls red, bears green. */
const ROLE_TONE: Record<string, string> = {
  'Bull Researcher': 'bullish',
  'Bear Researcher': 'bearish',
  'Aggressive Analyst': 'lean-bullish',
  'Neutral Analyst': 'neutral',
  'Conservative Analyst': 'lean-bearish',
}

interface Props {
  stage: Stage
  nodes: Record<string, NodeStatus>
  view: ResultView
  /** Per-speaker turn counts; omitted for an archived run (see App). */
  turns?: Record<string, number>
  onSelectNode: (slug: string) => void
}

interface BubbleProps {
  texts: string[]
  status: NodeStatus
  limit: number
}

function Bubbles({ texts, status, limit }: BubbleProps) {
  const shown = texts.slice(-limit)
  const hidden = texts.length - shown.length

  return (
    <div className="office__bubbles">
      {hidden > 0 && <span className="office__bubble-more">前 {hidden} 轮已折叠</span>}
      {shown.length === 0 ? (
        <p className="office__bubble" data-empty="true">
          {status === 'running' ? '正在写…' : '待命'}
        </p>
      ) : (
        shown.map((text, i) => (
          <p key={hidden + i} className="office__bubble">
            {excerpt(text, BUBBLE_CHARS)}
          </p>
        ))
      )}
    </div>
  )
}

interface SeatProps {
  node: TimelineNode
  status: NodeStatus
  texts: string[]
  pose: Pose
  bubbles: number
  facing?: 'left' | 'right'
  /** Position within the floor plan, for the grid to place off. */
  side?: string
  onSelect: (slug: string) => void
}

function Seat({ node, status, texts, pose, bubbles, facing, side, onSelect }: SeatProps) {
  const person = (
    <>
      <PixelAvatar pose={pose} tone={ROLE_TONE[node.node]} facing={facing} />
      <span className="office__desk" aria-hidden="true" />
      <span className="office__nameplate">
        <span className="office__lamp" aria-hidden="true" />
        {node.label}
      </span>
    </>
  )

  return (
    <div
      className="office__seat"
      data-seat={node.node}
      data-status={status}
      data-role={node.role}
      data-side={side}
    >
      {/* Outside the button on purpose: as the button's accessible name it
          would replace the desk's own label, and as sibling text it stays
          readable on its own. */}
      <Bubbles texts={texts} status={status} limit={bubbles} />
      {texts.length > 0 ? (
        <button
          type="button"
          className="office__person"
          data-clickable=""
          onClick={() => onSelect(node.slug)}
          aria-label={`${node.label} — ${NODE_STATUS_TEXT[status]}，点击查看完整内容`}
        >
          {person}
        </button>
      ) : (
        <div className="office__person">
          {person}
          <span className="visually-hidden">{NODE_STATUS_TEXT[status]}</span>
        </div>
      )}
    </div>
  )
}

export function Office({ stage, nodes, view, turns, onSelectNode }: Props) {
  const shape = STAGE_SHAPES[stage]
  const participants = stageNodes(stage, 'participant')
  const judges = stageNodes(stage, 'judge')
  const hint = stageHint(stage, turns)

  const seat = (
    node: TimelineNode,
    pose: Pose,
    extra: { bubbles?: number; facing?: 'left' | 'right'; side?: string } = {},
  ) => {
    const texts = nodeTexts(node.slug, view)
    // An archived run carries no node statuses, so content stands in for them —
    // the same fallback the timeline makes for clickability.
    const status = nodes[node.node] ?? (texts.length > 0 ? 'done' : 'pending')

    return (
      <Seat
        key={node.node}
        node={node}
        status={status}
        texts={texts}
        pose={pose}
        bubbles={extra.bubbles ?? 1}
        facing={extra.facing}
        side={extra.side}
        onSelect={onSelectNode}
      />
    )
  }

  const floor = () => {
    if (shape === 'debate') {
      const [left, right] = participants
      return (
        <>
          {seat(left, 'standing', { facing: 'right', side: 'left', bubbles: DEBATE_BUBBLES })}
          <span className="office__versus" aria-hidden="true">
            ⚔️
          </span>
          {seat(right, 'standing', { facing: 'left', side: 'right', bubbles: DEBATE_BUBBLES })}
        </>
      )
    }

    if (shape === 'round-robin') {
      return (
        <>
          <span className="office__table" aria-hidden="true" />
          {participants.map((node, i) => seat(node, 'seated', { side: RING_SEATS[i] }))}
        </>
      )
    }

    return <>{participants.map((node) => seat(node, 'seated'))}</>
  }

  return (
    <section className="office" data-shape={shape} aria-label={`${STAGE_LABELS[stage]}办公区`}>
      <header className="office__header">
        <span className="office__icon" aria-hidden="true">
          {STAGE_ICONS[stage]}
        </span>
        <h2 className="office__title">{STAGE_LABELS[stage]}</h2>
        {hint && <span className="office__hint">{hint}</span>}
      </header>

      <div className="office__floor">{floor()}</div>

      {judges.length > 0 && (
        <div className="office__gallery">
          {judges.map((node) => seat(node, 'seated'))}
          {/* The signal is the portfolio manager's call, not the research
              manager's, so it belongs to exactly one gallery. */}
          {stage === 'risk' && view.signal && <RatingBadge signal={view.signal} size="lg" />}
        </div>
      )}
    </section>
  )
}
