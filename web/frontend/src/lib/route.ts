/**
 * What the address bar holds: which run, and what within it is on screen.
 *
 * Selection is a union rather than a slug string because the main column now
 * shows two different things — a whole team's office, or one member's full
 * content — and a bare string could not tell them apart. Stage ids double as
 * route segments; route.test.ts pins that they never collide with a node slug.
 */

import { STAGES, VALID_SLUGS, type Stage } from './nodes'

export type Selection =
  | { kind: 'node'; slug: string }
  | { kind: 'stage'; stage: Stage }

const STAGE_ROUTES = new Set<string>(STAGES)

/** The single path segment a selection is written as. */
function segmentOf(selection: Selection): string {
  return selection.kind === 'node' ? selection.slug : selection.stage
}

/** An unrecognised segment yields `null` rather than a selection of nothing. */
function selectionOf(segment: string): Selection | null {
  if (VALID_SLUGS.has(segment)) return { kind: 'node', slug: segment }
  if (STAGE_ROUTES.has(segment)) return { kind: 'stage', stage: segment as Stage }
  return null
}

export function parseHash(hash: string): { jobId: string | null; selection: Selection | null } {
  const path = hash.replace(/^#\/?/, '')
  if (!path) return { jobId: null, selection: null }

  const [jobId, segment] = path.split('/')
  return {
    jobId: jobId || null,
    selection: segment ? selectionOf(segment) : null,
  }
}

/** The inverse of `parseHash`; empty string means "no run, clear the hash". */
export function hashFor(jobId: string | null, selection: Selection | null): string {
  if (!jobId) return ''
  return selection ? `#/${jobId}/${segmentOf(selection)}` : `#/${jobId}`
}
