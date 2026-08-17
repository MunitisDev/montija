/**
 * The ground, drawn as low-poly facets rather than flat colour.
 *
 * Terrain is by far the largest thing on screen — some nine thousand tiles —
 * and until now every one of them was a single flat diamond. At any distance
 * that reads as coloured paper: the eye finds no surface, and a settlement
 * standing on it looks pasted rather than placed.
 *
 * The fix is not a texture. It is the same thing low-poly art does everywhere:
 * **break each face into a few flat-shaded planes and let the shading imply the
 * form.** Every tile here is split along one of its two diagonals into two
 * triangles at slightly different brightness, which is enough for the ground to
 * read as gently undulating rather than perfectly level. Everything else —
 * tufts, pebbles, ripples, rock facets — is scattered on top, always as flat
 * polygons, never as gradients or outlines.
 *
 * **Four variants per terrain type**, picked per cell from the cell's own
 * coordinates, so a meadow is not one shape repeated nine thousand times and
 * the whole thing still costs nothing: it is the same single atlas, and the
 * variant is chosen when the sprite is created.
 *
 * The art bible's rules still hold and are the reason this is restrained:
 * key light from the upper left, no hard outlines, muted earth. Detail is
 * bought with facets, not with saturation.
 */

import type Phaser from 'phaser';
import type { TerrainType } from '@/data/terrain';
import { TILE_HEIGHT, TILE_WIDTH } from '@/shared/math/isometric';
import type { Season } from '@/simulation/seasons/SeasonClock';
import { groundDetail, hasSnow, terrainPalette } from './seasonalPalette';
import { shade } from './shading';

/** How many drawn variants each terrain type has. */
export const TERRAIN_VARIANTS = 4;

/**
 * Which variant a cell uses.
 *
 * A hash of the coordinates rather than a stored field or a random draw: it is
 * stable across a season change, a repaint and a reload, it costs nothing to
 * keep, and it cannot drift from the simulation because the simulation has no
 * opinion about it. Presentation deciding presentation.
 */
export function tileVariant(gx: number, gy: number): number {
  // A 32-bit avalanche hash, and it has to be a real one.
  //
  // The first attempt was `(gx * prime) ^ (gy * prime)`, which looks scrambled
  // and is not: only the bottom two bits survive the modulo, and the bottom two
  // bits of a product depend only on the bottom two bits of its factors. Every
  // cell on a given diagonal came out identical — the exact stripe pattern the
  // whole scheme exists to avoid, drawn across the entire map. The shift-xor
  // rounds below are what make the low bits depend on all the high ones.
  let hash = Math.imul(gx, 0x27d4eb2d) ^ Math.imul(gy, 0x165667b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2545f491);
  hash ^= hash >>> 13;
  return (hash >>> 0) % TERRAIN_VARIANTS;
}

/** A point inside the tile, in diamond coordinates where `|a| + |b| <= 1`. */
interface Spot {
  readonly a: number;
  readonly b: number;
}

const HALF_WIDTH = TILE_WIDTH / 2;
const HALF_HEIGHT = TILE_HEIGHT / 2;

/**
 * Draws one ground tile at the graphics origin.
 *
 * The tile occupies the full `TILE_WIDTH × TILE_HEIGHT` box, point-up, exactly
 * as the flat version did — dimensions and anchors are the expensive things to
 * change later, and the art bible fixes them.
 */
