/**
 * What each member of the graph looks like in the office.
 *
 * Three things vary, and nothing else does: a hue, an optional market tone, and
 * the props they wear. The hue tints hair and clothes through `hsl()` in
 * app.css, so adding a role costs one number rather than a light/dark colour
 * pair per theme.
 *
 * Props come in two layers, because the two questions a viewer asks are "whose
 * room is this?" and "which one is this?". The first layer answers the team —
 * every analyst wears glasses, every risk seat a hard hat, every manager a tie
 * — and the second the person, with the thing they hold. One prop alone would
 * have to do both jobs and would do neither at sixteen pixels.
 *
 * `tone` is deliberately *not* derived from the hue. The five seats that argue
 * a direction wear the same red and green as the rating badges — A-share
 * convention, red is up — and those come from the semantic tokens so the two
 * cannot drift. Everyone else has no market direction to express, so their
 * colour is identity only, and the hue is all they need.
 */

import type { AccessoryKit } from './sprites'

export interface RoleLook {
  /** Degrees on the colour wheel; drives `--role-hue`. */
  hue: number
  /** A `data-tone` value, for the seats whose colour carries meaning. */
  tone?: string
  /** Team marker first, then the role's own object; drawn in this order. */
  kits: AccessoryKit[]
}

/** Keyed by graph node name, the same key `TIMELINE_NODES` and events use. */
export const ROLE_LOOK: Record<string, RoleLook> = {
  'Market Analyst': { hue: 210, kits: ['glasses', 'chart'] },
  'Sentiment Analyst': { hue: 288, kits: ['glasses', 'phone'] },
  'News Analyst': { hue: 186, kits: ['glasses', 'paper'] },
  'Fundamentals Analyst': { hue: 162, kits: ['glasses', 'calculator'] },
  'Annual Report Analyst': { hue: 28, kits: ['glasses', 'book'] },
  'Industry Chain Analyst': { hue: 252, kits: ['glasses', 'chain'] },
  'Bull Researcher': { hue: 6, tone: 'bullish', kits: ['arrow-up'] },
  'Bear Researcher': { hue: 152, tone: 'bearish', kits: ['arrow-down'] },
  'Research Manager': { hue: 224, kits: ['tie'] },
  Trader: { hue: 44, kits: ['monitor'] },
  // Three hats, one grid: the helmet paints in `b`, so each seat's tone colours
  // its own. Colour is the only thing that tells these three apart, which is
  // exactly what the debate is about.
  'Aggressive Analyst': { hue: 20, tone: 'lean-bullish', kits: ['helmet'] },
  'Conservative Analyst': { hue: 148, tone: 'lean-bearish', kits: ['helmet'] },
  'Neutral Analyst': { hue: 220, tone: 'neutral', kits: ['helmet'] },
  'Portfolio Manager': { hue: 266, kits: ['tie', 'briefcase'] },
}

/** A node the graph grows later still gets a person, just a plain one. */
const PLAIN: RoleLook = { hue: 220, kits: [] }

export function lookOf(node: string): RoleLook {
  return ROLE_LOOK[node] ?? PLAIN
}
