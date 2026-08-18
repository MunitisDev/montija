/**
 * Houses, in three constructions.
 *
 * **Split out of `buildingArt.ts` because a house is where the detail goes.**
 * Every other building in this settlement is a mass and a colour and one prop,
 * and that is enough: a Quarry is read at a glance and then ignored. A house is
 * looked at. It is also the thing there are most of, so it is the thing that
 * decides whether a settlement reads as a village or as a row of boxes.
 *
 * The first attempt was one house with things added round it — a fence, a
 * garden, a porch — and it was reported, correctly, as fussy and vague: the
 * chimney hung in the air, a bevel on the front corner read as a white stripe,
 * and the door looked stuck on. The lesson is the usual one. **Detail on the
 * building beats accessories around it.**
 *
 * So there are three, and they differ in *how they are built* rather than in
 * what is parked beside them:
 *
 * - **framed** — oak posts, rails and braces with limewashed daub between them;
 * - **boarded** — walls of vertical planks under thatch, with no frame at all;
 * - **stone** — a drystone base carrying log courses, under a turf roof.
 *
 * All three obey the rules in `buildingArt.ts`: the anchor is the footprint's
 * centre on the ground line, nothing is drawn outside the plot, and the light
 * comes from the upper left.
 */

import type Phaser from 'phaser';

import { bevel, occlude, polygon, shade, type Point } from './shading';

/** Which way a house is put together. */
export type HouseStyle = 'framed' | 'boarded' | 'stone';

export interface HouseLook {
  readonly style: HouseStyle;
  /** Height of the walls above the plinth, in pixels. */
  readonly wallHeight: number;
  readonly roofHeight: number;
  readonly eaves: number;
  /** Stone footing under the walls. The stone house stands on a deep one. */
  readonly plinth: number;
  /** Wall, roof and timber. Kept per style: these are different materials. */
  readonly wall: number;
  readonly roof: number;
  readonly timber: number;
  /** `true` where the door is set in a frame, rather than cut in the wall. */
  readonly framedDoor: boolean;
}

/**
 * The three, in the order they are offered.
 *
 * Values are deliberately close in *silhouette* — a village of three unrelated
 * shapes reads as three unrelated games — and far apart in surface. What tells
 * them apart is the material, which is the honest difference between a house
 * somebody framed in oak and a house somebody nailed together out of boards.
 */
export const HOUSE_LOOKS: readonly HouseLook[] = [
  {
    style: 'framed',
    wallHeight: 26,
    roofHeight: 40,
    eaves: 5,
    plinth: 5,
    wall: 0xa79c85,
    roof: 0x7b4a33,
    timber: 0x4a3c2c,
    framedDoor: true,
  },
  {
    style: 'boarded',
    wallHeight: 24,
    roofHeight: 44,
    eaves: 7,
    plinth: 3,
    wall: 0x8a6f4c,
    roof: 0x9a8654,
    timber: 0x5d4830,
    framedDoor: false,
  },
  {
    style: 'stone',
    wallHeight: 27,
    roofHeight: 36,
    eaves: 5,
    plinth: 12,
    wall: 0x8d7f66,
    roof: 0x6a7247,
    timber: 0x50412e,
    framedDoor: true,
  },
];

/** The four corners of a rhombus centred on `cx`, at height `y`. */
interface Rhombus {
  readonly back: Point;
  readonly right: Point;
  readonly front: Point;
  readonly left: Point;
}

export interface HouseOptions {
  readonly cx: number;
  readonly groundY: number;
  /** Half-extents of the *building*, which is smaller than its plot. */
  readonly halfW: number;
  readonly halfH: number;
}

/**
 * Draws one house, in one of the three constructions.
 *
 * Order is painter's order and matters: plinth, walls, wall surface, roof, then
 * the openings cut in it. The roof goes on before the door so its shadow falls
 * across the wall the door is in, which is the difference between a building and
 * two stickers on the same plane.
 */
