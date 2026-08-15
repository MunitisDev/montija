/**
 * Trees, as low-poly volumes rather than flat cut-outs.
 *
 * The old tree was three filled triangles in one colour with a single pale
 * wedge for light. Repeated two thousand times that is what made the forest
 * read as wallpaper: no two trees differed, and none of them had a lit and a
 * shaded side.
 *
 * Two things change here, and both are cheap because everything is baked into
 * the existing atlas once at start-up:
 *
 * - **Every mass has a lit face and a shaded face**, split down the centre with
 *   the key light from the upper left, as the art bible requires. That single
 *   change is most of what makes a shape look solid.
 * - **Six shapes rather than three.** Three conifers, which the old wood was
 *   entirely made of, and three broadleaves. A mixed wood has a silhouette; a
 *   plantation does not.
 *
 * Seasonal behaviour is unchanged and still drawn rather than tinted: autumn
 * thins the canopy, winter strips it back to branches, because the silhouette
 * is what a player actually reads at this zoom.
 */

import type Phaser from 'phaser';
import type { Season } from '@/simulation/seasons/SeasonClock';
import {
  canopyColour,
  canopyFullness,
  CANOPY_VARIANTS,
  hasSnow,
  trunkColour,
} from './seasonalPalette';
import { shade } from './groundArt';

/** Tree sprite dimensions, per the art bible. */
export const TREE_WIDTH = 64;
export const TREE_HEIGHT = 96;

/**
 * How many drawn tree shapes exist.
 *
 * The simulation draws a variant per tree from its seeded stream and stores it
 * in the save. Presentation decides how many shapes exist, the simulation
 * decides which tree gets which — that split is why adding shapes needs no new
 * save field, and it is also why every use of a variant here is taken modulo
 * this number rather than trusted: the simulation cannot import the renderer,
 * so the two counts agree by intent and not by construction.
 */
export const TREE_SHAPES = CANOPY_VARIANTS;

/** The first three shapes are conifers, the rest broadleaves. */
function isConifer(variant: number): boolean {
  return variant % TREE_SHAPES < 3;
}

export function drawTree(
  graphics: Phaser.GameObjects.Graphics,
  variant: number,
  season: Season,
): void {
  const shape = variant % TREE_SHAPES;
  const canopy = canopyColour(season, shape);
  const fullness = canopyFullness(season);
  const bare = hasSnow(season);

  if (isConifer(shape)) {
    drawConifer(graphics, shape, canopy, fullness, bare);
    return;
  }
  drawBroadleaf(graphics, shape, canopy, fullness, bare, season);
}

/**
 * A conifer: stacked tiers, each split into a lit and a shaded half.
 *
 * Conifers keep their needles, so winter thins rather than strips them — which
 * is also what keeps a winter forest legible as forest.
 */
function drawConifer(
  graphics: Phaser.GameObjects.Graphics,
  shape: number,
  canopy: number,
  fullness: number,
  bare: boolean,
): void {
  const cx = TREE_WIDTH / 2;
  const trunk = trunkColour(bare ? 'winter' : 'summer');

  // A conifer is evergreen, and winter's canopy figure is written for
  // broadleaves — applied literally it shrank the tiers to two fifths and left
  // a stick under a snow cap. A winter forest has to still read as forest, so
  // the needles only thin.
  const needles = bare ? Math.max(fullness, 0.82) : fullness;

  // Contact shadow, so the tree sits on the ground rather than hovering.
  graphics.fillStyle(0x000000, 0.2);
  graphics.fillEllipse(cx, TREE_HEIGHT - 4, 26, 9);

  // Trunk, with its own lit and shaded side.
  graphics.fillStyle(shade(trunk, 1.12), 1);
  graphics.fillRect(cx - 3.5, TREE_HEIGHT - 26, 3.5, 22);
  graphics.fillStyle(shade(trunk, 0.82), 1);
  graphics.fillRect(cx, TREE_HEIGHT - 26, 3.5, 22);

  // Three tiers, narrowing upward. The proportions differ per shape so a stand
  // of conifers is not one tree repeated.
  const spread = [1, 0.86, 1.12][shape % 3] ?? 1;
  const lift = [0, 4, -3][shape % 3] ?? 0;

  const tiers = [
    { y: TREE_HEIGHT - 20 + lift, halfWidth: 22 * needles * spread, height: 26 * needles },
    {
      y: TREE_HEIGHT - 38 * needles + lift,
      halfWidth: 18 * needles * spread,
      height: 24 * needles,
    },
    {
      y: TREE_HEIGHT - 56 * needles + lift,
      halfWidth: 13 * needles * spread,
      height: 22 * needles,
    },
  ];

  for (const tier of tiers) {
    const apexY = tier.y - tier.height;
    // Left half, catching the light.
    triangle(graphics, shade(canopy, 1.16), [
      [cx, apexY],
      [cx, tier.y],
      [cx - tier.halfWidth, tier.y],
    ]);
    // Right half, away from it.
    triangle(graphics, shade(canopy, 0.82), [
      [cx, apexY],
      [cx, tier.y],
      [cx + tier.halfWidth, tier.y],
    ]);
    // A thin plane along the tier's own base, so the tiers read as stacked
    // rather than as one continuous cone.
    triangle(graphics, shade(canopy, 0.68), [
      [cx - tier.halfWidth, tier.y],
      [cx + tier.halfWidth, tier.y],
      [cx, tier.y + 3],
    ]);
  }

  if (bare) {
    snowOnTiers(graphics, cx, tiers);
  }
}

