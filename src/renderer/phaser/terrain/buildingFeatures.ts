/**
 * What a building leaves lying on its own plot, and why every building has some.
 *
 * Mass, colour and construction get a building most of the way to being
 * recognisable and then stop: a Woodcutter and a Tailor are both a timber box
 * under a pitched roof. The feature is the part that says *which trade* without
 * a label — split logs and a chopping block, a forge mouth, a rack of drying
 * hides — and it is drawn on the ground rather than on the walls so it survives
 * the building being forty pixels tall.
 *
 * **Everything here is drawn inside the plot.** The footprint is what blocks
 * navigation, validates placement and gets saved, so art that oversails it
 * promises the player ground they cannot build on. The buildings are inset
 * inside their own cells precisely to leave this ring of ground free, and
 * `tests/building-art.test.ts` fails the build if anything strays out of it.
 *
 * Renderer-only: these run once at startup to fill a texture, never per frame.
 */

import type Phaser from 'phaser';

import { strip } from './buildingShapes';
import { CRATE, LOG_BARK, LOG_END, isoBarrel, isoCrate, isoLogStack, isoSack } from './isoProps';
import { polygon, shade, type Point } from './shading';

/** What a building keeps on its plot. One per trade, and each says the trade. */
export type FeatureKind =
  | 'logpile'
  | 'trestle'
  | 'baskets'
  | 'granary'
  | 'blocks'
  | 'adit'
  | 'forge'
  | 'cart'
  | 'racks'
  | 'hides'
  | 'cloth'
  | 'physic'
  | 'nets'
  | 'bell';