export function drawHouse(
  graphics: Phaser.GameObjects.Graphics,
  look: HouseLook,
  options: HouseOptions,
): void {
  const { cx, groundY, halfW, halfH } = options;

  const rhombus = (y: number): Rhombus => ({
    back: { x: cx, y: y - halfH },
    right: { x: cx + halfW, y },
    front: { x: cx, y: y + halfH },
    left: { x: cx - halfW, y },
  });

  const ground = rhombus(groundY);
  const sillY = groundY - look.plinth;
  const topY = groundY - look.plinth - look.wallHeight;
  const sill = rhombus(sillY);
  const top = rhombus(topY);

  drawPlinth(graphics, { look, ground, sill, cx, halfW, halfH, groundY });

  // The two walls the camera can see. Left catches the light; right is in shade,
  // because the key light comes from the upper left throughout this game.
  graphics.fillStyle(look.wall, 1);
  polygon(graphics, [top.left, top.front, sill.front, sill.left]);
  graphics.fillStyle(shade(look.wall, 0.78), 1);
  polygon(graphics, [top.front, top.right, sill.right, sill.front]);

  drawWallSurface(graphics, { look, cx, halfW, halfH, sillY, topY });

  // Gloom where the walls meet the ground: the single strongest cue that a
  // building is standing in the scene rather than pasted onto it.
  const gloom = Math.max(2.5, look.wallHeight * 0.15);
  occlude(
    graphics,
    { x: sill.left.x, y: sill.left.y - gloom },
    { x: sill.front.x, y: sill.front.y - gloom },
    gloom,
    0.16,
  );
  occlude(
    graphics,
    { x: sill.front.x, y: sill.front.y - gloom },
    { x: sill.right.x, y: sill.right.y - gloom },
    gloom,
    0.2,
  );

  drawRoof(graphics, look, { top, cx, apexY: topY - look.roofHeight, halfH });

  // The roof's shadow on the wall it sits on, started half an eave below the
  // wall head because the eaves oversail the wall the shadow lands on.
  const eaveDrop = look.eaves / 2;
  const eaveGloom = Math.max(2, look.wallHeight * 0.1);
  occlude(
    graphics,
    { x: top.left.x, y: top.left.y + eaveDrop },
    { x: top.front.x, y: top.front.y + eaveDrop },
    eaveGloom,
    0.16,
  );
  occlude(
    graphics,
    { x: top.front.x, y: top.front.y + eaveDrop },
    { x: top.right.x, y: top.right.y + eaveDrop },
    eaveGloom,
    0.2,
  );

  drawDoor(graphics, look, { cx, halfW, halfH, sillY });
  drawWindow(graphics, look, { cx, halfW, halfH, sillY });
}

/**
 * The footing. Rubble, not dressed masonry — this is a frontier settlement.
 *
 * The stone house's is deep enough to be the lower half of the building, which
 * is what makes it a different house rather than a differently painted one.
 */
function drawPlinth(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    look: HouseLook;
    ground: Rhombus;
    sill: Rhombus;
    cx: number;
    halfW: number;
    halfH: number;
    groundY: number;
  },
): void {
  const { look, ground, sill, cx, halfW, halfH, groundY } = options;
  if (look.plinth <= 0) {
    return;
  }

  graphics.fillStyle(STONE, 1);
  polygon(graphics, [sill.left, sill.front, ground.front, ground.left]);
  graphics.fillStyle(shade(STONE, 0.76), 1);
  polygon(graphics, [sill.front, sill.right, ground.right, ground.front]);

  // Individual stones, picked out along both faces at fixed places. On a deep
  // footing this is most of what the eye reads, so it gets two courses.
  const courses = look.plinth > 8 ? [0.3, 0.68] : [0.5];
  for (const [index, up] of courses.entries()) {
    graphics.fillStyle(shade(STONE, index === 0 ? 1.16 : 1.05), 1);
    for (const t of STONE_COURSE) {
      const y = groundY + halfH * (t - 0.5) * 0.92 - look.plinth * up;
      graphics.fillRect(cx - halfW + halfW * t, y, 7, 3);
    }
    graphics.fillStyle(shade(STONE, index === 0 ? 0.62 : 0.7), 1);
    for (const t of STONE_COURSE) {
      const y = groundY - halfH * (t - 0.5) * 0.92 - look.plinth * up;
      graphics.fillRect(cx + halfW * t - 7, y, 7, 3);
    }
  }
}

