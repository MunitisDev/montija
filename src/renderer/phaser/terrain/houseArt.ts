/**
 * The house: a cross-gabled cottage, timber-framed on a stone base.
 *
 * **Split out of `buildingArt.ts` because a house is where the detail goes.**
 * Every other building here is a mass, a colour and one prop, and that is enough
 * — a Quarry is read at a glance and then ignored. A house is looked at, it is
 * the building there are most of, and it decides whether a settlement reads as a
 * village or as a row of boxes.
 *
 * Three rules, all of them learned by getting them wrong first:
 *
 * - **No single-apex roof.** A pyramid is the same lozenge whatever it sits on,
 *   so a house, a workshop and a store all read as one object. This roof is two
 *   gables crossing, which gives the house a front, a side and a valley between
 *   them — and that silhouette is most of what the eye actually reads.
 * - **Near the camera is low on screen.** A wall's top edge runs from `(cx, y +
 *   halfH)` at the front corner *up* to `(cx ± halfW, y)` at the side one. An
 *   earlier version had that backwards, which hung every plank and the door off
 *   the face they belonged to.
 * - **Eaves follow the footprint.** A recipe that gave them as two vertical
 *   lines was tried literally: it draws the roof of a screen-space rectangle, and
 *   over a diamond footprint it came out as a slab covering the whole plot with
 *   the walls hidden inside it and its corners hanging in mid-air.
 *
 * And the density rule that keeps it low-poly rather than painterly: at gameplay
 * zoom a house reads from its silhouette, its roof colour, its wall construction
 * and its openings. Everything here earns its place at forty pixels tall — the
 * cross gable, the stone base, the corner posts, the beam ends. Nothing is drawn
 * that only works when zoomed in.
 */

import type Phaser from 'phaser';

import { strip, wallPoint, type Side } from './buildingShapes';
import { occlude, polygon, shade, type Point } from './shading';

/** Boarded timber under ochre thatch, framed in oak, on a stone base. */
export interface HouseLook {
  readonly wallHeight: number;
  readonly roofHeight: number;
  readonly eaves: number;
  readonly plinth: number;
  readonly wall: number;
  readonly roof: number;
  readonly timber: number;
}

/** The house, in the mass and palette that were chosen. */
export const HOUSE_LOOK: HouseLook = {
  wallHeight: 25,
  roofHeight: 34,
  eaves: 6,
  plinth: 8,
  wall: 0x8a6f4c,
  roof: 0x9a8654,
  timber: 0x5d4830,
};

/**
 * The base course. Lighter than the settlement's other footings on purpose — a
 * timber house wants to read as *standing on* stone — but not the near-white it
 * started at, which pulled the eye straight to three bright strips in a row when
 * a row of houses was looked at from gameplay zoom.
 */
const STONE = 0x83806f;
/** The charcoal of an unglazed opening. */
const WINDOW_DARK = 0x2b3138;
/** Where the stack stands and how big it is. */
const CHIMNEY = { alongRidge: 0.42, width: 7.5, height: 15 } as const;
/** Panels between the posts on one wall face. */
const WALL_POSTS: readonly number[] = [0.04, 0.5, 0.96];
/** Where the two windows sit on a face, as a share of it. */
const WINDOWS: readonly number[] = [0.24, 0.74];

export interface HouseOptions {
  readonly cx: number;
  readonly groundY: number;
  /** Half-extents of the *building*, which is smaller than its plot. */
  readonly halfW: number;
  readonly halfH: number;
}

/** How tall the stack is, so the smoke leaves the top of it. */
export const HOUSE_CHIMNEY_HEIGHT = CHIMNEY.height;

/**
 * The four points the roof is built from: two gable apexes and the crossing.
 *
 * Both gables are the same height, so their ridges meet over the middle of the
 * house and the valley between them runs straight down to the near corner. That
 * is the whole shape, and everything else hangs off these.
 */