/** Where a feature stands, and how big it is drawn there. */
export interface FeatureSpot {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

const TIMBER = 0x5d4830;
const IRON = 0x3a3630;
const STONE = 0x7f7c6e;
const CLOTH = 0xa8a08a;
const GREEN = 0x556b39;
const EMBER = 0xc4622a;
/** Wet scales: the coldest, palest thing in the settlement after the well. */
const FISH = 0x8b9299;

/** A plain iso box standing on the ground: benches, blocks, vats, troughs. */
function block(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  width: number,
  depth: number,
  height: number,
  colour: number,
): void {
  const hw = width / 2;
  const hh = depth / 2;
  const topY = base.y - height;

  graphics.fillStyle(shade(colour, 1.18), 1);
  polygon(graphics, [
    { x: base.x, y: topY - hh },
    { x: base.x + hw, y: topY },
    { x: base.x, y: topY + hh },
    { x: base.x - hw, y: topY },
  ]);
  graphics.fillStyle(colour, 1);
  polygon(graphics, [
    { x: base.x - hw, y: topY },
    { x: base.x, y: topY + hh },
    { x: base.x, y: base.y + hh },
    { x: base.x - hw, y: base.y },
  ]);
  graphics.fillStyle(shade(colour, 0.7), 1);
  polygon(graphics, [
    { x: base.x, y: topY + hh },
    { x: base.x + hw, y: topY },
    { x: base.x + hw, y: base.y },
    { x: base.x, y: base.y + hh },
  ]);
}

/** An upright post, with its own lit and shaded halves. */
function post(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  height: number,
  width: number,
  colour: number,
): void {
  graphics.fillStyle(shade(colour, 1.08), 1);
  polygon(graphics, [
    { x: base.x - width / 2, y: base.y - height },
    { x: base.x, y: base.y - height + width / 4 },
    { x: base.x, y: base.y + width / 4 },
    { x: base.x - width / 2, y: base.y },
  ]);
  graphics.fillStyle(shade(colour, 0.8), 1);
  polygon(graphics, [
    { x: base.x, y: base.y - height + width / 4 },
    { x: base.x + width / 2, y: base.y - height },
    { x: base.x + width / 2, y: base.y },
    { x: base.x, y: base.y + width / 4 },
  ]);
}

/** A low heap of loose material: spoil, ore, cut brash. */
function heap(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  width: number,
  height: number,
  colour: number,
): void {
  graphics.fillStyle(shade(colour, 0.82), 1);
  polygon(graphics, [
    { x: base.x - width / 2, y: base.y },
    { x: base.x, y: base.y + width / 4 },
    { x: base.x + width / 2, y: base.y },
    { x: base.x + width * 0.2, y: base.y - height },
    { x: base.x - width * 0.2, y: base.y - height },
  ]);
  graphics.fillStyle(shade(colour, 1.12), 1);
  polygon(graphics, [
    { x: base.x - width / 2, y: base.y },
    { x: base.x - width * 0.2, y: base.y - height },
    { x: base.x + width * 0.1, y: base.y - height * 0.8 },
    { x: base.x - width * 0.1, y: base.y + width / 8 },
  ]);
}

/** Draws one building's identifying feature at the spot it was given. */
export function drawFeature(
  graphics: Phaser.GameObjects.Graphics,
  kind: FeatureKind,
  spot: FeatureSpot,
): void {
  const at: Point = { x: spot.x, y: spot.y };
  const s = spot.scale;

  switch (kind) {
    case 'logpile':
      drawLogpile(graphics, at, s);
      return;
    case 'trestle':
      drawTrestle(graphics, at, s);
      return;
    case 'baskets':
      drawBaskets(graphics, at, s);
      return;
    case 'granary':
      drawGranary(graphics, at, s);
      return;
    case 'blocks':
      drawBlocks(graphics, at, s);
      return;
    case 'adit':
      drawAdit(graphics, at, s);
      return;
    case 'forge':
      drawForge(graphics, at, s);
      return;
    case 'cart':
      drawCart(graphics, at, s);
      return;
    case 'racks':
      drawRacks(graphics, at, s);
      return;
    case 'hides':
      drawHides(graphics, at, s);
      return;
    case 'cloth':
      drawCloth(graphics, at, s);
      return;
    case 'physic':
      drawPhysic(graphics, at, s);
      return;
    case 'nets':
      drawNets(graphics, at, s);
      return;
    case 'bell':
      drawBell(graphics, at, s);
      return;
  }
}

/** Split logs stacked end-on, and the block they were split on, axe in it. */
function drawLogpile(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  isoLogStack(graphics, { x: at.x - 5 * s, y: at.y + 2 * s }, 15 * s);

  const blockAt = { x: at.x + 10 * s, y: at.y + 5 * s };
  block(graphics, blockAt, 9 * s, 5 * s, 7 * s, LOG_BARK);
  graphics.fillStyle(shade(LOG_END, 1.06), 1);
  polygon(graphics, [
    { x: blockAt.x, y: blockAt.y - 7 * s - 2.5 * s },
    { x: blockAt.x + 4 * s, y: blockAt.y - 7 * s },
    { x: blockAt.x, y: blockAt.y - 7 * s + 2.5 * s },
    { x: blockAt.x - 4 * s, y: blockAt.y - 7 * s },
  ]);

  // The axe: a helve leaning out of the block, and a head on it.
  const heel = { x: blockAt.x - 1 * s, y: blockAt.y - 7 * s };
  const head = { x: blockAt.x + 5 * s, y: blockAt.y - 17 * s };
  graphics.fillStyle(shade(LOG_END, 0.86), 1);
  polygon(graphics, strip(heel, head, 1.6 * s));
  graphics.fillStyle(IRON, 1);
  polygon(graphics, [
    { x: head.x - 1 * s, y: head.y + 1 * s },
    { x: head.x + 3.5 * s, y: head.y - 1.5 * s },
    { x: head.x + 3 * s, y: head.y + 2.5 * s },
    { x: head.x - 1 * s, y: head.y + 3 * s },
  ]);
}

/**
 * A whole trunk up on trestles with the saw still in it, and the rounds off it.
 *
 * The Feller's mark, and deliberately nothing like the Woodcutter's. That one
 * is a stack of *split* wood beside a chopping block; this is a tree that was
 * standing this morning, bark still on, being cut into lengths.
 */
function drawTrestle(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  // Short and fat. The first pass was long and thin and read as a stray plank
  // leaning on the wall: a trunk has to be thick enough to be a *tree*, and at
  // this size that means shortening it rather than thinning the trestles.
  const head = { x: at.x - 9 * s, y: at.y - 1 * s };
  const foot = { x: at.x + 7 * s, y: at.y + 7 * s };
  const lift = 7 * s;
  const girth = 9 * s;

  // The two trestles under it, drawn first so the trunk lies on them.
  for (const t of [0.22, 0.76]) {
    const base = {
      x: head.x + (foot.x - head.x) * t,
      y: head.y + (foot.y - head.y) * t,
    };
    graphics.fillStyle(shade(TIMBER, 0.88), 1);
    for (const dir of [-1, 1] as const) {
      polygon(
        graphics,
        strip(
          { x: base.x + dir * 4 * s, y: base.y + 2 * s },
          { x: base.x, y: base.y - lift },
          2 * s,
        ),
      );
    }
  }

  const barkTop = { x: head.x, y: head.y - lift };
  const barkEnd = { x: foot.x, y: foot.y - lift };
  graphics.fillStyle(shade(LOG_BARK, 1.08), 1);
  polygon(graphics, strip(barkTop, barkEnd, girth));
  graphics.fillStyle(shade(LOG_BARK, 0.74), 1);
  polygon(
    graphics,
    strip(
      { x: barkTop.x, y: barkTop.y + girth * 0.3 },
      { x: barkEnd.x, y: barkEnd.y + girth * 0.3 },
      girth * 0.4,
    ),
  );
  // The sawn round at the near end, which is what says *cut this morning*.
  graphics.fillStyle(shade(LOG_END, 1.04), 1);
  polygon(graphics, [
    { x: barkEnd.x, y: barkEnd.y - girth / 2 },
    { x: barkEnd.x + 2.8 * s, y: barkEnd.y - girth * 0.3 },
    { x: barkEnd.x + 2.8 * s, y: barkEnd.y + girth * 0.3 },
    { x: barkEnd.x, y: barkEnd.y + girth / 2 },
  ]);

  // The saw, standing in the cut. Kept short and dull: a long bright blade reads
  // as a shard of something rather than as a tool.
  const cut = {
    x: head.x + (foot.x - head.x) * 0.55,
    y: head.y + (foot.y - head.y) * 0.55 - lift,
  };
  graphics.fillStyle(0x6d757a, 1);
  polygon(graphics, [
    { x: cut.x - 1 * s, y: cut.y - 8 * s },
    { x: cut.x + 4 * s, y: cut.y - 9.5 * s },
    { x: cut.x + 4 * s, y: cut.y - 7.5 * s },
    { x: cut.x - 1 * s, y: cut.y - 4 * s },
  ]);
  graphics.fillStyle(shade(LOG_END, 0.78), 1);
  polygon(
    graphics,
    strip(
      { x: cut.x + 4 * s, y: cut.y - 9.5 * s },
      { x: cut.x + 6.4 * s, y: cut.y - 10 * s },
      2.4 * s,
    ),
  );

  // Two rounds already off it, on the ground.
  isoLogStack(graphics, { x: at.x + 13 * s, y: at.y + 10 * s }, 10 * s);
}

/** Two baskets of gathered food, and a low frame with more drying on it. */
function drawBaskets(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  for (const [dx, dy, w] of [
    [-8, 2, 11],
    [2, 6, 9],
  ] as const) {
    const foot = { x: at.x + dx * s, y: at.y + dy * s };
    isoBarrel(graphics, foot, w * s, w * 0.72 * s);
    // Heaped over the rim: the whole reason a basket is worth drawing.
    graphics.fillStyle(0x7a3f34, 1);
    polygon(graphics, [
      { x: foot.x - w * 0.34 * s, y: foot.y - w * 0.72 * s },
      { x: foot.x, y: foot.y - w * 0.72 * s - w * 0.22 * s },
      { x: foot.x + w * 0.34 * s, y: foot.y - w * 0.72 * s },
      { x: foot.x, y: foot.y - w * 0.72 * s + w * 0.16 * s },
    ]);
  }

  // A drying frame: two posts and a rail with bunches over it.
  const left = { x: at.x + 8 * s, y: at.y - 2 * s };
  const right = { x: at.x + 20 * s, y: at.y + 4 * s };
  post(graphics, left, 14 * s, 2 * s, TIMBER);
  post(graphics, right, 14 * s, 2 * s, TIMBER);
  graphics.fillStyle(shade(TIMBER, 1.1), 1);
  polygon(
    graphics,
    strip({ x: left.x, y: left.y - 14 * s }, { x: right.x, y: right.y - 14 * s }, 1.8 * s),
  );
  graphics.fillStyle(GREEN, 1);
  for (const t of [0.25, 0.55, 0.85]) {
    const x = left.x + (right.x - left.x) * t;
    const y = left.y + (right.y - left.y) * t - 14 * s;
    polygon(graphics, [
      { x: x - 2 * s, y },
      { x: x + 2 * s, y },
      { x: x + 1 * s, y: y + 6 * s },
      { x: x - 1 * s, y: y + 6 * s },
    ]);
  }
}

/** Grain: sacks stacked on staddle stones, out of the wet and off the mice. */
function drawGranary(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  // The staddle stones: mushroom caps a rat cannot climb past.
  for (const [dx, dy] of [
    [-8, 0],
    [2, 5],
  ] as const) {
    const foot = { x: at.x + dx * s, y: at.y + dy * s };
    block(graphics, foot, 5 * s, 3 * s, 4 * s, STONE);
    graphics.fillStyle(shade(STONE, 1.22), 1);
    polygon(graphics, [
      { x: foot.x, y: foot.y - 6.5 * s },
      { x: foot.x + 5 * s, y: foot.y - 4.5 * s },
      { x: foot.x, y: foot.y - 2.5 * s },
      { x: foot.x - 5 * s, y: foot.y - 4.5 * s },
    ]);
  }

  isoSack(graphics, { x: at.x - 7 * s, y: at.y - 4 * s }, 10 * s, 11 * s);
  isoSack(graphics, { x: at.x + 3 * s, y: at.y + 1 * s }, 9 * s, 10 * s);
  isoBarrel(graphics, { x: at.x + 14 * s, y: at.y + 5 * s }, 10 * s, 12 * s);
}

/** Quarried stone: dressed blocks on the ground, a spoil heap and a pick. */
function drawBlocks(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  block(graphics, { x: at.x - 9 * s, y: at.y + 1 * s }, 13 * s, 7 * s, 8 * s, STONE);
  block(graphics, { x: at.x + 2 * s, y: at.y + 6 * s }, 11 * s, 6 * s, 6 * s, shade(STONE, 0.9));
  block(graphics, { x: at.x - 7 * s, y: at.y - 7 * s }, 9 * s, 5 * s, 5 * s, shade(STONE, 1.06));
  heap(graphics, { x: at.x + 14 * s, y: at.y + 4 * s }, 14 * s, 7 * s, 0x6c6960);

  const heel = { x: at.x + 4 * s, y: at.y };
  const head = { x: at.x + 9 * s, y: at.y - 15 * s };
  graphics.fillStyle(shade(LOG_END, 0.86), 1);
  polygon(graphics, strip(heel, head, 1.6 * s));
  graphics.fillStyle(IRON, 1);
  polygon(graphics, [
    { x: head.x - 5 * s, y: head.y + 2.5 * s },
    { x: head.x, y: head.y - 1 * s },
    { x: head.x + 5 * s, y: head.y + 1 * s },
    { x: head.x, y: head.y + 1.5 * s },
  ]);
}

/** A mine mouth: a timbered head standing over a black hole, and the ore out of it. */
function drawAdit(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  const left = { x: at.x - 8 * s, y: at.y + 4 * s };
  const right = { x: at.x + 8 * s, y: at.y - 4 * s };
  const height = 17 * s;

  // The hole first, so the frame stands in front of it.
  graphics.fillStyle(0x171512, 1);
  polygon(graphics, [
    { x: left.x + 1.5 * s, y: left.y - height + 2 * s },
    { x: right.x - 1.5 * s, y: right.y - height + 2 * s },
    { x: right.x - 1.5 * s, y: right.y },
    { x: left.x + 1.5 * s, y: left.y },
  ]);

  post(graphics, left, height, 3.4 * s, TIMBER);
  post(graphics, right, height, 3.4 * s, TIMBER);
  graphics.fillStyle(shade(TIMBER, 1.14), 1);
  polygon(
    graphics,
    strip({ x: left.x, y: left.y - height }, { x: right.x, y: right.y - height }, 3.2 * s),
  );

  heap(graphics, { x: at.x + 15 * s, y: at.y + 6 * s }, 15 * s, 8 * s, 0x5d5750);
  // Ore, picked out warmer than the spoil it came out with.
  graphics.fillStyle(0x8a6a44, 1);
  for (const [dx, dy] of [
    [12, 8],
    [17, 5],
    [20, 9],
  ] as const) {
    polygon(graphics, [
      { x: at.x + dx * s, y: at.y + dy * s - 2 * s },
      { x: at.x + (dx + 2.4) * s, y: at.y + dy * s - 0.8 * s },
      { x: at.x + dx * s, y: at.y + dy * s + 0.6 * s },
      { x: at.x + (dx - 2.4) * s, y: at.y + dy * s - 0.8 * s },
    ]);
  }
}

/** The forge: a stone hearth with fire in its mouth, an anvil and a trough. */
function drawForge(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  const hearth = { x: at.x - 6 * s, y: at.y + 2 * s };
  block(graphics, hearth, 15 * s, 8 * s, 11 * s, STONE);
  // The mouth, and the fire in it. The one warm colour in the settlement.
  graphics.fillStyle(0x1d1713, 1);
  polygon(graphics, [
    { x: hearth.x - 6 * s, y: hearth.y - 9 * s },
    { x: hearth.x - 1 * s, y: hearth.y - 6.5 * s },
    { x: hearth.x - 1 * s, y: hearth.y - 2 * s },
    { x: hearth.x - 6 * s, y: hearth.y - 4.5 * s },
  ]);
  graphics.fillStyle(EMBER, 1);
  polygon(graphics, [
    { x: hearth.x - 5 * s, y: hearth.y - 7.6 * s },
    { x: hearth.x - 2 * s, y: hearth.y - 6.1 * s },
    { x: hearth.x - 2 * s, y: hearth.y - 3.4 * s },
    { x: hearth.x - 5 * s, y: hearth.y - 4.9 * s },
  ]);

  // The anvil: a block on a stump, with the horn showing.
  const anvil = { x: at.x + 10 * s, y: at.y + 6 * s };
  block(graphics, anvil, 7 * s, 4 * s, 6 * s, LOG_BARK);
  block(graphics, { x: anvil.x, y: anvil.y - 6 * s }, 8 * s, 4 * s, 3.4 * s, IRON);
  graphics.fillStyle(shade(IRON, 1.3), 1);
  polygon(graphics, [
    { x: anvil.x + 4 * s, y: anvil.y - 11.4 * s },
    { x: anvil.x + 8 * s, y: anvil.y - 10 * s },
    { x: anvil.x + 4 * s, y: anvil.y - 8.6 * s },
  ]);
}

/** A two-wheeled cart with its shafts down, and crates come off it. */
function drawCart(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  const bed = { x: at.x - 2 * s, y: at.y - 2 * s };
  block(graphics, bed, 20 * s, 10 * s, 6 * s, CRATE);

  // Shafts, running down and out to the ground where a beast would stand.
  graphics.fillStyle(shade(TIMBER, 1.02), 1);
  for (const dy of [-2, 3]) {
    polygon(
      graphics,
      strip(
        { x: bed.x - 9 * s, y: bed.y - 5 * s + dy * s },
        { x: bed.x - 21 * s, y: bed.y + 2 * s + dy * s },
        1.8 * s,
      ),
    );
  }

  // One wheel, near side. Two would be one behind the cart and invisible.
  const hub = { x: bed.x + 1 * s, y: bed.y + 1 * s };
  graphics.fillStyle(shade(TIMBER, 0.8), 1);
  graphics.fillCircle(hub.x, hub.y, 6.4 * s);
  graphics.fillStyle(shade(CRATE, 0.86), 1);
  graphics.fillCircle(hub.x, hub.y, 4.8 * s);
  graphics.fillStyle(shade(TIMBER, 1.06), 1);
  for (const angle of [0.3, 1.35, 2.4, 3.45, 4.5, 5.55]) {
    polygon(
      graphics,
      strip(
        hub,
        { x: hub.x + Math.cos(angle) * 5.6 * s, y: hub.y + Math.sin(angle) * 5.6 * s },
        1.3 * s,
      ),
    );
  }

  isoCrate(graphics, { x: at.x + 16 * s, y: at.y + 7 * s }, 11 * s, 8 * s, CRATE);
  isoCrate(graphics, { x: at.x + 15 * s, y: at.y - 1 * s }, 9 * s, 6 * s, shade(CRATE, 0.9));
}

/** Drying racks: two frames with bunches hanging in the shade under them. */
function drawRacks(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  for (const [dx, dy, span] of [
    [-8, 3, 15],
    [8, 8, 13],
  ] as const) {
    const left = { x: at.x + dx * s, y: at.y + dy * s };
    const right = { x: left.x + span * s, y: left.y + (span / 2) * s };
    const height = 16 * s;
    post(graphics, left, height, 2.2 * s, TIMBER);
    post(graphics, right, height, 2.2 * s, TIMBER);
    graphics.fillStyle(shade(TIMBER, 1.12), 1);
    polygon(
      graphics,
      strip({ x: left.x, y: left.y - height }, { x: right.x, y: right.y - height }, 1.8 * s),
    );

    for (const t of [0.22, 0.5, 0.78]) {
      const x = left.x + (right.x - left.x) * t;
      const y = left.y + (right.y - left.y) * t - height;
      graphics.fillStyle(shade(GREEN, 1.1), 1);
      polygon(graphics, [
        { x: x - 2.4 * s, y: y + 1 * s },
        { x: x + 2.4 * s, y: y + 1 * s },
        { x, y: y + 9 * s },
      ]);
    }
  }
}

/**
 * A drying frame with the catch hanging on it, and a creel under it.
 *
 * The one prop in the settlement that is unmistakably about *water*, and it has
 * to be — the hut itself is a small boarded shed, which could be anybody's. The
 * fish hang nose-down from a rail, the way they are split and dried, and their
 * pale bellies are the only near-silver in the game outside the well.
 */
function drawNets(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  const left = { x: at.x - 10 * s, y: at.y + 2 * s };
  const right = { x: at.x + 4 * s, y: at.y + 9 * s };
  const height = 18 * s;
  post(graphics, left, height, 2.4 * s, TIMBER);
  post(graphics, right, height, 2.4 * s, TIMBER);
  graphics.fillStyle(shade(TIMBER, 1.12), 1);
  polygon(
    graphics,
    strip({ x: left.x, y: left.y - height }, { x: right.x, y: right.y - height }, 1.8 * s),
  );

  // The catch, hanging tail-up along the rail.
  for (const t of [0.2, 0.46, 0.72]) {
    const x = left.x + (right.x - left.x) * t;
    const y = left.y + (right.y - left.y) * t - height;
    graphics.fillStyle(FISH, 1);
    graphics.fillEllipse(x, y + 6 * s, 4.4 * s, 10 * s);
    graphics.fillStyle(shade(FISH, 1.3), 1);
    graphics.fillEllipse(x - 0.8 * s, y + 5 * s, 2 * s, 6 * s);
    graphics.fillStyle(shade(FISH, 0.7), 1);
    polygon(graphics, [
      { x: x - 2.6 * s, y: y + 11.5 * s },
      { x: x + 2.6 * s, y: y + 11.5 * s },
      { x, y: y + 14.5 * s },
    ]);
  }

  // A creel set down beside the frame, because a rack alone reads as laundry.
  const creel = { x: at.x + 9 * s, y: at.y + 3 * s };
  block(graphics, creel, 8 * s, 5 * s, 6 * s, 0x8a6b45);
}

/** A hide stretched in a frame, and antlers set on a post beside it. */
function drawHides(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  const left = { x: at.x - 10 * s, y: at.y + 3 * s };
  const right = { x: at.x + 4 * s, y: at.y + 10 * s };
  const height = 19 * s;
  post(graphics, left, height, 2.4 * s, TIMBER);
  post(graphics, right, height, 2.4 * s, TIMBER);
  graphics.fillStyle(shade(TIMBER, 1.12), 1);
  polygon(
    graphics,
    strip({ x: left.x, y: left.y - height }, { x: right.x, y: right.y - height }, 2 * s),
  );

  // The hide itself: a rough pentagon, laced to the frame.
  graphics.fillStyle(0x8d7150, 1);
  polygon(graphics, [
    { x: left.x + 2 * s, y: left.y - height + 2 * s },
    { x: right.x - 2 * s, y: right.y - height + 2 * s },
    { x: right.x - 3 * s, y: right.y - 5 * s },
    { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 - 2 * s },
    { x: left.x + 3 * s, y: left.y - 5 * s },
  ]);
  graphics.fillStyle(0x6f5940, 1);
  polygon(
    graphics,
    strip(
      { x: left.x + 3 * s, y: left.y - height * 0.55 },
      { x: right.x - 3 * s, y: right.y - height * 0.55 },
      1.2 * s,
    ),
  );

  // Antlers on a stub post: two crooked forks, which read as antlers and as
  // nothing else in this whole settlement.
  const stub = { x: at.x + 14 * s, y: at.y + 4 * s };
  post(graphics, stub, 11 * s, 3 * s, TIMBER);
  graphics.fillStyle(0xb3a887, 1);
  for (const dir of [-1, 1] as const) {
    const root = { x: stub.x, y: stub.y - 11 * s };
    const tip = { x: stub.x + dir * 6 * s, y: stub.y - 18 * s };
    polygon(graphics, strip(root, tip, 1.5 * s));
    polygon(
      graphics,
      strip(
        { x: stub.x + dir * 3 * s, y: stub.y - 14.5 * s },
        { x: stub.x + dir * 7 * s, y: stub.y - 14 * s },
        1.3 * s,
      ),
    );
  }
}

/** Cloth on a line, and the vat it was dyed in. */
function drawCloth(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  const left = { x: at.x - 11 * s, y: at.y + 1 * s };
  const right = { x: at.x + 7 * s, y: at.y + 10 * s };
  const height = 18 * s;
  post(graphics, left, height, 2.2 * s, TIMBER);
  post(graphics, right, height, 2.2 * s, TIMBER);
  graphics.fillStyle(shade(TIMBER, 1.1), 1);
  polygon(
    graphics,
    strip({ x: left.x, y: left.y - height }, { x: right.x, y: right.y - height }, 1.4 * s),
  );

  // Three lengths hanging, each a slightly different bolt.
  const bolts = [
    [0.1, 0.36, CLOTH, 12],
    [0.4, 0.66, 0x8a6b6b, 10],
    [0.7, 0.94, 0x6f7a68, 13],
  ] as const;
  for (const [t0, t1, colour, drop] of bolts) {
    const a = {
      x: left.x + (right.x - left.x) * t0,
      y: left.y + (right.y - left.y) * t0 - height,
    };
    const b = {
      x: left.x + (right.x - left.x) * t1,
      y: left.y + (right.y - left.y) * t1 - height,
    };
    graphics.fillStyle(colour, 1);
    polygon(graphics, [a, b, { x: b.x, y: b.y + drop * s }, { x: a.x, y: a.y + drop * s }]);
    graphics.fillStyle(shade(colour, 0.82), 1);
    polygon(graphics, [
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      { x: b.x, y: b.y },
      { x: b.x, y: b.y + drop * s },
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + drop * s },
    ]);
  }