export function drawGroundTile(
  graphics: Phaser.GameObjects.Graphics,
  type: TerrainType,
  season: Season,
  variant: number,
): void {
  const palette = terrainPalette(season, type);
  const detail = groundDetail(season, type);

  // The two facets. Which diagonal they meet along alternates with the variant,
  // so neighbouring tiles do not all crease the same way.
  const alongX = variant % 2 === 0;
  // Deliberately slight. At ±6% the split read as a chequerboard rather than as
  // undulation, which is the opposite of hiding the grid.
  const lit = shade(palette.fill, 1.03);
  const shadowed = shade(palette.fill, 0.975);

  if (alongX) {
    facet(graphics, lit, [
      { a: 0, b: -1 },
      { a: 1, b: 0 },
      { a: 0, b: 1 },
    ]);
    facet(graphics, shadowed, [
      { a: 0, b: -1 },
      { a: -1, b: 0 },
      { a: 0, b: 1 },
    ]);
  } else {
    facet(graphics, lit, [
      { a: -1, b: 0 },
      { a: 0, b: -1 },
      { a: 1, b: 0 },
    ]);
    facet(graphics, shadowed, [
      { a: -1, b: 0 },
      { a: 0, b: 1 },
      { a: 1, b: 0 },
    ]);
  }

  switch (type) {
    case 'water':
      drawRipples(graphics, variant, detail.highlight);
      break;
    case 'stone':
      drawRockFacets(graphics, variant, palette.fill);
      break;
    case 'forest':
      drawForestFloor(graphics, variant, detail);
      break;
    default:
      drawTufts(graphics, variant, detail);
      break;
  }

  // Snow lies on everything but open water, and is drawn as flat planes rather
  // than as a wash: a low-poly winter is white planes, not white paint.
  if (hasSnow(season) && type !== 'water') {
    drawSnowCap(graphics, variant);
    // **And no edge under snow.** A one-pixel line centred on the tile boundary
    // keeps half of itself outside whatever is filled inside, so drawing it
    // either before or after the snow left every diamond outlined — a snowfield
    // rendered as graph paper. Snow lies across cell boundaries; the honest fix
    // is that a snowed tile has no boundary to draw.
    return;
  }

  // **No outline.** The tiles used to carry a hairline edge so they stayed
  // legible where two of the same type met — which was defensible when a tile
  // was a single flat colour and had nothing else to distinguish it. It is not
  // defensible now: an outline on every diamond *is* the grid, drawn, and the
  // brief asks the terrain to hide the grid as far as it can. The facets and
  // the scatter do the job the line was doing, and they do it without ruling a
  // lattice over the whole map.
}

/** Grass and meadow: a few tufts, catching the light on their left. */
function drawTufts(
  graphics: Phaser.GameObjects.Graphics,
  variant: number,
  detail: { readonly tuft: number; readonly soil: number; readonly highlight: number },
): void {
  // Low and close to the ground. The first attempt drew them a quarter of a
  // tile tall in the highlight colour, which at any zoom read as pale hairs
  // standing on end all over the map — the detail was visible, which is exactly
  // what ground detail must not be.
  for (const spot of TUFT_SPOTS[variant] ?? []) {
    facet(graphics, detail.tuft, [
      { a: spot.a - 0.06, b: spot.b },
      { a: spot.a + 0.07, b: spot.b },
      { a: spot.a + 0.01, b: spot.b - 0.11 },
    ]);
  }

  // One pebble per tile, so open ground is not uniformly soft.
  const pebble = PEBBLE_SPOTS[variant];
  if (pebble) {
    facet(graphics, detail.soil, [
      { a: pebble.a - 0.07, b: pebble.b },
      { a: pebble.a, b: pebble.b - 0.09 },
      { a: pebble.a + 0.07, b: pebble.b },
      { a: pebble.a, b: pebble.b + 0.06 },
    ]);
  }
}

/** Forest floor: darker, with fallen needles and a root or two. */
function drawForestFloor(
  graphics: Phaser.GameObjects.Graphics,
  variant: number,
  detail: { readonly tuft: number; readonly soil: number; readonly highlight: number },
): void {
  // Patches of bare, needle-strewn earth where the canopy shades everything out.
  for (const spot of LITTER_SPOTS[variant] ?? []) {
    facet(graphics, detail.soil, [
      { a: spot.a - 0.22, b: spot.b + 0.04 },
      { a: spot.a - 0.04, b: spot.b - 0.14 },
      { a: spot.a + 0.2, b: spot.b - 0.02 },
      { a: spot.a + 0.02, b: spot.b + 0.15 },
    ]);
  }

  const twig = PEBBLE_SPOTS[variant];
  if (twig) {
    facet(graphics, detail.tuft, [
      { a: twig.a - 0.18, b: twig.b + 0.04 },
      { a: twig.a + 0.16, b: twig.b - 0.06 },
      { a: twig.a + 0.16, b: twig.b - 0.02 },
      { a: twig.a - 0.18, b: twig.b + 0.08 },
    ]);
  }
}

