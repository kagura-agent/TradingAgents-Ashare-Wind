import { describe, expect, it } from 'vitest'
import {
  STAGE_LABELS,
  STAGE_SHAPES,
  STAGE_SHAPE_HINT,
  TIMELINE_NODES,
  countTurns,
  stageHint,
  stageNodes,
  stageRounds,
  type Stage,
} from './nodes'

const STAGES = Object.keys(STAGE_LABELS) as Stage[]

describe('stage topology', () => {
  it('gives every stage a shape', () => {
    for (const stage of STAGES) {
      expect(STAGE_SHAPES[stage]).toBeDefined()
      expect(STAGE_SHAPE_HINT[STAGE_SHAPES[stage]]).toBeDefined()
    }
  })

  it('marks the two nodes the debate loops exit to as judges', () => {
    const judges = TIMELINE_NODES.filter((n) => n.role === 'judge').map((n) => n.node)

    expect(judges).toEqual(['Research Manager', 'Portfolio Manager'])
  })

  it('splits a stage into participants and judges', () => {
    expect(stageNodes('research', 'participant').map((n) => n.node))
      .toEqual(['Bull Researcher', 'Bear Researcher'])
    expect(stageNodes('research', 'judge').map((n) => n.node)).toEqual(['Research Manager'])
    expect(stageNodes('trading', 'judge')).toEqual([])
  })
})

describe('countTurns', () => {
  it('counts each speaker separately', () => {
    const turns = countTurns([
      { speaker: 'Bull Researcher' },
      { speaker: 'Bear Researcher' },
      { speaker: 'Bull Researcher' },
    ])

    expect(turns).toEqual({ 'Bull Researcher': 2, 'Bear Researcher': 1 })
  })

  it('returns nothing for an empty stream', () => {
    expect(countTurns([])).toEqual({})
  })
})

describe('stageRounds', () => {
  it('divides turns by the number of participants', () => {
    // Two debaters, four turns: two complete rounds.
    expect(stageRounds('research', { 'Bull Researcher': 2, 'Bear Researcher': 2 })).toBe(2)
    // Three risk seats, one turn each: one round.
    expect(stageRounds('risk', {
      'Aggressive Analyst': 1, 'Conservative Analyst': 1, 'Neutral Analyst': 1,
    })).toBe(1)
  })

  it('rounds up, so a round in progress already counts', () => {
    expect(stageRounds('research', { 'Bull Researcher': 2, 'Bear Researcher': 1 })).toBe(2)
    expect(stageRounds('risk', { 'Aggressive Analyst': 1 })).toBe(1)
  })

  it('ignores judges, who speak once and are not part of the cycle', () => {
    expect(stageRounds('research', {
      'Bull Researcher': 1, 'Bear Researcher': 1, 'Research Manager': 1,
    })).toBe(1)
  })

  it('is null for stages that do not cycle', () => {
    expect(stageRounds('analysis', { 'Market Analyst': 1 })).toBeNull()
    expect(stageRounds('trading', { Trader: 1 })).toBeNull()
  })

  it('is null before the stage has spoken', () => {
    expect(stageRounds('research', {})).toBeNull()
  })
})

describe('stageHint', () => {
  it('describes the wiring before any turn has been taken', () => {
    expect(stageHint('analysis')).toBe('并行')
    expect(stageHint('research')).toBe('多空往返辩论')
    expect(stageHint('risk')).toBe('三方轮转')
  })

  it('switches to progress once a cyclic stage starts speaking', () => {
    const turns = { 'Bull Researcher': 2, 'Bear Researcher': 2, 'Aggressive Analyst': 1 }

    expect(stageHint('research', turns)).toBe('已辩论 2 轮')
    expect(stageHint('risk', turns)).toBe('已轮转 1 轮')
  })

  it('leaves the non-cyclic stages on their static hint', () => {
    const turns = { 'Bull Researcher': 2 }

    expect(stageHint('analysis', turns)).toBe('并行')
    // Nothing to say about a single node in sequence.
    expect(stageHint('trading', turns)).toBe('')
  })
})