  const vat = { x: at.x + 15 * s, y: at.y + 4 * s };
  isoBarrel(graphics, vat, 12 * s, 10 * s);
  graphics.fillStyle(0x3f4a63, 1);
  polygon(graphics, [
    { x: vat.x - 4.4 * s, y: vat.y - 10 * s },
    { x: vat.x, y: vat.y - 12.2 * s },
    { x: vat.x + 4.4 * s, y: vat.y - 10 * s },
    { x: vat.x, y: vat.y - 7.8 * s },
  ]);
}

/** A physic garden: beds in rows, and a bench to sit a patient on. */
function drawPhysic(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  for (const [dx, dy] of [
    [-10, 0],
    [-4, 3],
    [2, 6],
  ] as const) {
    const a = { x: at.x + dx * s, y: at.y + dy * s };
    const b = { x: a.x + 13 * s, y: a.y + 6.5 * s };
    graphics.fillStyle(0x53442f, 1);
    polygon(graphics, strip(a, b, 4 * s));
    graphics.fillStyle(shade(GREEN, 1.1), 1);
    for (const t of [0.2, 0.5, 0.8]) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      polygon(graphics, [
        { x, y: y - 5 * s },
        { x: x + 2.2 * s, y },
        { x: x - 2.2 * s, y },
      ]);
    }
  }

  const bench = { x: at.x + 15 * s, y: at.y + 2 * s };
  post(graphics, { x: bench.x - 5 * s, y: bench.y }, 6 * s, 2 * s, TIMBER);
  post(graphics, { x: bench.x + 5 * s, y: bench.y + 2.5 * s }, 6 * s, 2 * s, TIMBER);
  graphics.fillStyle(shade(CRATE, 1.02), 1);
  polygon(
    graphics,
    strip(
      { x: bench.x - 6 * s, y: bench.y - 6 * s },
      { x: bench.x + 6 * s, y: bench.y - 3 * s },
      4 * s,
    ),
  );
}

