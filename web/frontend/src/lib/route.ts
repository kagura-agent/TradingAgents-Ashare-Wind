/**
 * What the address bar holds: which run, and what within it is on screen.
 *
 * Selection is a union rather than a slug string because the main column now
 * shows three different things — every room at once, one team's office, or one
 * member's full content — and a bare string could not tell them apart. Stage
 * ids double as route segments; route.test.ts pins that neither they nor
 * `OFFICE_ROUTE` ever collide with a node slug.
 */

import { STAGES, VALID_SLUGS, type Stage } from './nodes'

export type Selection =
  | { kind: 'node'; slug: string }
  | { kind: 'stage'; stage: Stage }
  | { kind: 'office' }

/** The whole-office overview, and the default landing view. */
export const OFFICE_ROUTE = 'office'

const STAGE_ROUTES = new Set<string>(STAGES)

/** The single path segment a selection is written as. */
function segmentOf(selection: Selection): string {
  if (selection.kind === 'node') return selection.slug
  if (selection.kind === 'stage') return selection.stage
  return OFFICE_ROUTE
}

/** An unrecognised segment yields `null` rather than a selection of nothing. */
function selectionOf(segment: string): Selection | null {
  if (segment === OFFICE_ROUTE) return { kind: 'office' }
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
