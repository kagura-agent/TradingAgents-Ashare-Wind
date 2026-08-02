import { describe, expect, it } from 'vitest'
import { ROLE_LOOK, lookOf } from './roleLook'
import { ACCESSORIES } from './sprites'
import { TIMELINE_NODES } from './nodes'

describe('ROLE_LOOK', () => {
  it('gives every node in the graph its own look', () => {
    for (const node of TIMELINE_NODES) {
      expect(ROLE_LOOK).toHaveProperty(node.node)
    }
    // No entry for a node that no longer exists.
    expect(Object.keys(ROLE_LOOK).sort()).toEqual(TIMELINE_NODES.map((n) => n.node).sort())
  })

  it('keeps the six analysts far enough apart to tell one desk from another', () => {
    // They sit side by side, all seated, all facing the same way — colour is
    // most of what distinguishes them, so near-identical hues would not do.
    const hues = TIMELINE_NODES.filter((n) => n.stage === 'analysis')
      .map((n) => lookOf(n.node).hue)
      .sort((a, b) => a - b)

    for (let i = 1; i < hues.length; i += 1) {
      expect(hues[i] - hues[i - 1]).toBeGreaterThanOrEqual(20)
    }
  })

  it('holds every hue on the wheel', () => {
    for (const look of Object.values(ROLE_LOOK)) {
      expect(look.hue).toBeGreaterThanOrEqual(0)
      expect(look.hue).toBeLessThan(360)
    }
  })

  it('dresses the direction-taking seats in the market tone, and no one else', () => {
    // A-share convention: red is up. These five wear the same tokens as the
    // rating badges so the two cannot drift apart.
    const toned = Object.fromEntries(
      Object.entries(ROLE_LOOK).filter(([, l]) => l.tone).map(([node, l]) => [node, l.tone]),
    )

    expect(toned).toEqual({
      'Bull Researcher': 'bullish',
      'Bear Researcher': 'bearish',
      'Aggressive Analyst': 'lean-bullish',
      'Neutral Analyst': 'neutral',
      'Conservative Analyst': 'lean-bearish',
    })
  })

  it('hands out only props that exist, and gives the three risk seats one hat', () => {
    for (const look of Object.values(ROLE_LOOK)) {
      for (const kit of look.kits) expect(ACCESSORIES).toHaveProperty(kit)
    }

    const risk = TIMELINE_NODES.filter((n) => n.stage === 'risk' && n.role === 'participant')
    // One grid, three colours: the helmet is painted in the wearer's tone.
    expect(risk.map((n) => lookOf(n.node).kits)).toEqual([['helmet'], ['helmet'], ['helmet']])
  })

  it('marks the team on every analyst, and the person under it', () => {
    // Glasses say "this is the analyst floor" from across the room; the second
    // prop is what tells one desk from the next once you are looking at it.
    for (const node of TIMELINE_NODES.filter((n) => n.stage === 'analysis')) {
      expect(lookOf(node.node).kits[0]).toBe('glasses')
      expect(lookOf(node.node).kits).toHaveLength(2)
    }
  })

  it('gives no two people in a room the same props', () => {
    for (const stage of ['analysis', 'research', 'trading'] as const) {
      const kits = TIMELINE_NODES.filter((n) => n.stage === stage).map((n) =>
        lookOf(n.node).kits.join('+'),
      )

      expect(new Set(kits).size).toBe(kits.length)
    }
  })
})

describe('lookOf', () => {
  it('still returns a person for a node the graph grows later', () => {
    const look = lookOf('Some Future Agent')

    expect(look.hue).toBeGreaterThanOrEqual(0)
    expect(look.tone).toBeUndefined()
    expect(look.kits).toEqual([])
  })
})