/** Water: flat ripple slivers, lighter than the surface, never animated. */
function drawRipples(
  graphics: Phaser.GameObjects.Graphics,
  variant: number,
  highlight: number,
): void {
  for (const spot of RIPPLE_SPOTS[variant] ?? []) {
    facet(graphics, highlight, [
      { a: spot.a - 0.26, b: spot.b },
      { a: spot.a, b: spot.b - 0.055 },
      { a: spot.a + 0.26, b: spot.b },
      { a: spot.a, b: spot.b + 0.02 },
    ]);
  }
}

/**
 * Rock: angular blocks standing proud of the tile.
 *
 * The most important tile to get right after grass. Stone is impassable and
 * unbuildable, and a flat grey diamond communicated neither — this reads as an
 * outcrop, so the player can see why they cannot walk there.
 */
function drawRockFacets(
  graphics: Phaser.GameObjects.Graphics,
  variant: number,
  base: number,
): void {
  for (const block of ROCK_BLOCKS[variant] ?? []) {
    // Top face, catching the light.
    facet(graphics, shade(base, 1.24), [
      { a: block.a, b: block.b - block.rise - ROCK_CROWN_RISE },
      { a: block.a + 0.3, b: block.b - block.rise },
      { a: block.a, b: block.b - block.rise + 0.2 },
      { a: block.a - 0.3, b: block.b - block.rise },
    ]);
    // Left face.
    facet(graphics, shade(base, 0.9), [
      { a: block.a - 0.3, b: block.b - block.rise },
      { a: block.a, b: block.b - block.rise + 0.2 },
      { a: block.a, b: block.b + 0.2 },
      { a: block.a - 0.3, b: block.b },
    ]);
    // Right face, away from the key light.
    facet(graphics, shade(base, 0.68), [
      { a: block.a + 0.3, b: block.b - block.rise },
      { a: block.a, b: block.b - block.rise + 0.2 },
      { a: block.a, b: block.b + 0.2 },
      { a: block.a + 0.3, b: block.b },
    ]);
  }
}

/**
 * Snow: one flat plane, plus a drift that never touches an edge.
 *
 * **Nothing here may line up with a cell boundary**, and three attempts learned
 * that the hard way. Leaving the tile's edge showing outlined every diamond; so
 * did a darker facet along the front edge; and so did splitting the tile into
 * two halves, because the crease between them met the corners and joined up
 * with its neighbours' into a zigzag running across the whole map.
 *
 * A snowfield is continuous. So the tile is filled edge to edge in one colour,
 * and the only modelling is a drift sitting entirely in the tile's interior,
 * moved around by the variant. Four variants is enough that the drifts do not
 * line up either.
 */
function drawSnowCap(graphics: Phaser.GameObjects.Graphics, variant: number): void {
  facet(graphics, 0xdee5e9, [
    { a: 0, b: -1 },
    { a: 1, b: 0 },
    { a: 0, b: 1 },
    { a: -1, b: 0 },
  ]);

  const drift = SNOW_DRIFTS[variant] ?? SNOW_DRIFTS[0]!;
  facet(graphics, 0xe9eef1, [
    { a: drift.a - 0.3, b: drift.b + 0.06 },
    { a: drift.a - 0.05, b: drift.b - 0.16 },
    { a: drift.a + 0.28, b: drift.b - 0.02 },
    { a: drift.a + 0.02, b: drift.b + 0.18 },
  ]);
  facet(graphics, 0xd0d9de, [
    { a: drift.a - 0.05, b: drift.b + 0.24 },
    { a: drift.a + 0.02, b: drift.b + 0.18 },
    { a: drift.a + 0.28, b: drift.b - 0.02 },
  ]);
}

/** Where each variant's drift sits. Always well inside the tile. */
const SNOW_DRIFTS: readonly Spot[] = [
  { a: -0.16, b: -0.08 },
  { a: 0.2, b: 0.1 },
  { a: 0.04, b: 0.28 },
  { a: -0.24, b: 0.16 },
];

// --- fixed scatter, so a tile always draws identically ----------------------
//
// Hand-placed rather than random: the whole atlas is generated once, so a
// random scatter would be decided once anyway — and writing the positions down
// means the art is reviewable and reproducible.