/**
 * A broadleaf: a rounded crown of a few overlapping facets on a leaning trunk.
 *
 * Deliberately not a circle. A crown built from four flat planes at different
 * brightness is what keeps it in the same visual language as everything else,
 * and a perfectly round blob beside a faceted conifer looks like a different
 * game.
 */
function drawBroadleaf(
  graphics: Phaser.GameObjects.Graphics,
  shape: number,
  canopy: number,
  fullness: number,
  bare: boolean,
  season: Season,
): void {
  const cx = TREE_WIDTH / 2;
  const trunk = trunkColour(season);
  const lean = [0, -2.5, 2][shape % 3] ?? 0;
  const crownY = TREE_HEIGHT - 44 - 8 * fullness;
  const spread = ([1, 1.14, 0.9][shape % 3] ?? 1) * (0.55 + 0.45 * fullness);

  graphics.fillStyle(0x000000, 0.2);
  graphics.fillEllipse(cx, TREE_HEIGHT - 4, 28, 10);

  // Trunk, leaning, splitting into two boughs.
  graphics.fillStyle(shade(trunk, 1.1), 1);
  quad(graphics, [
    [cx - 4, TREE_HEIGHT - 4],
    [cx - 2.5 + lean, crownY + 12],
    [cx + lean, crownY + 12],
    [cx - 1, TREE_HEIGHT - 4],
  ]);
  graphics.fillStyle(shade(trunk, 0.8), 1);
  quad(graphics, [
    [cx - 1, TREE_HEIGHT - 4],
    [cx + lean, crownY + 12],
    [cx + 2.5 + lean, crownY + 12],
    [cx + 3, TREE_HEIGHT - 4],
  ]);
  // Two boughs reaching into the crown, visible when the leaves are gone.
  graphics.fillStyle(shade(trunk, 0.92), 1);
  quad(graphics, [
    [cx - 2 + lean, crownY + 14],
    [cx - 13 + lean, crownY - 2],
    [cx - 10 + lean, crownY - 1],
    [cx + lean, crownY + 14],
  ]);
  quad(graphics, [
    [cx + 2 + lean, crownY + 14],
    [cx + 13 + lean, crownY - 4],
    [cx + 10 + lean, crownY - 3],
    [cx + lean, crownY + 14],
  ]);

  if (bare) {
    // Winter strips a broadleaf completely. Bare branches and nothing else is
    // the point: the difference between the two kinds of tree is never more
    // visible than in January — but two boughs is a catapult, not a tree, so
    // the crown gets a spray of finer branches above them.
    graphics.fillStyle(shade(trunk, 0.98), 1);
    for (const [dx, dy] of [
      [-9, -14],
      [-3, -19],
      [4, -18],
      [10, -12],
    ] as const) {
      quad(graphics, [
        [cx + lean, crownY + 12],
        [cx + lean + dx, crownY + dy],
        [cx + lean + dx * 0.9, crownY + dy + 1.6],
      ]);
    }
    graphics.fillStyle(0xdfe6ea, 0.4);
    quad(graphics, [
      [cx - 13 + lean, crownY - 2],
      [cx - 10 + lean, crownY - 1],
      [cx - 9 + lean, crownY - 2.5],
      [cx - 12 + lean, crownY - 3.5],
    ]);
    return;
  }

  // The crown: a rounded polygon, lit on the upper left and shaded on the
  // lower right.
  //
  // **Rounded on purpose.** The first attempt built it from four planes meeting
  // at a centre, which is a diamond — and a pale diamond floating above a world
  // made of diamonds read as a piece of terrain that had come loose. An
  // eight-sided crown with uneven radii is still flat-shaded and still in the
  // same visual language, and it reads instantly as a tree.
  const rx = 15 * spread;
  const ry = 13 * spread;
  const wobble = CROWN_WOBBLE[shape % CROWN_WOBBLE.length] ?? CROWN_WOBBLE[0]!;
  const crown: [number, number][] = [];
  for (let corner = 0; corner < 8; corner += 1) {
    const angle = (corner / 8) * Math.PI * 2 - Math.PI / 2;
    const r = wobble[corner] ?? 1;
    crown.push([cx + lean + Math.cos(angle) * rx * r, crownY + Math.sin(angle) * ry * r]);
  }

  graphics.fillStyle(canopy, 1);
  quad(graphics, crown);

  // The lit quarter, upper left.
  graphics.fillStyle(shade(canopy, 1.16), 1);
  quad(graphics, [[cx + lean, crownY], crown[6]!, crown[7]!, crown[0]!, crown[1]!]);

  // The shaded quarter, lower right — where the light does not reach.
  graphics.fillStyle(shade(canopy, 0.76), 1);
  quad(graphics, [[cx + lean, crownY], crown[2]!, crown[3]!, crown[4]!]);
}

