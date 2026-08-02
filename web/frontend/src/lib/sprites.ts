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
 * A figure is drawn in passes: one of `SPRITES`, which is the same body for
 * everybody, then one per prop from `ACCESSORIES` — the few pixels that say
 * which team this is and which job within it. Keeping them apart means a new
 * role costs a prop, not a whole person.
 *
 * Every row is exactly `SPRITE_SIZE` characters; `.` is transparent and every
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
  a: '--pixel-accent',
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

/** A prop, and the row of the body it starts on. */
export interface Accessory {
  y: number
  rows: readonly string[]
}

/**
 * What each job is holding or wearing.
 *
 * Stored as the two to five rows that are not empty, since a prop covers a
 * tenth of the figure and sixteen rows of dots per kit would bury it. `b` is
 * the wearer's own clothes colour, which is what makes one helmet grid serve
 * three risk seats in three colours, and one arrow grid serve a red bull and a
 * green bear.
 *
 * Held objects live in the right margin (x12-15), which the body never uses,
 * rather than over the chest. Drawn on the torso they read as a pattern on the
 * shirt; drawn beside it they have their own silhouette, which at three screen
 * pixels per grid pixel is the only thing that makes them legible. Worn
 * objects — glasses, hat, tie — are the exception, and sit where they are worn.
 *
 * Nothing reaches row 13, where the seated figure's legs are also `d`: a dark
 * prop there runs into them and the pair reads as one long bar.
 */
export const ACCESSORIES = {
  /** Rims and temples, open at the pupils the face already draws. */
  glasses: {
    y: 3,
    rows: [
      '...dddd..dddd...',
      '...d..d..d..d...',
    ],
  },
  /** Bars stepping up off a baseline. */
  chart: {
    y: 9,
    rows: [
      '..............a.',
      '.............aa.',
      '............aaa.',
      '............ddd.',
    ],
  },
  /** Tall and narrow, screen lit: a handset, not a slab. */
  phone: {
    y: 8,
    rows: [
      '............ddd.',
      '............dld.',
      '............dld.',
      '............dld.',
      '............ddd.',
    ],
  },
  /** Held at a slant, so it is a sheet rather than one more box. */
  paper: {
    y: 9,
    rows: [
      '.............ddd',
      '............dlld',
      '...........dlld.',
      '...........ddd..',
    ],
  },
  /** Squat, screen over a keypad. */
  calculator: {
    y: 9,
    rows: [
      '............dddd',
      '............dlld',
      '............dldd',
      '............dddd',
    ],
  },
  /** Open, with a gutter down the middle. */
  book: {
    y: 9,
    rows: [
      '...........d..d.',
      '...........dl.ld',
      '...........dllld',
      '...........ddddd',
    ],
  },
  /** Links running away downhill. */
  chain: {
    y: 9,
    rows: [
      '............dd..',
      '............ddd.',
      '.............ddd',
      '..............dd',
    ],
  },
  /**
   * Outlined, not solid: the fill is `b`, the same colour as the shirt it is
   * held next to, so without the dark edge the two merge into one blob.
   */
  'arrow-up': {
    y: 8,
    rows: [
      '.............d..',
      '............dbd.',
      '...........dbbbd',
      '...........ddbdd',
      '............ddd.',
    ],
  },
  'arrow-down': {
    y: 8,
    rows: [
      '............ddd.',
      '............dbd.',
      '...........ddbdd',
      '...........dbbbd',
      '.............d..',
    ],
  },
  /** Knot under the collar, blade widening below it. */
  tie: {
    y: 9,
    rows: [
      '.......aa.......',
      '.......aa.......',
      '......aaaa......',
    ],
  },
  /** A lit screen on a stand — the desk the trader works from. */
  monitor: {
    y: 8,
    rows: [
      '............dddd',
      '............daad',
      '............dddd',
      '.............dd.',
      '............dddd',
    ],
  },
  /** Dome and brim, in the wearer's own colour — one grid, three hats. */
  helmet: {
    y: 0,
    rows: [
      '.....bbbbbb.....',
      '...bbbbbbbbbb...',
    ],
  },
  briefcase: {
    y: 9,
    rows: [
      '.............dd.',
      '............dddd',
      '............dldd',
      '............dddd',
    ],
  },
} satisfies Record<string, Accessory>

export type AccessoryKit = keyof typeof ACCESSORIES

export interface PixelRun {
  x: number
  y: number
  width: number
  slot: string
}

/**
 * Rows as horizontal runs of one colour, offset to `top`.
 *
 * A rect per pixel would be ~120 nodes per figure and up to ten figures on
 * screen; merging runs cuts that by roughly two thirds for the same picture.
 */
function runsOf(rows: readonly string[], top: number): PixelRun[] {
  const runs: PixelRun[] = []

  rows.forEach((row, i) => {
    let x = 0
    while (x < row.length) {
      const slot = row[x]
      let width = 1
      while (row[x + width] === slot) width += 1
      if (slot !== '.') runs.push({ x, y: top + i, width, slot })
      x += width
    }
  })

  return runs
}

export function spriteRuns(pose: Pose): PixelRun[] {
  return runsOf(SPRITES[pose], 0)
}

export function accessoryRuns(kit: AccessoryKit): PixelRun[] {
  return runsOf(ACCESSORIES[kit].rows, ACCESSORIES[kit].y)
}

/** Precomputed once: the grids are static, so no component needs to re-derive. */
export const SPRITE_RUNS: Record<Pose, PixelRun[]> = {
  seated: spriteRuns('seated'),
  standing: spriteRuns('standing'),
}

export const ACCESSORY_RUNS = Object.fromEntries(
  (Object.keys(ACCESSORIES) as AccessoryKit[]).map((kit) => [kit, accessoryRuns(kit)]),
) as Record<AccessoryKit, PixelRun[]>
