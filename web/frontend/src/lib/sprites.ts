/**
 * The office's pixel people, as character grids.
 *
 * Drawn here rather than shipped as PNGs because no pixel-art office set is
 * both license-clean to vendor into a public repo and complete enough to use
 * (the standard one, LimeZu's "Modern Interiors", is paid and forbids
 * redistributing its raw assets). Grids cost nothing, diff in git, and — since
 * every pixel resolves to a CSS variable — recolour per role and per theme for
 * free. See components/PixelAvatar.tsx for the renderer.
 *
 * Each row is exactly `SPRITE_SIZE` characters; `.` is transparent and every
 * other character indexes `SLOT_VAR`. sprites.test.ts pins both.
 */

export type Pose = 'seated' | 'standing'

export const SPRITE_SIZE = 16

/** Pixel character -> the CSS custom property it paints with. */
export const SLOT_VAR: Record<string, string> = {
  h: '--pixel-hair',
  s: '--pixel-skin',
  b: '--pixel-body',
  l: '--pixel-light',
  d: '--pixel-dark',
}

export const SPRITES: Record<Pose, readonly string[]> = {
  // Legs run forward from the hips and then down, which at this size is the
  // whole of "sitting"; the desk drawn beneath in CSS carries the rest.
  seated: [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hssssssssh...',
    '...hsdssssdsh...',
    '...hssssssssh...',
    '.....ssssss.....',
    '.......ss.......',
    '....bbbllbbb....',
    '....bbbbbbbb....',
    '....bbbbbbbb....',
    '....sbbbbbbs....',
    '....bbbbbbbb....',
    '....dddddddd....',
    '....dd....dd....',
    '................',
  ],
  standing: [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hssssssssh...',
    '...hsdssssdsh...',
    '...hssssssssh...',
    '.....ssssss.....',
    '.......ss.......',
    '....bbbllbbb....',
    '....bbbbbbbb....',
    '....bbbbbbbb....',
    '....sbbbbbbs....',
    '.....dd..dd.....',
    '.....dd..dd.....',
    '....ddd..ddd....',
    '................',
  ],
}

export interface PixelRun {
  x: number
  y: number
  width: number
  slot: string
}

/**
 * A sprite as horizontal runs of one colour.
 *
 * A rect per pixel would be ~120 nodes per figure and up to ten figures on
 * screen; merging runs cuts that by roughly two thirds for the same picture.
 */
export function spriteRuns(pose: Pose): PixelRun[] {
  const runs: PixelRun[] = []

  SPRITES[pose].forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const slot = row[x]
      let width = 1
      while (row[x + width] === slot) width += 1
      if (slot !== '.') runs.push({ x, y, width, slot })
      x += width
    }
  })

  return runs
}

/** Precomputed once: the grids are static, so no component needs to re-derive. */
export const SPRITE_RUNS: Record<Pose, PixelRun[]> = {
  seated: spriteRuns('seated'),
  standing: spriteRuns('standing'),
}
