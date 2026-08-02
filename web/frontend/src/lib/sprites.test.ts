import { describe, expect, it } from 'vitest'
import {
  ACCESSORIES,
  ACCESSORY_RUNS,
  SLOT_VAR,
  SPRITES,
  SPRITE_RUNS,
  SPRITE_SIZE,
  accessoryRuns,
  spriteRuns,
  type AccessoryKit,
  type Pose,
} from './sprites'

const POSES = Object.keys(SPRITES) as Pose[]
const KITS = Object.keys(ACCESSORIES) as AccessoryKit[]

function slotsIn(rows: readonly string[]): string[] {
  return [...rows.join('')].filter((ch) => ch !== '.')
}

describe('sprite grids', () => {
  it('are square, at the size the viewBox claims', () => {
    for (const pose of POSES) {
      expect(SPRITES[pose]).toHaveLength(SPRITE_SIZE)
      for (const row of SPRITES[pose]) {
        expect(row).toHaveLength(SPRITE_SIZE)
      }
    }
  })

  it('use only characters the palette can paint', () => {
    for (const pose of POSES) {
      for (const slot of slotsIn(SPRITES[pose])) {
        expect(SLOT_VAR).toHaveProperty(slot)
      }
    }
  })

  it('paint every palette slot into a custom property', () => {
    for (const name of Object.values(SLOT_VAR)) {
      expect(name).toMatch(/^--pixel-/)
    }
  })
})

describe('accessory grids', () => {
  it('are the same width as a body, and fit inside one', () => {
    for (const kit of KITS) {
      const { y, rows } = ACCESSORIES[kit]
      expect(rows.length).toBeGreaterThan(0)
      expect(y + rows.length).toBeLessThanOrEqual(SPRITE_SIZE)
      for (const row of rows) {
        expect(row).toHaveLength(SPRITE_SIZE)
      }
    }
  })

  it('use only characters the palette can paint, and paint something', () => {
    for (const kit of KITS) {
      const slots = slotsIn(ACCESSORIES[kit].rows)
      expect(slots.length).toBeGreaterThan(0)
      for (const slot of slots) {
        expect(SLOT_VAR).toHaveProperty(slot)
      }
    }
  })

  it('stay a prop rather than a repaint of the whole figure', () => {
    for (const kit of KITS) {
      const body = SPRITES.seated.join('').replace(/\./g, '').length
      expect(slotsIn(ACCESSORIES[kit].rows).length).toBeLessThan(body / 3)
    }
  })

  it('are offset to where they are worn, not to row zero', () => {
    for (const run of accessoryRuns('helmet')) {
      expect(run.y).toBeLessThan(2)
    }
    // The rims have to land on the face for the pupils to sit inside them.
    expect(accessoryRuns('glasses').map((r) => r.y)).toContain(4)
  })

  it('hold everything but the worn props out in the margin', () => {
    // The torso is x4-11. A prop drawn across it reads as a pattern on the
    // shirt; the same prop drawn beside the body has its own silhouette, which
    // at three screen pixels per grid pixel is what makes it legible at all.
    const WORN: AccessoryKit[] = ['glasses', 'tie', 'helmet']

    for (const kit of KITS.filter((k) => !WORN.includes(k))) {
      for (const run of accessoryRuns(kit)) {
        expect(run.x).toBeGreaterThanOrEqual(11)
      }
    }
  })

  it('stop above the legs of a seated figure', () => {
    // Row 13 is a solid `d` across the seated body. A prop drawn level with it
    // is the same colour, touching, and the two merge into one bar.
    const legs = SPRITES.seated.findIndex((row) => row === '....dddddddd....')

    for (const kit of KITS) {
      for (const run of accessoryRuns(kit)) {
        expect(run.y).toBeLessThan(legs)
      }
    }
  })
})

describe('run extraction', () => {
  it('covers exactly the opaque pixels, and each one once', () => {
    for (const pose of POSES) {
      const covered: string[] = []
      for (const run of spriteRuns(pose)) {
        for (let x = run.x; x < run.x + run.width; x += 1) {
          expect(SPRITES[pose][run.y][x]).toBe(run.slot)
          covered.push(`${x},${run.y}`)
        }
      }

      const opaque = SPRITES[pose]
        .flatMap((row, y) => [...row].map((ch, x) => (ch === '.' ? null : `${x},${y}`)))
        .filter((k): k is string => k !== null)

      expect(covered.sort()).toEqual(opaque.sort())
    }
  })

  it('merges neighbours, so a figure is far fewer rects than pixels', () => {
    for (const pose of POSES) {
      const runs = spriteRuns(pose)
      const pixels = SPRITES[pose].join('').replace(/\./g, '').length

      expect(runs.length).toBeLessThan(pixels / 2)
      // A merged run never abuts another of the same colour.
      for (const run of runs) {
        expect(SPRITES[pose][run.y][run.x + run.width]).not.toBe(run.slot)
      }
    }
  })

  it('is precomputed for every pose and every kit', () => {
    for (const pose of POSES) {
      expect(SPRITE_RUNS[pose]).toEqual(spriteRuns(pose))
    }
    expect(Object.keys(ACCESSORY_RUNS).sort()).toEqual([...KITS].sort())
    for (const kit of KITS) {
      expect(ACCESSORY_RUNS[kit]).toEqual(accessoryRuns(kit))
    }
  })
})