/**
 * What the walls are made of, which is the whole point of having three houses.
 *
 * Every one of these is drawn *on* the two wall faces already filled behind it,
 * following the same slope the face does, so nothing here has to know about
 * isometric projection beyond "y rises with x on the left, falls on the right".
 */
function drawWallSurface(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    look: HouseLook;
    cx: number;
    halfW: number;
    halfH: number;
    sillY: number;
    topY: number;
  },
): void {
  const { look, cx, halfW, halfH, sillY, topY } = options;

  /**
   * A point on a wall face. `t` runs 0 at the front corner to 1 at the far one.
   *
   * **The near corner is the low one.** A wall's top edge runs from `(cx, y +
   * halfH)` at the front corner up to `(cx ± halfW, y)` at the side corner, so
   * screen height *falls* as `t` rises. Getting that backwards — and it was
   * backwards, in this file and in the generic framing it was modelled on — hangs
   * every post, plank and door off the face it is supposed to be drawn on, which
   * is what made the house look see-through and the door look stuck on crooked.
   */
  const on = (side: -1 | 1, t: number, y: number): Point => ({
    x: cx + side * halfW * t,
    y: y + halfH * (1 - t),
  });

  const lit = (colour: number, side: -1 | 1): number => shade(colour, side === -1 ? 1 : 0.78);

  for (const side of [-1, 1] as const) {
    if (look.style === 'framed') {
      // Oak posts at the corners and the third points, a rail across the middle
      // and a brace under it. Four uprights read as a timber building instantly;
      // a full cruck frame at this size turns into noise.
      graphics.fillStyle(lit(look.timber, side), 1);
      for (const t of [0.03, 0.35, 0.67, 0.97]) {
        const head = on(side, t, topY);
        const foot = on(side, t, sillY);
        polygon(graphics, [
          { x: head.x - 1.7, y: head.y },
          { x: head.x + 1.7, y: head.y },
          { x: foot.x + 1.7, y: foot.y },
          { x: foot.x - 1.7, y: foot.y },
        ]);
      }

      // The mid rail, following the wall's slope.
      const railY = (topY + sillY) / 2;
      const a = on(side, 0.03, railY);
      const b = on(side, 0.97, railY);
      polygon(graphics, [a, b, { x: b.x, y: b.y + 2.4 }, { x: a.x, y: a.y + 2.4 }]);

      // And one brace per face, which is what says *carpentry* rather than
      // *stripes*: a diagonal from the foot of a post to the head of the next.
      const braceFoot = on(side, 0.35, sillY);
      const braceHead = on(side, 0.67, railY);
      polygon(graphics, [
        { x: braceFoot.x, y: braceFoot.y },
        { x: braceFoot.x + side * 2.4, y: braceFoot.y + 1.2 },
        { x: braceHead.x + side * 2.4, y: braceHead.y + 1.2 },
        { x: braceHead.x, y: braceHead.y },
      ]);
      continue;
    }

    if (look.style === 'boarded') {
      // Vertical boards, seam by seam, with a lighter batten every fourth one.
      for (let index = 1; index < BOARDS; index += 1) {
        const t = index / BOARDS;
        const head = on(side, t, topY);
        const foot = on(side, t, sillY);
        const batten = index % 4 === 0;
        graphics.fillStyle(
          lit(batten ? shade(look.wall, 1.16) : shade(look.wall, 0.84), side),
          batten ? 1 : 0.85,
        );
        const width = batten ? 2.2 : 1.1;
        polygon(graphics, [
          { x: head.x - width / 2, y: head.y },
          { x: head.x + width / 2, y: head.y },
          { x: foot.x + width / 2, y: foot.y },
          { x: foot.x - width / 2, y: foot.y },
        ]);
      }
      continue;
    }

    // Stone: horizontal log courses above the footing, round-ended, so the wall
    // reads as timber laid on stone rather than as one material in two colours.
    for (let course = 0; course < LOG_COURSES; course += 1) {
      const y = sillY - ((course + 0.5) * (sillY - topY)) / LOG_COURSES;
      const a = on(side, 0.02, y);
      const b = on(side, 0.98, y);
      const thickness = (sillY - topY) / LOG_COURSES;
      graphics.fillStyle(lit(shade(look.wall, 1.06), side), 1);
      polygon(graphics, [
        { x: a.x, y: a.y - thickness * 0.34 },
        { x: b.x, y: b.y - thickness * 0.34 },
        { x: b.x, y: b.y + thickness * 0.2 },
        { x: a.x, y: a.y + thickness * 0.2 },
      ]);
      graphics.fillStyle(lit(shade(look.wall, 0.72), side), 1);
      polygon(graphics, [
        { x: a.x, y: a.y + thickness * 0.2 },
        { x: b.x, y: b.y + thickness * 0.2 },
        { x: b.x, y: b.y + thickness * 0.34 },
        { x: a.x, y: a.y + thickness * 0.34 },
      ]);
    }
  }
}

