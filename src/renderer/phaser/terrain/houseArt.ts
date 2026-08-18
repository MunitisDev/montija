/**
 * The house: a boarded cottage with an offset porch gable.
 *
 * **Split out of `buildingArt.ts` because a house is where the detail goes.**
 * Every other building here is a mass, a colour and one prop, and that is
 * enough — a Quarry is read at a glance and then ignored. A house is looked at,
 * it is the building there are most of, and it is what decides whether a
 * settlement reads as a village or as a row of boxes.
 *
 * Three constructions were drawn and compared side by side on the preview board
 * (see `preview.html`); this is the one that was chosen. The other two — an oak
 * frame with limewashed daub, and log courses on a deep drystone base — are
 * recorded in the recipes they came from rather than kept as dead code here.
 *
 * The rules it obeys, all from `buildingArt.ts`:
 *
 * - the anchor is the footprint's centre, on the ground line;
 * - nothing is drawn outside the plot, which `tests/building-art.test.ts` checks;
 * - the key light comes from the upper left;
 * - **near the camera is low on screen.** A wall's top edge runs from `(cx, y +
 *   halfH)` at the front corner *up* to `(cx ± halfW, y)` at the side one. The
 *   first version of this file had that sign backwards, which hung every post and
 *   plank off the face it belonged to.
 *
 * And one rule of its own, from the recipe: **at gameplay zoom a house reads from
 * its silhouette, its roof colour, its wall construction and one architectural
 * feature.** So there are three roof seams, five plank seams a face, one window,
 * one door, one chimney and one porch. Nothing else. More detail than that does
 * not survive being forty pixels tall, and it costs the low-poly look.
 */

import type Phaser from 'phaser';

import { bevel, occlude, polygon, shade, type Point } from './shading';

/** Boarded timber, ochre thatch, and the oak that trims both. */
export interface HouseLook {
  /** Height of the walls above the plinth, as a share of the full diagonal. */
  readonly wallHeight: number;
  readonly roofHeight: number;
  readonly eaves: number;
  readonly plinth: number;
  readonly wall: number;
  readonly roof: number;
  readonly timber: number;
}

/**
 * The one house, in the proportions the recipe gives.
 *
 * Heights are shares of the footprint's full screen diagonal (`2 * halfH`), so a
 * house keeps its proportions whatever the tile size becomes. The colours are the
 * ochre-roof family that was picked: warm boarded timber under straw.
 */
export const HOUSE_LOOK: HouseLook = {
  plinth: 0.07,
  // **Taller walls and a lower roof than the recipe asks for.** At 0.48 and 0.68
  // the roof swallowed the house: the boarding, the door and the window all
  // happen on the wall, and a wall a third the height of its own roof has nowhere
  // to put them. This is the same cottage with somewhere to look at.
  wallHeight: 0.6,
  roofHeight: 0.5,
  eaves: 0.09,
  wall: 0x8a6f4c,
  roof: 0x9a8654,
  timber: 0x5d4830,
};

/** How much of the back-to-front diagonal the ridge runs along. */
const RIDGE_RUN = 0.72;
/** Where the porch stands on the right wall, and how wide it is. */
const PORCH_AT = 0.34;
const PORCH_HALF = 0.19;
/** Plank seams down one wall face. */
const BOARD_SEAMS: readonly number[] = [0.16, 0.32, 0.48, 0.64, 0.8];
/** Rubble, shared with every other footing in the settlement. */
const STONE = 0x6a675e;
/** Where blocks are picked out along the footing. Fixed: nothing here is rolled. */
const STONE_BLOCKS: readonly number[] = [0.06, 0.3, 0.54, 0.78];
/** The charcoal blue of an unglazed opening. */
const WINDOW_DARK = 0x283039;

export interface HouseOptions {
  readonly cx: number;
  readonly groundY: number;
  /** Half-extents of the *building*, which is smaller than its plot. */
  readonly halfW: number;
  readonly halfH: number;
}

/**
 * Draws the house.
 *
 * Painter's order, and it matters: footing, walls, boarding, roof, then the porch
 * and the openings under it. The roof goes on before the door so its shade falls
 * across the wall the door is cut in, which is the difference between a building
 * and two stickers on the same plane.
 */
