import { describe, expect, it } from 'vitest'
import { hashFor, parseHash } from './route'
import { STAGES, TIMELINE_NODES, VALID_SLUGS } from './nodes'

describe('parseHash', () => {
  it('reads a bare run id', () => {
    expect(parseHash('#/job-1')).toEqual({ jobId: 'job-1', selection: null })
  })

  it('reads a node selection', () => {
    expect(parseHash('#/job-1/market-analyst')).toEqual({
      jobId: 'job-1',
      selection: { kind: 'node', slug: 'market-analyst' },
    })
  })

  it('reads a stage selection', () => {
    expect(parseHash('#/job-1/research')).toEqual({
      jobId: 'job-1',
      selection: { kind: 'stage', stage: 'research' },
    })
  })

  it('yields nothing for an empty hash', () => {
    expect(parseHash('')).toEqual({ jobId: null, selection: null })
    expect(parseHash('#')).toEqual({ jobId: null, selection: null })
    expect(parseHash('#/')).toEqual({ jobId: null, selection: null })
  })

  it('drops a segment it does not recognise rather than selecting nothing', () => {
    expect(parseHash('#/job-1/janitor')).toEqual({ jobId: 'job-1', selection: null })
  })
})

describe('hashFor', () => {
  it('clears the hash when there is no run', () => {
    expect(hashFor(null, { kind: 'stage', stage: 'analysis' })).toBe('')
  })

  it('round-trips every selection', () => {
    const selections = [
      null,
      ...TIMELINE_NODES.map((n) => ({ kind: 'node', slug: n.slug }) as const),
      ...STAGES.map((stage) => ({ kind: 'stage', stage }) as const),
    ]

    for (const selection of selections) {
      expect(parseHash(hashFor('job-1', selection))).toEqual({ jobId: 'job-1', selection })
    }
  })
})

it('keeps stage ids and node slugs disjoint, since both are one route segment', () => {
  for (const stage of STAGES) {
    expect(VALID_SLUGS.has(stage)).toBe(false)
  }
})
