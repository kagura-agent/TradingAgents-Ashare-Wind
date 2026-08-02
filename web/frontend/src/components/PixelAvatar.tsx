/**
 * One pixel person, drawn as inline SVG.
 *
 * Purely decorative: everything it conveys — who this is, what they are doing,
 * what they said — is real text elsewhere in the office, so the figure itself
 * is hidden from assistive technology.
 */

import { SPRITE_RUNS, SPRITE_SIZE, SLOT_VAR, type Pose } from '../lib/sprites'

interface Props {
  pose: Pose
  /** Drives the clothes colour through the `data-tone` tokens in tokens.css. */
  tone?: string
  /** `left` mirrors the figure, so two debaters can face each other. */
  facing?: 'left' | 'right'
}

export function PixelAvatar({ pose, tone, facing = 'right' }: Props) {
  return (
    <svg
      className="pixel-avatar"
      data-tone={tone}
      data-facing={facing}
      viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {SPRITE_RUNS[pose].map((run) => (
        <rect
          key={`${run.y}-${run.x}`}
          x={run.x}
          y={run.y}
          width={run.width}
          height={1}
          fill={`var(${SLOT_VAR[run.slot]})`}
        />
      ))}
    </svg>
  )
}