export function drawHouse(
  graphics: Phaser.GameObjects.Graphics,
  look: HouseLook,
  options: HouseOptions,
): void {
  const { cx, groundY, halfW, halfH } = options;
  /** Heights are shares of the full screen diagonal. */
  const unit = halfH * 2;

  const plinth = look.plinth * unit;
  const wallHeight = look.wallHeight * unit;
  const roofHeight = look.roofHeight * unit;
  const eaves = look.eaves * unit;

  const sillY = groundY - plinth;
  const topY = sillY - wallHeight;

  /** A corner of the footprint rhombus at some height. */
  const corner = (which: 'back' | 'right' | 'front' | 'left', y: number): Point => {
    switch (which) {
      case 'back':
        return { x: cx, y: y - halfH };
      case 'right':
        return { x: cx + halfW, y };
      case 'front':
        return { x: cx, y: y + halfH };
      default:
        return { x: cx - halfW, y };
    }
  };

  /**
   * A point on a wall face. `t` runs 0 at the front corner to 1 at the side one,
   * and `lift` raises it off that face's foot.
   */
  const face = (side: -1 | 1, t: number, y: number, lift = 0): Point => ({
    x: cx + side * halfW * t,
    y: y + halfH * (1 - t) - lift,
  });

  drawFooting(graphics, { face, groundY, sillY, corner });

  // The two walls the camera can see. Left catches the light, right is in shade.
  graphics.fillStyle(look.wall, 1);
  polygon(graphics, [
    corner('left', topY),
    corner('front', topY),
    corner('front', sillY),
    corner('left', sillY),
  ]);
  graphics.fillStyle(shade(look.wall, 0.78), 1);
  polygon(graphics, [
    corner('front', topY),
    corner('right', topY),
    corner('right', sillY),
    corner('front', sillY),
  ]);

  drawBoarding(graphics, look, { face, sillY, topY, wallHeight });

  // Gloom where the walls meet the ground: the strongest single cue that a
  // building is standing in the scene rather than pasted onto it.
  const gloom = Math.max(2.5, wallHeight * 0.15);
  for (const [from, to, strength] of [
    ['left', 'front', 0.16],
    ['front', 'right', 0.2],
  ] as const) {
    occlude(
      graphics,
      { x: corner(from, sillY).x, y: corner(from, sillY).y - gloom },
      { x: corner(to, sillY).x, y: corner(to, sillY).y - gloom },
      gloom,
      strength,
    );
  }

  drawRoof(graphics, look, { cx, topY, halfW, halfH, roofHeight, eaves, corner });

  // The roof's shade on the wall it sits on, started half an eave down because
  // the eaves oversail the wall the shadow actually lands on.
  const eaveGloom = Math.max(2, wallHeight * 0.1);
  for (const [from, to, strength] of [
    ['left', 'front', 0.16],
    ['front', 'right', 0.2],
  ] as const) {
    occlude(
      graphics,
      { x: corner(from, topY).x, y: corner(from, topY).y + eaves / 2 },
      { x: corner(to, topY).x, y: corner(to, topY).y + eaves / 2 },
      eaveGloom,
      strength,
    );
  }

  drawWindow(graphics, look, { face, topY, wallHeight });
  drawPorch(graphics, look, { face, cx, halfW, halfH, sillY, topY, wallHeight, eaves });
}

/**
 * A low stone footing: one course, four blocks a face.
 *
 * **Large blocks, not rubble.** A scatter of tiny masonry marks turns to noise at
 * gameplay zoom and reads as dirt on the wall; four picked-out stones a side read
 * as stone from across the map.
 */
function drawFooting(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    face: (side: -1 | 1, t: number, y: number, lift?: number) => Point;
    groundY: number;
    sillY: number;
    corner: (which: 'back' | 'right' | 'front' | 'left', y: number) => Point;
  },
): void {
  const { face, groundY, sillY, corner } = options;
  if (sillY >= groundY) {
    return;
  }

  graphics.fillStyle(STONE, 1);
  polygon(graphics, [
    corner('left', sillY),
    corner('front', sillY),
    corner('front', groundY),
    corner('left', groundY),
  ]);
  graphics.fillStyle(shade(STONE, 0.76), 1);
  polygon(graphics, [
    corner('front', sillY),
    corner('right', sillY),
    corner('right', groundY),
    corner('front', groundY),
  ]);

  // Blocks picked out along the course, drawn *on* the face rather than as
  // rectangles laid over it — an axis-aligned box on a sloping face is the
  // easiest way in this whole renderer to make stone look like litter.
  const depth = groundY - sillY;
  for (const side of [-1, 1] as const) {
    graphics.fillStyle(shade(STONE, side === -1 ? 1.14 : 0.66), 1);
    for (const t of STONE_BLOCKS) {
      const a = face(side, t, sillY, -depth * 0.22);
      const b = face(side, t + 0.16, sillY, -depth * 0.22);
      polygon(graphics, [a, b, { x: b.x, y: b.y + depth * 0.5 }, { x: a.x, y: a.y + depth * 0.5 }]);
    }
  }
}

