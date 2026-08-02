/**
 * One pixel person, drawn as inline SVG.
 *
 * Two passes: the shared body, then the few pixels of prop that say which team
 * and which job this is. Purely decorative — everything it conveys (who this
 * is, what they are doing, what they said) is real text elsewhere in the
 * office, so the figure itself is hidden from assistive technology.
 */

import type { CSSProperties } from 'react'
import type { RoleLook } from '../lib/roleLook'
import {
  ACCESSORY_RUNS,
  SPRITE_RUNS,
  SPRITE_SIZE,
  SLOT_VAR,
  type PixelRun,
  type Pose,
} from '../lib/sprites'

interface Props {
  pose: Pose
  /** Hue, market tone and prop — see lib/roleLook.ts. */
  look: RoleLook
  /** `left` mirrors the figure, so two debaters can face each other. */
  facing?: 'left' | 'right'
}

function rects(runs: PixelRun[], layer: string) {
  return runs.map((run) => (
    <rect
      key={`${layer}-${run.y}-${run.x}`}
      x={run.x}
      y={run.y}
      width={run.width}
      height={1}
      fill={`var(${SLOT_VAR[run.slot]})`}
    />
  ))
}

export function PixelAvatar({ pose, look, facing = 'right' }: Props) {
  return (
    <svg
      className="pixel-avatar"
      data-tone={look.tone}
      data-facing={facing}
      // A string, not a number: React only knows to leave custom properties
      // alone, and `hsl(var(--role-hue) …)` in app.css wants a bare token.
      style={{ '--role-hue': String(look.hue) } as CSSProperties}
      viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {rects(SPRITE_RUNS[pose], 'body')}
      {/* Later passes, so a prop sits on top of the body it is held against. */}
      {look.kits.map((kit) => rects(ACCESSORY_RUNS[kit], kit))}
    </svg>
  )
}