const TUFT_SPOTS: readonly (readonly Spot[])[] = [
  [
    { a: -0.42, b: 0.06 },
    { a: 0.18, b: 0.3 },
    { a: 0.34, b: -0.24 },
  ],
  [
    { a: 0.06, b: -0.36 },
    { a: -0.3, b: 0.34 },
  ],
  [
    { a: -0.16, b: -0.12 },
    { a: 0.48, b: 0.08 },
    { a: -0.5, b: -0.1 },
    { a: 0.1, b: 0.44 },
  ],
  [{ a: 0.26, b: 0.18 }],
];

const PEBBLE_SPOTS: readonly (Spot | undefined)[] = [
  { a: 0.5, b: 0.2 },
  { a: -0.46, b: -0.2 },
  undefined,
  { a: -0.24, b: -0.34 },
];

const LITTER_SPOTS: readonly (readonly Spot[])[] = [
  [{ a: -0.2, b: 0.1 }],
  [
    { a: 0.24, b: -0.16 },
    { a: -0.3, b: 0.22 },
  ],
  [{ a: 0.08, b: 0.26 }],
  [
    { a: -0.34, b: -0.08 },
    { a: 0.3, b: 0.16 },
  ],
];

const RIPPLE_SPOTS: readonly (readonly Spot[])[] = [
  [
    { a: -0.1, b: -0.3 },
    { a: 0.14, b: 0.24 },
  ],
  [{ a: 0.02, b: 0.02 }],
  [
    { a: 0.2, b: -0.34 },
    { a: -0.16, b: 0.1 },
    { a: 0.08, b: 0.42 },
  ],
  [
    { a: -0.24, b: 0.28 },
    { a: 0.18, b: -0.12 },
  ],
];

interface RockBlock extends Spot {
  /** How far the block stands above the ground, in diamond units. */
  readonly rise: number;
}

/**
 * How far a block's top face reaches beyond its own rise, in diamond units.
 *
 * The crown is a diamond in its own right, so the highest pixel of a boulder is
 * this much above where the block nominally ends. Named because `ROCK_PEAK_LIFT`
 * has to agree with the drawing exactly.
 */
const ROCK_CROWN_RISE = 0.24;

const ROCK_BLOCKS: readonly (readonly RockBlock[])[] = [
  [
    { a: -0.2, b: 0.16, rise: 0.5 },
    { a: 0.3, b: 0.34, rise: 0.28 },
  ],
  [{ a: 0.08, b: 0.3, rise: 0.62 }],
  [
    { a: 0.26, b: 0.1, rise: 0.44 },
    { a: -0.3, b: 0.36, rise: 0.24 },
  ],
  [
    { a: 0, b: 0.24, rise: 0.36 },
    { a: -0.36, b: 0.02, rise: 0.2 },
    { a: 0.36, b: 0.04, rise: 0.2 },
  ],
];

/**
 * How far the tallest boulder's crown stands above the middle of a rock tile.
 *
 * Exported because anything the player puts *on* a deposit has to know how tall
 * one is. A mining mark used to borrow the tree's height and floated in mid-air
 * well clear of the rock; deriving the figure from the blocks themselves means
 * retuning the rock art moves the mark with it instead of leaving it wrong.
 */
export const ROCK_PEAK_LIFT = Math.round(
  Math.max(
    ...ROCK_BLOCKS.flat().map((block) => (block.rise + ROCK_CROWN_RISE - block.b) * HALF_HEIGHT),
  ),
);

// --- drawing helpers --------------------------------------------------------

/** Fills a polygon given in diamond coordinates. */
function facet(
  graphics: Phaser.GameObjects.Graphics,
  colour: number,
  points: readonly Spot[],
): void {
  const [first, ...rest] = points;
  if (!first) {
    return;
  }
  graphics.fillStyle(colour, 1);
  graphics.beginPath();
  graphics.moveTo(...screen(first));
  for (const point of rest) {
    graphics.lineTo(...screen(point));
  }
  graphics.closePath();
  graphics.fillPath();
}

/**
 * Diamond coordinates to pixels.
 *
 * `(0, 0)` is the tile's centre and `|a| + |b| = 1` is its edge, so any point
 * written with `|a| + |b| <= 1` is guaranteed to land inside the tile. That is
 * the whole reason for the coordinate system: scatter written in pixels
 * inevitably pokes out of the corners.
 */
function screen(spot: Spot): [number, number] {
  return [HALF_WIDTH + spot.a * HALF_WIDTH, HALF_HEIGHT + spot.b * HALF_HEIGHT];
}