/**
 * Vertical boards, and the rail that ties them.
 *
 * Five seams a face rather than a plank every two pixels: fewer and wider is what
 * keeps this legible when the house is forty pixels tall, and alternating the
 * strength of the seams gives the wall a rhythm without giving it stripes.
 */
function drawBoarding(
  graphics: Phaser.GameObjects.Graphics,
  look: HouseLook,
  options: {
    face: (side: -1 | 1, t: number, y: number, lift?: number) => Point;
    sillY: number;
    topY: number;
    wallHeight: number;
  },
): void {
  const { face, sillY, topY, wallHeight } = options;

  for (const side of [-1, 1] as const) {
    const dark = shade(look.wall, side === -1 ? 0.74 : 0.6);
    BOARD_SEAMS.forEach((t, index) => {
      const head = face(side, t, topY);
      const foot = face(side, t, sillY);
      graphics.fillStyle(dark, index % 2 === 0 ? 0.55 : 0.28);
      polygon(graphics, [
        { x: head.x - 0.9, y: head.y },
        { x: head.x + 0.9, y: head.y },
        { x: foot.x + 0.9, y: foot.y },
        { x: foot.x - 0.9, y: foot.y },
      ]);
    });

    // One rail across, low down, where a boarded wall is actually braced.
    const lift = wallHeight * 0.22;
    const a = face(side, 0.02, sillY, lift);
    const b = face(side, 0.98, sillY, lift);
    graphics.fillStyle(shade(look.timber, side === -1 ? 1.15 : 0.9), 1);
    polygon(graphics, [a, b, { x: b.x, y: b.y + 2.2 }, { x: a.x, y: a.y + 2.2 }]);
  }
}

/**
 * A hipped roof with a real ridge, rather than a pyramid.
 *
 * The pyramid was the single thing that made every building in this settlement
 * look like the same building: four planes meeting at a point has no direction,
 * so a house, a workshop and a store all read as the same lozenge. A ridge
 * running back to front gives the house an axis, and the eye reads an axis as
 * architecture.
 */