/** The roof: thatch, shingles or turf, and the ridge along the top of it. */
function drawRoof(
  graphics: Phaser.GameObjects.Graphics,
  look: HouseLook,
  options: { top: Rhombus; cx: number; apexY: number; halfH: number },
): void {
  const { top, cx, apexY } = options;
  const eaves = look.eaves;

  const eL = { x: top.left.x - eaves, y: top.left.y + eaves / 2 };
  const eR = { x: top.right.x + eaves, y: top.right.y + eaves / 2 };
  const eF = { x: top.front.x, y: top.front.y + eaves / 2 };
  const eB = { x: top.back.x, y: top.back.y - eaves / 2 };
  const apex = { x: cx, y: apexY };

  // Far pitches first, so their silhouette shows above the ridge without being
  // drawn over the near ones.
  graphics.fillStyle(shade(look.roof, 0.86), 1);
  polygon(graphics, [apex, eB, eL]);
  polygon(graphics, [apex, eB, eR]);

  graphics.fillStyle(look.roof, 1);
  polygon(graphics, [apex, eL, eF]);
  graphics.fillStyle(shade(look.roof, 0.74), 1);
  polygon(graphics, [apex, eF, eR]);

  // The covering. Courses that follow the pitch, so the eye reads a surface
  // rather than a flat triangle — and a different number of them per material,
  // because thatch is laid in deep bundles and shingles in shallow rows.
  const rows = look.style === 'boarded' ? 3 : look.style === 'stone' ? 2 : 5;
  for (let row = 1; row <= rows; row += 1) {
    const t = row / (rows + 1);
    const along = (from: Point, to: Point): Point => ({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
    graphics.fillStyle(shade(look.roof, 0.9), 0.55);
    const l = along(apex, eL);
    const f = along(apex, eF);
    const r = along(apex, eR);
    polygon(graphics, [l, f, { x: f.x, y: f.y + 1.6 }, { x: l.x, y: l.y + 1.6 }]);
    polygon(graphics, [f, r, { x: r.x, y: r.y + 1.6 }, { x: f.x, y: f.y + 1.6 }]);
  }

  // The sawn edge of the eaves, which is what gives the roof thickness.
  graphics.fillStyle(shade(look.roof, 0.56), 1);
  polygon(graphics, [eL, eF, { x: eF.x, y: eF.y + 3 }, { x: eL.x, y: eL.y + 3 }]);
  polygon(graphics, [eF, eR, { x: eR.x, y: eR.y + 3 }, { x: eF.x, y: eF.y + 3 }]);

  // A ridge along the near hips, catching the light.
  bevel(graphics, apex, eL, shade(look.roof, 1.22), 1.3);
  bevel(graphics, apex, eF, shade(look.roof, 1.14), 1.3);
}

/**
 * A door on the left wall, which faces the camera.
 *
 * **The reported defect was here.** A pale leaf inside a pale frame on a pale
 * wall is three values of the same colour and reads as a smudge — "a strange
 * white patch" was the report, and it was right. The leaf is boarded timber now,
 * dark against a limewashed wall and light against a boarded one, and the frame
 * only exists on the houses that have one.
 */
function drawDoor(
  graphics: Phaser.GameObjects.Graphics,
  look: HouseLook,
  options: { cx: number; halfW: number; halfH: number; sillY: number },
): void {
  const { cx, halfW, halfH, sillY } = options;
  const height = Math.min(look.wallHeight - 4, 17);
  if (height <= 6) {
    return;
  }

  // Measured from the front corner along the left wall, on the same rule the
  // wall surface uses: near the camera is low on screen.
  const at = (t: number, lift: number): Point => ({
    x: cx - halfW * t,
    y: sillY + halfH * (1 - t) - lift,
  });

  if (look.framedDoor) {
    // Posts and a lintel, in the same oak the rest of the house is framed in.
    graphics.fillStyle(look.timber, 1);
    polygon(graphics, [at(0.68, height + 3), at(0.28, height + 3), at(0.28, 0), at(0.68, 0)]);
  }

  // The leaf: vertical boards, dark enough to be a hole in a pale wall and light
  // enough to be a door in a dark one.
  const leaf = look.style === 'framed' ? shade(look.timber, 1.5) : shade(look.timber, 1.15);
  graphics.fillStyle(leaf, 1);
  polygon(graphics, [at(0.64, height), at(0.32, height), at(0.32, 0), at(0.64, 0)]);

  // Two plank seams down it, and a ledger across.
  graphics.fillStyle(shade(leaf, 0.72), 1);
  for (const t of [0.42, 0.53]) {
    polygon(graphics, [at(t + 0.012, height), at(t, height), at(t, 0), at(t + 0.012, 0)]);
  }
  polygon(graphics, [
    at(0.64, height * 0.58),
    at(0.32, height * 0.58),
    at(0.32, height * 0.58 - 1.6),
    at(0.64, height * 0.58 - 1.6),
  ]);

  // The head of the opening, in shadow. This is what says "set back in a wall
  // with thickness" rather than "painted on a flat surface".
  graphics.fillStyle(0x000000, 0.34);
  polygon(graphics, [
    at(0.64, height),
    at(0.32, height),
    at(0.32, height - 2.2),
    at(0.64, height - 2.2),
  ]);
}

/** One window on the right wall, shuttered. Glass was for churches. */
function drawWindow(
  graphics: Phaser.GameObjects.Graphics,
  look: HouseLook,
  options: { cx: number; halfW: number; halfH: number; sillY: number },
): void {
  const { cx, halfW, halfH, sillY } = options;
  const t = 0.46;
  const y = sillY + halfH * (1 - t) - look.wallHeight * 0.6;
  const x = cx + halfW * t;

  graphics.fillStyle(shade(look.timber, 1.35), 1);
  polygon(graphics, [
    { x: x - 7, y: y - 3.6 },
    { x: x + 2, y: y + 0.9 },
    { x: x + 2, y: y + 9.6 },
    { x: x - 7, y: y + 6.2 },
  ]);

  graphics.fillStyle(WINDOW_DARK, 1);
  polygon(graphics, [
    { x: x - 5.4, y: y - 2 },
    { x: x + 0.9, y: y + 1.1 },
    { x: x + 0.9, y: y + 8 },
    { x: x - 5.4, y: y + 5 },
  ]);

  // A shutter, folded back against the wall on the near side of the opening.
  graphics.fillStyle(shade(look.timber, 1.15), 1);
  polygon(graphics, [
    { x: x - 8.6, y: y - 4.4 },
    { x: x - 6.6, y: y - 3.4 },
    { x: x - 6.6, y: y + 5.4 },
    { x: x - 8.6, y: y + 4.4 },
  ]);

  // The reveal along the head, in shadow.
  graphics.fillStyle(0x000000, 0.35);
  polygon(graphics, [
    { x: x - 5.4, y: y - 2 },
    { x: x + 0.9, y: y + 1.1 },
    { x: x + 0.9, y: y + 2.7 },
    { x: x - 5.4, y: y - 0.4 },
  ]);
}

/** Rubble, shared by every footing in the settlement. */
const STONE = 0x6a675e;
/** Where stones are picked out along a course. Fixed: nothing here is rolled. */
const STONE_COURSE: readonly number[] = [0.22, 0.54, 0.82];
/** Boards across one wall face of a boarded house. */
const BOARDS = 13;
/** Log courses above the footing of a stone house. */
const LOG_COURSES = 4;
/** The dark of an unglazed opening. */
const WINDOW_DARK = 0x201b16;
