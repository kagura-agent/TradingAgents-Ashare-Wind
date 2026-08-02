import { describe, expect, it } from 'vitest'
import { SLOT_VAR, SPRITES, SPRITE_RUNS, SPRITE_SIZE, spriteRuns, type Pose } from './sprites'

const POSES = Object.keys(SPRITES) as Pose[]

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
      for (const row of SPRITES[pose]) {
        for (const ch of row) {
          if (ch !== '.') expect(SLOT_VAR).toHaveProperty(ch)
        }
      }
    }
  })

  it('paint every palette slot into a custom property', () => {
    for (const name of Object.values(SLOT_VAR)) {
      expect(name).toMatch(/^--pixel-/)
    }
  })
})

describe('spriteRuns', () => {
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

  it('is precomputed for every pose', () => {
    for (const pose of POSES) {
      expect(SPRITE_RUNS[pose]).toEqual(spriteRuns(pose))
    }
  })
})