function drawRoof(
  graphics: Phaser.GameObjects.Graphics,
  look: HouseLook,
  options: {
    cx: number;
    topY: number;
    halfW: number;
    halfH: number;
    roofHeight: number;
    eaves: number;
    corner: (which: 'back' | 'right' | 'front' | 'left', y: number) => Point;
  },
): void {
  const { cx, topY, halfH, roofHeight, eaves, corner } = options;

  const ridgeY = topY - roofHeight;
  const ridgeBack = { x: cx, y: ridgeY - halfH * RIDGE_RUN };
  const ridgeFront = { x: cx, y: ridgeY + halfH * RIDGE_RUN };

  const eaveBack = { x: corner('back', topY).x, y: corner('back', topY).y - eaves / 2 };
  const eaveFront = { x: corner('front', topY).x, y: corner('front', topY).y + eaves / 2 };
  const eaveLeft = { x: corner('left', topY).x - eaves, y: corner('left', topY).y };
  const eaveRight = { x: corner('right', topY).x + eaves, y: corner('right', topY).y };

  // The far half first, so its silhouette shows above the ridge without being
  // drawn over the near slopes.
  graphics.fillStyle(shade(look.roof, 0.86), 1);
  polygon(graphics, [ridgeBack, eaveBack, eaveLeft, ridgeBack]);
  polygon(graphics, [ridgeBack, eaveBack, eaveRight, ridgeBack]);

  // Left slope, catching the light; right slope in shade.
  graphics.fillStyle(look.roof, 1);
  polygon(graphics, [ridgeBack, eaveLeft, eaveFront, ridgeFront]);
  graphics.fillStyle(shade(look.roof, 0.74), 1);
  polygon(graphics, [ridgeBack, eaveRight, eaveFront, ridgeFront]);

  // Three courses a slope, and no more: this is thatch read from forty pixels.
  for (const t of [0.27, 0.52, 0.77]) {
    const along = (from: Point, to: Point): Point => ({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
    graphics.fillStyle(shade(look.roof, 0.82), 0.55);
    for (const eave of [eaveLeft, eaveRight]) {
      const a = along(ridgeBack, eave);
      const b = along(ridgeFront, eave);
      polygon(graphics, [a, b, { x: b.x, y: b.y + 1.4 }, { x: a.x, y: a.y + 1.4 }]);
    }
  }

  // The sawn edge of the eaves, which is what gives the roof thickness.
  graphics.fillStyle(shade(look.roof, 0.54), 1);
  for (const eave of [eaveLeft, eaveRight]) {
    polygon(graphics, [
      eave,
      eaveFront,
      { x: eaveFront.x, y: eaveFront.y + 3 },
      { x: eave.x, y: eave.y + 3 },
    ]);
  }

  // The ridge cap, and the light along the two near hips.
  graphics.fillStyle(shade(look.roof, 1.1), 1);
  polygon(graphics, [
    { x: ridgeBack.x - 1.8, y: ridgeBack.y },
    { x: ridgeBack.x + 1.8, y: ridgeBack.y },
    { x: ridgeFront.x + 1.8, y: ridgeFront.y },
    { x: ridgeFront.x - 1.8, y: ridgeFront.y },
  ]);
  bevel(graphics, ridgeFront, eaveLeft, shade(look.roof, 1.2), 1.3);
  bevel(graphics, ridgeFront, eaveRight, shade(look.roof, 0.95), 1.3);
}

/** One window, on the wall the porch is not on. Glass was for churches. */
function drawWindow(
  graphics: Phaser.GameObjects.Graphics,
  look: HouseLook,
  options: {
    face: (side: -1 | 1, t: number, y: number, lift?: number) => Point;
    topY: number;
    wallHeight: number;
  },
): void {
  const { face, topY, wallHeight } = options;
  const head = wallHeight * 0.34;
  const sill = wallHeight * 0.68;

  const at = (t: number, lift: number): Point => face(-1, t, topY, -lift);
  const frame = [at(0.3, head - 3), at(0.56, head - 3), at(0.56, sill + 3), at(0.3, sill + 3)];
  graphics.fillStyle(shade(look.timber, 1.3), 1);
  polygon(graphics, frame);

  graphics.fillStyle(WINDOW_DARK, 1);
  polygon(graphics, [at(0.33, head), at(0.53, head), at(0.53, sill), at(0.33, sill)]);

  // One mullion, upright. Two would be a church window.
  graphics.fillStyle(shade(look.timber, 1.3), 1);
  polygon(graphics, [at(0.425, head), at(0.445, head), at(0.445, sill), at(0.425, sill)]);

  // The reveal along the head, in shadow: the wall's own thickness, and what
  // says "an opening in something" rather than "a dark shape painted on".
  graphics.fillStyle(0x000000, 0.35);
  polygon(graphics, [at(0.33, head), at(0.53, head), at(0.53, head - 2.4), at(0.33, head - 2.4)]);
}

/**
 * The porch, and the door under it — the house's one architectural feature.
 *
 * Set off centre on purpose. A porch in the middle of a symmetrical elevation
 * makes the whole house look machined, and these are cottages people put up
 * themselves; the offset is what says somebody decided where the door went.
 */
function drawPorch(
  graphics: Phaser.GameObjects.Graphics,
  look: HouseLook,
  options: {
    face: (side: -1 | 1, t: number, y: number, lift?: number) => Point;
    cx: number;
    halfW: number;
    halfH: number;
    sillY: number;
    topY: number;
    wallHeight: number;
    eaves: number;
  },
): void {
  const { face, sillY, wallHeight, eaves } = options;
  const doorHeight = wallHeight * 0.72;
  const left = PORCH_AT - PORCH_HALF;
  const right = PORCH_AT + PORCH_HALF;

  // The doorway first: a hole cut straight in the boarding, no frame. That is
  // what a boarded wall gives you, and it is the difference between this house
  // and the framed one it was chosen over.
  const at = (t: number, lift: number): Point => face(1, t, sillY, lift);
  graphics.fillStyle(shade(look.wall, 0.42), 1);
  polygon(graphics, [
    at(left + 0.03, doorHeight),
    at(right - 0.03, doorHeight),
    at(right - 0.03, 0),
    at(left + 0.03, 0),
  ]);

  // The leaf, hung in it: boards, one iron strap across, and a latch.
  graphics.fillStyle(shade(look.wall, 0.66), 1);
  polygon(graphics, [
    at(left + 0.05, doorHeight - 1.5),
    at(right - 0.05, doorHeight - 1.5),
    at(right - 0.05, 0),
    at(left + 0.05, 0),
  ]);
  graphics.fillStyle(shade(look.wall, 0.5), 1);
  for (const t of [left + 0.11, left + 0.19]) {
    polygon(graphics, [
      at(t + 0.012, doorHeight - 2),
      at(t, doorHeight - 2),
      at(t, 0),
      at(t + 0.012, 0),
    ]);
  }
  const strapY = doorHeight * 0.62;
  graphics.fillStyle(shade(look.timber, 0.8), 1);
  polygon(graphics, [
    at(left + 0.05, strapY),
    at(right - 0.05, strapY),
    at(right - 0.05, strapY - 1.7),
    at(left + 0.05, strapY - 1.7),
  ]);
  graphics.fillStyle(0x201b16, 1);
  polygon(graphics, [
    at(right - 0.08, strapY + 3),
    at(right - 0.055, strapY + 3),
    at(right - 0.055, strapY + 1),
    at(right - 0.08, strapY + 1),
  ]);

  // A stone step, worn into the ground at the threshold.
  graphics.fillStyle(shade(STONE, 1.05), 1);
  const stepOut = 0.055;
  polygon(graphics, [
    at(left + 0.02, -1),
    at(right - 0.02, -1),
    { x: at(right - 0.02, -1).x + stepOut * options.halfW, y: at(right - 0.02, -1).y + 3.4 },
    { x: at(left + 0.02, -1).x + stepOut * options.halfW, y: at(left + 0.02, -1).y + 3.4 },
  ]);

  // Two posts standing off the wall, carrying the hood.
  const stand = eaves * 1.7;
  const headLift = doorHeight + wallHeight * 0.12;
  const outward = (p: Point): Point => ({ x: p.x + stand, y: p.y + stand / 2 });
  const wallA = at(left - 0.015, headLift);
  const wallB = at(right + 0.015, headLift);
  const outA = outward(wallA);
  const outB = outward(wallB);

  for (const [head, foot] of [
    [outA, outward(at(left - 0.015, 0))],
    [outB, outward(at(right + 0.015, 0))],
  ] as const) {
    graphics.fillStyle(shade(look.timber, 1.05), 1);
    polygon(graphics, [
      { x: head.x - 1.8, y: head.y },
      { x: head.x + 1.8, y: head.y },
      { x: foot.x + 1.8, y: foot.y },
      { x: foot.x - 1.8, y: foot.y },
    ]);
    graphics.fillStyle(shade(look.timber, 1.35), 1);
    polygon(graphics, [
      { x: head.x - 1.8, y: head.y },
      { x: head.x - 0.6, y: head.y },
      { x: foot.x - 0.6, y: foot.y },
      { x: foot.x - 1.8, y: foot.y },
    ]);
  }

  // A little gable projecting from the wall: a ridge from the wall out over the
  // door, two flaps falling from it, and the boarded triangle facing out.
  //
  // A gable rather than a lean-to because its whole job is the **silhouette**.
  // At the zoom this game is played at, a hood flat against the roof disappears;
  // a ridge sticking out of it is the one thing that says a house has a front.
  const rise = wallHeight * 0.2;
  const wallRidge = at(PORCH_AT, headLift + rise);
  const outRidge = outward(at(PORCH_AT, headLift + rise * 0.72));

  graphics.fillStyle(look.roof, 1);
  polygon(graphics, [wallRidge, outRidge, outA, wallA]);
  graphics.fillStyle(shade(look.roof, 0.74), 1);
  polygon(graphics, [wallRidge, outRidge, outB, wallB]);

  // The boarded triangle under the ridge, facing the way the door does.
  graphics.fillStyle(shade(look.wall, 0.88), 1);
  polygon(graphics, [outA, outRidge, outB]);

  // The sawn edges of the two flaps, and the light along the ridge.
  graphics.fillStyle(shade(look.roof, 0.52), 1);
  polygon(graphics, [
    outA,
    outRidge,
    { x: outRidge.x, y: outRidge.y + 2.2 },
    { x: outA.x, y: outA.y + 2.2 },
  ]);
  polygon(graphics, [
    outRidge,
    outB,
    { x: outB.x, y: outB.y + 2.2 },
    { x: outRidge.x, y: outRidge.y + 2.2 },
  ]);
  bevel(graphics, wallRidge, outRidge, shade(look.roof, 1.22), 1.3);

  // And the shade the hood throws on the wall behind it.
  occlude(graphics, wallA, wallB, 4, 0.2);
}