function roofPoints(options: HouseOptions): {
  apexLeft: Point;
  apexRight: Point;
  crossing: Point;
  backApex: Point;
  topY: number;
} {
  const { cx, groundY, halfW, halfH } = options;
  const topY = groundY - HOUSE_LOOK.plinth - HOUSE_LOOK.wallHeight;
  const ridgeY = topY - HOUSE_LOOK.roofHeight;

  return {
    // Over the midpoint of each visible wall.
    apexLeft: { x: cx - halfW / 2, y: ridgeY + halfH / 2 },
    apexRight: { x: cx + halfW / 2, y: ridgeY + halfH / 2 },
    // Where the two ridges meet, over the middle of the house.
    crossing: { x: cx, y: ridgeY },
    // And over the midpoint of the two hidden walls, for the far silhouette.
    backApex: { x: cx, y: ridgeY - halfH / 2 },
    topY,
  };
}

/** Where the chimney's base sits, relative to the building's anchor. */
export function houseChimneyBase(options: HouseOptions): Point {
  const { crossing, backApex } = roofPoints(options);
  return {
    x: crossing.x + (backApex.x - crossing.x) * CHIMNEY.alongRidge,
    y: crossing.y + (backApex.y - crossing.y) * CHIMNEY.alongRidge,
  };
}

/**
 * Draws the house.
 *
 * Painter's order, and it matters: stone base, walls, framing, the two gable
 * walls, then the roof over them, then the openings. The roof goes on after the
 * gable walls so its barge boards land on their edges, and before the door so
 * its shade falls across the wall the door is cut in.
 */
export function drawOchreBoardedHouse(
  graphics: Phaser.GameObjects.Graphics,
  options: HouseOptions,
): void {
  const look = HOUSE_LOOK;
  const { cx, groundY, halfW, halfH } = options;
  const { apexLeft, apexRight, crossing, backApex, topY } = roofPoints(options);

  const sillY = groundY - look.plinth;
  const topLeft = { x: cx - halfW, y: topY };
  const topFront = { x: cx, y: topY + halfH };
  const topRight = { x: cx + halfW, y: topY };
  const sillLeft = { x: cx - halfW, y: sillY };
  const sillFront = { x: cx, y: sillY + halfH };
  const sillRight = { x: cx + halfW, y: sillY };

  drawStoneBase(graphics, options, sillY);

  graphics.fillStyle(look.wall, 1);
  polygon(graphics, [topLeft, topFront, sillFront, sillLeft]);
  graphics.fillStyle(shade(look.wall, 0.78), 1);
  polygon(graphics, [topFront, topRight, sillRight, sillFront]);

  drawFraming(graphics, options, { sillY, topY });

  // Gloom where the walls meet the stone: the strongest single cue that a
  // building stands in the scene rather than being pasted onto it.
  const gloom = Math.max(2.5, look.wallHeight * 0.14);
  occlude(
    graphics,
    { x: sillLeft.x, y: sillLeft.y - gloom },
    { x: sillFront.x, y: sillFront.y - gloom },
    gloom,
    0.15,
  );
  occlude(
    graphics,
    { x: sillFront.x, y: sillFront.y - gloom },
    { x: sillRight.x, y: sillRight.y - gloom },
    gloom,
    0.19,
  );

  // The roof sequences the two gable walls itself: they stand *in front of* the
  // valley behind them and *behind* the barge boards that cap them, and there is
  // no order in this drawing where that works if they are painted out here.
  drawCrossGableRoof(graphics, options, {
    apexLeft,
    apexRight,
    crossing,
    backApex,
    topY,
    gables: () => {
      graphics.fillStyle(shade(look.wall, 0.94), 1);
      polygon(graphics, [topLeft, apexLeft, topFront]);
      graphics.fillStyle(shade(look.wall, 0.74), 1);
      polygon(graphics, [topFront, apexRight, topRight]);
      drawGableFraming(graphics, { topLeft, topFront, topRight, apexLeft, apexRight });
    },
  });
  drawChimney(graphics, options);

  drawWindows(graphics, options, sillY);
  drawDoor(graphics, options, sillY);
}