/**
 * Per-shape radius multipliers around the crown.
 *
 * Written down rather than generated, because the atlas is drawn once: a
 * "random" wobble would be decided a single time anyway, and hand-placed
 * numbers are reviewable.
 */
const CROWN_WOBBLE: readonly (readonly number[])[] = [
  [1, 0.92, 1.04, 0.9, 0.86, 0.94, 1.06, 0.96],
  [0.94, 1.06, 0.9, 1, 0.88, 1.02, 0.92, 1.04],
  [1.06, 0.96, 1, 0.88, 0.92, 1.04, 0.94, 0.9],
];

/** Snow caught on what canopy a conifer has left. */
function snowOnTiers(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  tiers: readonly { y: number; halfWidth: number; height: number }[],
): void {
  // Alpha matters here and was previously thrown away: `triangle` sets its own
  // fill, so the 0.55 set beforehand never applied and every conifer wore an
  // opaque white cap. Snow catching on needles is a dusting, not a hat.
  for (const tier of tiers) {
    triangle(
      graphics,
      0xdfe6ea,
      [
        [cx, tier.y - tier.height],
        [cx + tier.halfWidth * 0.5, tier.y - tier.height * 0.5],
        [cx - tier.halfWidth * 0.5, tier.y - tier.height * 0.5],
      ],
      0.5,
    );
  }
}

function triangle(
  graphics: Phaser.GameObjects.Graphics,
  colour: number,
  points: readonly [number, number][],
  alpha = 1,
): void {
  graphics.fillStyle(colour, alpha);
  graphics.fillTriangle(
    points[0]?.[0] ?? 0,
    points[0]?.[1] ?? 0,
    points[1]?.[0] ?? 0,
    points[1]?.[1] ?? 0,
    points[2]?.[0] ?? 0,
    points[2]?.[1] ?? 0,
  );
}

function quad(graphics: Phaser.GameObjects.Graphics, points: readonly [number, number][]): void {
  graphics.beginPath();
  const [first, ...rest] = points;
  if (!first) {
    return;
  }
  graphics.moveTo(first[0], first[1]);
  for (const point of rest) {
    graphics.lineTo(point[0], point[1]);
  }
  graphics.closePath();
  graphics.fillPath();
}
