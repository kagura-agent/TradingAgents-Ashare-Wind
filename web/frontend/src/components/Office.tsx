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
 *
 * The same component is also one room of the whole-office overview (see
 * Floorplan.tsx). `compact` is what tells the two apart: there a bubble goes to
 * everyone who has actually said something and to nobody else, so a room fills
 * up as the run passes through it instead of showing fourteen 「待命」 placeholders.
 */

import type { NodeStatus } from '../lib/analysisReducer'
import { excerpt } from '../lib/excerpt'
import { nodeTexts, nodeSummary } from '../lib/nodeContent'
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
import { lookOf } from '../lib/roleLook'
import type { ResultView } from '../lib/view'
import { PixelAvatar } from './PixelAvatar'
import { RatingBadge } from './RatingBadge'

/** Roughly one line of a bubble at the widest desk. */
const BUBBLE_CHARS = 64

/** A debater's last two turns hang above them; earlier rounds collapse. */
const DEBATE_BUBBLES = 2

/** Where each risk seat sits around the table, in `stageNodes` order. */
const RING_SEATS = ['top', 'left', 'right']

interface Props {
  stage: Stage
  nodes: Record<string, NodeStatus>
  view: ResultView
  /** Per-speaker turn counts; omitted for an archived run (see App). */
  turns?: Record<string, number>
  onSelectNode: (slug: string) => void
  /** One room of the overview rather than the whole main column. */
  compact?: boolean
  /** Given, the room's heading becomes the control that opens it full size. */
  onOpenStage?: (stage: Stage) => void
}

interface BubbleProps {
  texts: string[]
  summary: string | null
  status: NodeStatus
  limit: number
}

function Bubbles({ texts, summary, status, limit }: BubbleProps) {
  const shown = texts.slice(-limit)
  const hidden = texts.length - shown.length

  return (
    <div className="office__bubbles">
      {hidden > 0 && <span className="office__bubble-more">前 {hidden} 轮已折叠</span>}
      {shown.length === 0 ? (
        <p className="office__bubble" data-empty="true">
          {status === 'running' ? '正在写…' : '待命'}
        </p>
      ) : summary ? (
        <p className="office__bubble">{summary}</p>
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
  summary: string | null
  pose: Pose
  /** How many recent turns hang above this head; `0` means no bubble at all. */
  bubbles: number
  facing?: 'left' | 'right'
  /** Position within the floor plan, for the grid to place off. */
  side?: string
  onSelect: (slug: string) => void
}

function Seat({ node, status, texts, summary, pose, bubbles, facing, side, onSelect }: SeatProps) {
  const person = (
    <>
      <PixelAvatar pose={pose} look={lookOf(node.node)} facing={facing} />
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
          readable on its own. Dropped entirely rather than emptied when the
          room shows none — an empty bubble still says "待命", and fourteen of
          those is the noise the overview exists to avoid. */}
      {bubbles > 0 && <Bubbles texts={texts} summary={summary} status={status} limit={bubbles} />}
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

export function Office({ stage, nodes, view, turns, onSelectNode, compact, onOpenStage }: Props) {
  const shape = STAGE_SHAPES[stage]
  const participants = stageNodes(stage, 'participant')
  const judges = stageNodes(stage, 'judge')
  const hint = stageHint(stage, turns)
  // Lit once the run reaches the room, and lit from then on. Tracking only who
  // is `running` would blink: a node's start, output and completion arrive in
  // one frame and the next node starts a few hundred milliseconds later, so the
  // outline spent most of a run off. An archived run carries no statuses, so
  // nothing lights up — there is no progress left to show.
  const reached = [...participants, ...judges].some((n) => {
    const status = nodes[n.node]
    return status === 'running' || status === 'done'
  })

  const seat = (
    node: TimelineNode,
    pose: Pose,
    extra: { bubbles?: number; facing?: 'left' | 'right'; side?: string } = {},
  ) => {
    const texts = nodeTexts(node.slug, view)
    const summary = nodeSummary(node.slug, view)
    // An archived run carries no node statuses, so content stands in for them —
    // the same fallback the timeline makes for clickability.
    const status = nodes[node.node] ?? (texts.length > 0 ? 'done' : 'pending')
    // How many turns a desk shows is the floor plan's business either way; what
    // `compact` changes is that a desk with nothing to say shows no bubble at
    // all, rather than fourteen rooms of 「待命」.
    const limit = extra.bubbles ?? 1
    const speaks = texts.length > 0 || status === 'running'

    return (
      <Seat
        key={node.node}
        node={node}
        status={status}
        texts={texts}
        summary={summary}
        pose={pose}
        bubbles={compact && !speaks ? 0 : limit}
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

  // A room of the overview sits under the overview's own heading, so it drops a
  // level; on its own in the main column it is the heading.
  const Title = compact ? 'h3' : 'h2'
  const heading = (
    <>
      <span className="office__icon" aria-hidden="true">
        {STAGE_ICONS[stage]}
      </span>
      <Title className="office__title">{STAGE_LABELS[stage]}</Title>
    </>
  )

  return (
    <section
      className="office"
      data-shape={shape}
      data-stage={stage}
      data-compact={compact || undefined}
      data-reached={reached || undefined}
      aria-label={`${STAGE_LABELS[stage]}办公区`}
    >
      <header className="office__header">
        {onOpenStage ? (
          <button
            type="button"
            className="office__open"
            onClick={() => onOpenStage(stage)}
            aria-label={`${STAGE_LABELS[stage]}办公区 — 点击放大查看`}
          >
            {heading}
          </button>
        ) : (
          heading
        )}
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