/**
 * The stone base, in two courses of large blocks.
 *
 * **Large blocks, not rubble.** A scatter of small masonry marks turns to noise
 * at gameplay zoom and reads as dirt on the wall; a few picked-out stones a side
 * read as stone from across the map. It is deep on purpose — a visible base is
 * what stops a timber house looking like it is resting on the grass.
 */
function drawStoneBase(
  graphics: Phaser.GameObjects.Graphics,
  options: HouseOptions,
  sillY: number,
): void {
  const { cx, groundY, halfW, halfH } = options;
  if (sillY >= groundY) {
    return;
  }

  graphics.fillStyle(STONE, 1);
  polygon(graphics, [
    { x: cx - halfW, y: sillY },
    { x: cx, y: sillY + halfH },
    { x: cx, y: groundY + halfH },
    { x: cx - halfW, y: groundY },
  ]);
  graphics.fillStyle(shade(STONE, 0.76), 1);
  polygon(graphics, [
    { x: cx, y: sillY + halfH },
    { x: cx + halfW, y: sillY },
    { x: cx + halfW, y: groundY },
    { x: cx, y: groundY + halfH },
  ]);

  const depth = groundY - sillY;
  for (const side of [-1, 1] as Side[]) {
    // Two courses, the upper one offset half a block, like coursed masonry.
    for (const [course, blocks] of [
      [0.62, [0.08, 0.36, 0.64, 0.92]],
      [0.2, [0.22, 0.5, 0.78]],
    ] as const) {
      graphics.fillStyle(shade(STONE, side === -1 ? 1.12 : 0.64), 1);
      for (const t of blocks) {
        const a = wallPoint(cx, halfW, halfH, side, t, sillY + depth * (1 - course));
        const b = wallPoint(cx, halfW, halfH, side, t + 0.2, sillY + depth * (1 - course));
        polygon(graphics, [
          a,
          b,
          { x: b.x, y: b.y + depth * 0.3 },
          { x: a.x, y: a.y + depth * 0.3 },
        ]);
      }
    }
  }

  // A lit arris along the top of the base, where the timber sits on it.
  graphics.fillStyle(shade(STONE, 1.24), 1);
  polygon(graphics, [
    { x: cx - halfW, y: sillY },
    { x: cx, y: sillY + halfH },
    { x: cx, y: sillY + halfH + 1.6 },
    { x: cx - halfW, y: sillY + 1.6 },
  ]);
}

/**
 * Corner posts, a mid post, a head beam and boarded panels between them.
 *
 * The frame is what makes this a *timber* house rather than a brown box, and
 * three posts a face is the whole of it. A full cruck frame at this size turns
 * into noise; the panels between the posts carry the boarding.
 */
function drawFraming(
  graphics: Phaser.GameObjects.Graphics,
  options: HouseOptions,
  levels: { sillY: number; topY: number },
): void {
  const { cx, halfW, halfH } = options;
  const look = HOUSE_LOOK;
  const { sillY, topY } = levels;

  for (const side of [-1, 1] as Side[]) {
    const timber = shade(look.timber, side === -1 ? 1.08 : 0.84);
    const board = shade(look.wall, side === -1 ? 0.84 : 0.66);

    // Boarding inside each panel, kept faint: it is texture, not structure.
    for (const t of [0.16, 0.28, 0.62, 0.74, 0.86]) {
      graphics.fillStyle(board, 0.5);
      polygon(
        graphics,
        strip(
          wallPoint(cx, halfW, halfH, side, t, topY),
          wallPoint(cx, halfW, halfH, side, t, sillY),
          1.2,
        ),
      );
    }

    graphics.fillStyle(timber, 1);
    for (const t of WALL_POSTS) {
      polygon(
        graphics,
        strip(
          wallPoint(cx, halfW, halfH, side, t, topY),
          wallPoint(cx, halfW, halfH, side, t, sillY),
          t === 0.5 ? 2.6 : 3.2,
        ),
      );
    }

    // The head beam the roof sits on, and a sill beam on the stone.
    polygon(
      graphics,
      strip(
        wallPoint(cx, halfW, halfH, side, 0.02, topY + 1.4),
        wallPoint(cx, halfW, halfH, side, 0.98, topY + 1.4),
        2.8,
      ),
    );
    graphics.fillStyle(shade(timber, 0.88), 1);
    polygon(
      graphics,
      strip(
        wallPoint(cx, halfW, halfH, side, 0.02, sillY - 1.2),
        wallPoint(cx, halfW, halfH, side, 0.98, sillY - 1.2),
        2.2,
      ),
    );
  }
}