/** A bell hung in a timber frame: the settlement calling people in. */
function drawBell(graphics: Phaser.GameObjects.Graphics, at: Point, s: number): void {
  const left = { x: at.x - 7 * s, y: at.y + 2 * s };
  const right = { x: at.x + 7 * s, y: at.y + 9 * s };
  const height = 22 * s;
  post(graphics, left, height, 3 * s, TIMBER);
  post(graphics, right, height, 3 * s, TIMBER);
  graphics.fillStyle(shade(TIMBER, 1.14), 1);
  polygon(
    graphics,
    strip({ x: left.x, y: left.y - height }, { x: right.x, y: right.y - height }, 3 * s),
  );
  // A brace under each head, which is what makes a frame rather than a goalpost.
  graphics.fillStyle(shade(TIMBER, 0.94), 1);
  polygon(
    graphics,
    strip(
      { x: left.x + 1 * s, y: left.y - height + 8 * s },
      { x: left.x + 7 * s, y: left.y - height + 4 * s },
      1.8 * s,
    ),
  );

  const hang = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 - height + 2 * s };
  graphics.fillStyle(0x8a7a45, 1);
  polygon(graphics, [
    { x: hang.x - 2 * s, y: hang.y },
    { x: hang.x + 2 * s, y: hang.y },
    { x: hang.x + 4.5 * s, y: hang.y + 8 * s },
    { x: hang.x - 4.5 * s, y: hang.y + 8 * s },
  ]);
  graphics.fillStyle(0x6d5f35, 1);
  polygon(graphics, [
    { x: hang.x - 4.5 * s, y: hang.y + 8 * s },
    { x: hang.x + 4.5 * s, y: hang.y + 8 * s },
    { x: hang.x + 4.5 * s, y: hang.y + 9.6 * s },
    { x: hang.x - 4.5 * s, y: hang.y + 9.6 * s },
  ]);
}
