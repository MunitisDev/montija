/**
 * Shapes every building is built out of, and the roof rule they all obey.
 *
 * **A pyramid has no direction.** Four planes meeting at one apex is the same
 * lozenge whatever it is sitting on, so a house, a workshop and a store all read
 * as the same object at gameplay zoom — which is what the settlement looked
 * like. Every pitched roof drawn through this module uses a **ridge segment**
 * instead: `ridgeBack` and `ridgeFront`, with a four-point plane on each side of
 * it. That single change is what gives a building a front.
 *
 * Renderer-only, like everything under `terrain/`: these run once at startup to
 * fill a texture and never again.
 */

import type Phaser from 'phaser';

import { bevel, polygon, shade, type Point } from './shading';

/** Which wall is being drawn: `-1` is the lit left face, `1` the shaded right. */
export type Side = -1 | 1;

/** The six points a gable roof is drawn from. */
export interface RoofFrame {
  readonly ridgeBack: Point;
  readonly ridgeFront: Point;
  readonly leftBack: Point;
  readonly leftFront: Point;
  readonly rightBack: Point;
  readonly rightFront: Point;
}

/**
 * The frame for a gable roof over a building of this size.
 *
 * **The ridge is a segment, and that is the whole point** — see the module note.
 * A single apex has no direction and every building drawn with one reads as the
 * same lozenge.
 *
 * The recipe this comes from gave the eaves as two vertical lines at
 * `cx ± (halfW + eaves)`, running the full height of the plot. That was tried
 * literally and cannot work: those are the eaves of a roof over a *screen-space
 * rectangle*, and this footprint is a diamond. The roof came out as a slab
 * covering the whole plot with the walls hidden inside it and its corners hanging
 * in mid-air, several cells from any wall. The eaves have to follow the
 * footprint's own edges, which is what this does.
 *
 * The ridge runs **parallel to the right-facing wall**, so the gable end stands
 * over the left-facing one — the wall the camera sees most of and the wall the
 * door is in. A door under a gable is the front of a house; a door under an eave
 * is a side entrance.
 */
export function makeGableRoofFrame(
  cx: number,
  topY: number,
  halfW: number,
  halfH: number,
  roofHeight: number,
  eaves: number,
): RoofFrame {
  // The ridge sits over the midpoints of the two gable walls, which for a square
  // footprint are half a diagonal either side of the centre.
  const ridgeY = topY - roofHeight;
  // And oversails the gable it stands over, the way a barge board does.
  const barge = eaves * 0.55;

  return {
    ridgeFront: { x: cx - halfW / 2 - barge, y: ridgeY + halfH / 2 + barge / 2 },
    ridgeBack: { x: cx + halfW / 2, y: ridgeY - halfH / 2 },

    // The near slope falls to the right-facing wall: front corner to right.
    leftFront: { x: cx, y: topY + halfH + eaves / 2 },
    leftBack: { x: cx + halfW + eaves, y: topY },

    // The far slope falls to the back-left wall, and is mostly hidden.
    rightFront: { x: cx - halfW - eaves, y: topY },
    rightBack: { x: cx, y: topY - halfH - eaves / 2 },
  };
}

/** The two pitches, the sawn edge under the near eave, and the ridge. */
export function drawGableRoof(
  graphics: Phaser.GameObjects.Graphics,
  frame: RoofFrame,
  roof: number,
): void {
  // The far slope first, so its silhouette shows above the ridge without being
  // drawn over the near one.
  graphics.fillStyle(shade(roof, 0.76), 1);
  polygon(graphics, [frame.ridgeBack, frame.ridgeFront, frame.rightFront, frame.rightBack]);

  // The near slope, catching the light.
  graphics.fillStyle(roof, 1);
  polygon(graphics, [frame.ridgeBack, frame.ridgeFront, frame.leftFront, frame.leftBack]);

  // The sawn edge along the near eave, which is what gives the roof thickness.
  graphics.fillStyle(shade(roof, 0.58), 1);
  polygon(graphics, [
    frame.leftFront,
    frame.leftBack,
    { x: frame.leftBack.x, y: frame.leftBack.y + 3 },
    { x: frame.leftFront.x, y: frame.leftFront.y + 3 },
  ]);

  bevel(graphics, frame.ridgeBack, frame.ridgeFront, shade(roof, 1.16), 1.5);
}

/** One course across a pitch, at `t` of the way down from the ridge. */
export function drawRoofCourse(
  graphics: Phaser.GameObjects.Graphics,
  a0: Point,
  a1: Point,
  b0: Point,
  b1: Point,
  t: number,
  colour: number,
  thickness = 1.6,
): void {
  const p0 = { x: a0.x + (a1.x - a0.x) * t, y: a0.y + (a1.y - a0.y) * t };
  const p1 = { x: b0.x + (b1.x - b0.x) * t, y: b0.y + (b1.y - b0.y) * t };

  graphics.fillStyle(colour, 0.52);
  polygon(graphics, [p0, p1, { x: p1.x, y: p1.y + thickness }, { x: p0.x, y: p0.y + thickness }]);
}

/**
 * Three courses a pitch, and no more.
 *
 * The density rule: at gameplay zoom a building reads from its silhouette, its
 * roof colour, its wall construction and one feature. A fourth course is noise
 * that costs the low-poly look and buys nothing.
 */
export function drawThreeRoofCourses(
  graphics: Phaser.GameObjects.Graphics,
  frame: RoofFrame,
  roof: number,
): void {
  for (const t of [0.28, 0.53, 0.78]) {
    drawRoofCourse(
      graphics,
      frame.ridgeBack,
      frame.leftBack,
      frame.ridgeFront,
      frame.leftFront,
      t,
      shade(roof, 0.88),
    );
    drawRoofCourse(
      graphics,
      frame.ridgeBack,
      frame.rightBack,
      frame.ridgeFront,
      frame.rightFront,
      t,
      shade(roof, 0.7),
    );
  }
}

/**
 * A point on a wall face. `t` runs 0 at the front corner to 1 at the side one.
 *
 * **Near the camera is low on screen.** A wall's top edge runs from `(cx, y +
 * halfH)` at the front corner *up* to `(cx ± halfW, y)` at the side one, so
 * screen height falls as `t` rises. An earlier version of this had the sign the
 * other way round, which hung every post, plank and door off the face it was
 * supposed to be drawn on.
 */
export function wallPoint(
  cx: number,
  halfW: number,
  halfH: number,
  side: Side,
  t: number,
  y: number,
): Point {
  return { x: cx + side * halfW * t, y: y + halfH * (1 - t) };
}

/**
 * A band of given thickness between two points, square to the line.
 *
 * For beams, seams, rails and straps. An axis-aligned rectangle laid over a
 * sloping isometric face is the easiest way in this whole renderer to make
 * timber look like litter, and this is the fix for it.
 */
export function strip(a: Point, b: Point, thickness: number): readonly Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;

  const nx = (-dy / length) * thickness * 0.5;
  const ny = (dx / length) * thickness * 0.5;

  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}