/** Rafters and a tie beam on each gable wall, the way a gable is actually built. */
function drawGableFraming(
  graphics: Phaser.GameObjects.Graphics,
  points: {
    topLeft: Point;
    topFront: Point;
    topRight: Point;
    apexLeft: Point;
    apexRight: Point;
  },
): void {
  const { topLeft, topFront, topRight, apexLeft, apexRight } = points;
  const look = HOUSE_LOOK;

  for (const [a, apex, b, lit] of [
    [topLeft, apexLeft, topFront, true],
    [topFront, apexRight, topRight, false],
  ] as const) {
    graphics.fillStyle(shade(look.timber, lit ? 1.06 : 0.84), 1);
    polygon(graphics, strip(a, apex, 2.6));
    polygon(graphics, strip(apex, b, 2.6));
    // The king post, up the middle from the tie beam to the apex.
    const tie = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    polygon(graphics, strip(apex, tie, 2.2));
  }
}

/**
 * The roof: two gables crossing, and the valley where they meet.
 *
 * The valley runs from the crossing straight down to the corner nearest the
 * camera, which is why this shape reads as a *house* from directly in front of
 * it — there is a line down the middle of the silhouette rather than a flat
 * lozenge.
 */
function drawCrossGableRoof(
  graphics: Phaser.GameObjects.Graphics,
  options: HouseOptions,
  points: {
    apexLeft: Point;
    apexRight: Point;
    crossing: Point;
    backApex: Point;
    topY: number;
    /** The two gable walls, drawn at the one moment the order allows. */
    gables: () => void;
  },
): void {
  const { cx, halfW, halfH } = options;
  const look = HOUSE_LOOK;
  const { apexLeft, apexRight, crossing, backApex, topY } = points;
  const eaves = look.eaves;

  // The eaves oversail each wall along that wall's own outward direction, and
  // the barges oversail each gable along its own. Both must follow the footprint:
  // eaves given as vertical lines draw the roof of a screen-space rectangle, and
  // over a diamond that is a slab covering the plot with its corners in mid-air.
  const outLeft = (p: Point): Point => ({ x: p.x - eaves, y: p.y + eaves / 2 });
  const outRight = (p: Point): Point => ({ x: p.x + eaves, y: p.y + eaves / 2 });

  const eaveLeft = outLeft({ x: cx - halfW, y: topY });
  const eaveRight = outRight({ x: cx + halfW, y: topY });
  const eaveBack = { x: cx, y: topY - halfH - eaves / 2 };
  const bargeLeft = outLeft(apexLeft);
  const bargeRight = outRight(apexRight);

  // **Two slopes, each running the whole way round from a gable to the back.**
  // The ridge each one hangs from is the line gable → crossing → back, so the
  // slope is a pentagon rather than a triangle, and the crossing is the only
  // place the two of them touch. That bend in the ridge is the cross gable.
  graphics.fillStyle(look.roof, 1);
  polygon(graphics, [bargeLeft, crossing, backApex, eaveBack, eaveLeft]);
  graphics.fillStyle(shade(look.roof, 0.76), 1);
  polygon(graphics, [bargeRight, crossing, backApex, eaveBack, eaveRight]);

  // Courses following each pitch. Three a side and no more: a fourth is noise
  // that costs the low-poly look and buys nothing at forty pixels tall.
  for (const t of [0.3, 0.56, 0.82]) {
    const along = (from: Point, to: Point): Point => ({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
    graphics.fillStyle(shade(look.roof, 0.86), 0.5);
    for (const [ridgeA, ridgeB, eaveA, eaveB] of [
      [bargeLeft, crossing, eaveLeft, eaveBack],
      [bargeRight, crossing, eaveRight, eaveBack],
    ] as const) {
      const a = along(ridgeA, eaveA);
      const b = along(ridgeB, eaveB);
      polygon(graphics, [a, b, { x: b.x, y: b.y + 1.5 }, { x: a.x, y: a.y + 1.5 }]);
    }
  }

  // The sawn edge under each eave, which is what gives the roof thickness.
  graphics.fillStyle(shade(look.roof, 0.5), 1);
  for (const [a, b] of [
    [eaveLeft, eaveBack],
    [eaveRight, eaveBack],
  ] as const) {
    polygon(graphics, [a, b, { x: b.x, y: b.y + 3 }, { x: a.x, y: a.y + 3 }]);
  }

  // **The valley.** Where two gables cross there are two more surfaces, falling
  // from each ridge into the line that runs from the crossing straight down to
  // the corner nearest the camera. Leaving them out is what put a hole through
  // the middle of the roof the first time this was drawn.
  const frontEave = { x: cx, y: topY + halfH + eaves / 2 };
  graphics.fillStyle(shade(look.roof, 0.94), 1);
  polygon(graphics, [apexLeft, crossing, frontEave]);
  graphics.fillStyle(shade(look.roof, 0.72), 1);
  polygon(graphics, [apexRight, crossing, frontEave]);
  graphics.fillStyle(shade(look.roof, 0.46), 1);
  polygon(graphics, strip(crossing, frontEave, 2));

  // The ridges, running from each gable up to the crossing and on to the back.
  graphics.fillStyle(shade(look.roof, 1.2), 1);
  polygon(graphics, strip(bargeLeft, crossing, 2.4));
  polygon(graphics, strip(bargeRight, crossing, 2.4));
  polygon(graphics, strip(crossing, backApex, 2.2));

  // The gable walls, now that everything behind them is down.
  points.gables();

  // **The barge boards**: the roof's own edge, running down each gable's rakes
  // and oversailing the wall below. Drawn last on this side so they sit over the
  // gable wall rather than under it, which is how a barge board actually works.
  const bargeFront = frontEave;
  graphics.fillStyle(shade(look.roof, 0.92), 1);
  polygon(graphics, [bargeLeft, bargeFront, { x: cx, y: topY + halfH }, apexLeft]);
  graphics.fillStyle(shade(look.roof, 0.7), 1);
  polygon(graphics, [bargeRight, bargeFront, { x: cx, y: topY + halfH }, apexRight]);
  graphics.fillStyle(shade(look.roof, 1.06), 1);
  polygon(graphics, [bargeLeft, eaveLeft, { x: cx - halfW, y: topY }, apexLeft]);
  graphics.fillStyle(shade(look.roof, 0.84), 1);
  polygon(graphics, [bargeRight, eaveRight, { x: cx + halfW, y: topY }, apexRight]);

  // **Beam ends.** The rafters carry past the barge and are cut off square, and
  // those blocks are most of what makes a roof look built rather than folded.
  graphics.fillStyle(shade(look.timber, 1.1), 1);
  for (const p of [bargeLeft, eaveLeft]) {
    beamEnd(graphics, p, -1);
  }
  graphics.fillStyle(shade(look.timber, 0.86), 1);
  for (const p of [bargeRight, eaveRight]) {
    beamEnd(graphics, p, 1);
  }
}

/** One squared-off rafter end, poking out of the roof's edge. */
function beamEnd(graphics: Phaser.GameObjects.Graphics, at: Point, side: Side): void {
  const w = 4.2;
  const h = 3.4;
  polygon(graphics, [
    { x: at.x - (side * w) / 2, y: at.y - h / 2 },
    { x: at.x + (side * w) / 2, y: at.y - h / 2 + h * 0.45 },
    { x: at.x + (side * w) / 2, y: at.y + h / 2 + h * 0.45 },
    { x: at.x - (side * w) / 2, y: at.y + h / 2 },
  ]);
}

/** Two windows a face, framed, with a cross mullion. Glass was for churches. */
function drawWindows(
  graphics: Phaser.GameObjects.Graphics,
  options: HouseOptions,
  sillY: number,
): void {
  const { cx, halfW, halfH } = options;
  const look = HOUSE_LOOK;
  const head = look.wallHeight * 0.78;
  const foot = look.wallHeight * 0.3;

  for (const side of [-1, 1] as Side[]) {
    for (const centre of WINDOWS) {
      // The left face gives one of its two bays to the door.
      if (side === -1 && centre === WINDOWS[0]) {
        continue;
      }
      const t0 = centre - 0.09;
      const t1 = centre + 0.09;
      const at = (t: number, lift: number): Point => {
        const p = wallPoint(cx, halfW, halfH, side, t, sillY);
        return { x: p.x, y: p.y - lift };
      };

      graphics.fillStyle(shade(look.timber, side === -1 ? 1.24 : 0.98), 1);
      polygon(graphics, [
        at(t0 - 0.03, head + 2),
        at(t1 + 0.03, head + 2),
        at(t1 + 0.03, foot - 2),
        at(t0 - 0.03, foot - 2),
      ]);

      graphics.fillStyle(WINDOW_DARK, 1);
      polygon(graphics, [at(t0, head), at(t1, head), at(t1, foot), at(t0, foot)]);

      // One upright and one cross bar: four panes, which is what a cottage got.
      graphics.fillStyle(shade(look.timber, side === -1 ? 1.24 : 0.98), 1);
      polygon(graphics, strip(at((t0 + t1) / 2, head), at((t0 + t1) / 2, foot), 1.3));
      polygon(graphics, strip(at(t0, (head + foot) / 2), at(t1, (head + foot) / 2), 1.3));

      // The reveal along the head, in shadow: the wall's own thickness.
      graphics.fillStyle(0x000000, 0.34);
      polygon(graphics, [at(t0, head), at(t1, head), at(t1, head - 2), at(t0, head - 2)]);
    }
  }
}

/** A plank door under the left gable, with a stone step up to it. */
function drawDoor(
  graphics: Phaser.GameObjects.Graphics,
  options: HouseOptions,
  sillY: number,
): void {
  const { cx, groundY, halfW, halfH } = options;
  const look = HOUSE_LOOK;
  const height = look.wallHeight * 0.82;
  const t0 = 0.16;
  const t1 = 0.34;

  const at = (t: number, lift: number): Point => {
    const p = wallPoint(cx, halfW, halfH, -1, t, sillY);
    return { x: p.x, y: p.y - lift };
  };

  // The opening, cut through the stone base to the ground.
  graphics.fillStyle(shade(look.timber, 0.6), 1);
  polygon(graphics, [
    at(t0 - 0.03, height + 2),
    at(t1 + 0.03, height + 2),
    at(t1 + 0.03, -look.plinth),
    at(t0 - 0.03, -look.plinth),
  ]);

  const leaf = shade(look.timber, 1.18);
  graphics.fillStyle(leaf, 1);
  polygon(graphics, [
    at(t0, height),
    at(t1, height),
    at(t1, -look.plinth + 1),
    at(t0, -look.plinth + 1),
  ]);

  graphics.fillStyle(shade(leaf, 0.7), 1);
  for (const t of [t0 + 0.06, t0 + 0.12]) {
    polygon(graphics, strip(at(t, height - 1), at(t, -look.plinth + 1), 1.1));
  }
  // Two iron straps and a latch.
  for (const lift of [height * 0.74, height * 0.28]) {
    polygon(graphics, strip(at(t0, lift), at(t1, lift), 1.8));
  }
  graphics.fillStyle(0x211c17, 1);
  polygon(graphics, strip(at(t1 - 0.03, height * 0.5), at(t1 - 0.01, height * 0.5), 2.6));

  // The head of the opening, in shadow.
  graphics.fillStyle(0x000000, 0.36);
  polygon(graphics, [at(t0, height), at(t1, height), at(t1, height - 2.2), at(t0, height - 2.2)]);

  // Two shallow stone slabs, worn into the ground at the threshold.
  const outward = (p: Point, by: number): Point => ({ x: p.x - by, y: p.y + by / 2 });
  for (const [step, reach] of [
    [0, 3.5],
    [1, 7],
  ] as const) {
    const lift = -look.plinth + 2.5 - step * 2.5;
    const a = outward(at(t0 - 0.02, lift), reach);
    const b = outward(at(t1 + 0.02, lift), reach);
    graphics.fillStyle(shade(STONE, step === 0 ? 1.16 : 1.04), 1);
    polygon(graphics, [at(t0 - 0.02, lift), at(t1 + 0.02, lift), b, a]);
    graphics.fillStyle(shade(STONE, 0.72), 1);
    polygon(graphics, [a, b, { x: b.x, y: b.y + 2.4 }, { x: a.x, y: a.y + 2.4 }]);
  }
  void groundY;
}

/**
 * The stack: a stone prism standing on the ridge, with a cap.
 *
 * On the ridge rather than out on a pitch. A stack on a slope reads as a post
 * leaning against the house, and one on the hip — the silhouette edge — reads as
 * hanging in the air beside it, which is exactly how the first one was reported.
 */
function drawChimney(graphics: Phaser.GameObjects.Graphics, options: HouseOptions): void {
  const base = houseChimneyBase(options);
  const half = CHIMNEY.width / 2;
  const headY = base.y - CHIMNEY.height;
  const footY = base.y + 5;

  graphics.fillStyle(shade(STONE, 1.1), 1);
  polygon(graphics, [
    { x: base.x - half, y: headY },
    { x: base.x, y: headY + half / 2 },
    { x: base.x, y: footY + half / 2 },
    { x: base.x - half, y: footY },
  ]);
  graphics.fillStyle(shade(STONE, 0.74), 1);
  polygon(graphics, [
    { x: base.x, y: headY + half / 2 },
    { x: base.x + half, y: headY },
    { x: base.x + half, y: footY },
    { x: base.x, y: footY + half / 2 },
  ]);

  // The cap oversails, which is what stops a chimney reading as a grey post.
  const cap = half + 2;
  graphics.fillStyle(shade(STONE, 1.3), 1);
  polygon(graphics, [
    { x: base.x - cap, y: headY },
    { x: base.x, y: headY - cap / 2 },
    { x: base.x + cap, y: headY },
    { x: base.x, y: headY + cap / 2 },
  ]);
  graphics.fillStyle(shade(STONE, 0.86), 1);
  polygon(graphics, [
    { x: base.x - cap, y: headY },
    { x: base.x, y: headY + cap / 2 },
    { x: base.x, y: headY + cap / 2 + 2 },
    { x: base.x - cap, y: headY + 2 },
  ]);
  polygon(graphics, [
    { x: base.x, y: headY + cap / 2 },
    { x: base.x + cap, y: headY },
    { x: base.x + cap, y: headY + 2 },
    { x: base.x, y: headY + cap / 2 + 2 },
  ]);
}
