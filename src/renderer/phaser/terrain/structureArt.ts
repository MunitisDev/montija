/**
 * Every roofed building in the settlement, built the way the house is built.
 *
 * The house was drawn twice: once through the generic machinery — a box under a
 * pyramid — and once properly, as a cross-gabled cottage timber-framed on a
 * stone base. Only the second one reads as a building. This module is that
 * second construction generalised, so a Woodcutter, a Granary and a Temple are
 * each *built* rather than tinted differently.
 *
 * Three rules, all of them learned by getting them wrong on the house first:
 *
 * - **No single-apex roof.** Four planes meeting at a point is the same lozenge
 *   whatever it stands on, so every building drawn with one reads as the same
 *   object. Every roof here hangs from a ridge *segment*, and which way that
 *   ridge runs is most of what tells two buildings apart at gameplay zoom.
 * - **Near the camera is low on screen.** A wall's top edge runs from
 *   `(cx, y + halfH)` at the front corner *up* to `(cx ± halfW, y)` at the side
 *   one. Getting that backwards hangs every post, plank and door off the face it
 *   belongs to, and it looks like the building has gone see-through.
 * - **Eaves follow the footprint.** They oversail along the wall's own outward
 *   direction. Given as vertical lines they draw the roof of a screen-space
 *   rectangle, and over a diamond that is a slab covering the plot with its
 *   corners hanging in mid-air.
 *
 * And the density rule that keeps this low-poly rather than painterly: at
 * gameplay zoom a building reads from its silhouette, its roof colour, its wall
 * construction and its openings. Everything here earns its place at forty pixels
 * tall. Nothing is drawn that only works zoomed in.
 *
 * Renderer-only: these run once at startup to fill a texture, never per frame.
 */

import type Phaser from 'phaser';

import { strip, wallPoint, type Side } from './buildingShapes';
import { occlude, polygon, shade, type Point } from './shading';

/**
 * Which way the roof is framed.
 *
 * - `cross` — two gables crossing, with a valley running down to the near
 *   corner. The richest silhouette and the most expensive; for the buildings
 *   people look at.
 * - `gable` — one ridge, with the gable end facing the near-right wall.
 * - `gable-left` — the same, mirrored: the gable end faces the near-left wall,
 *   which is the wall the door is in.
 *
 * Two neighbours with different forms read as two buildings even before their
 * colours are compared, which is the whole reason there is more than one.
 */
export type RoofForm = 'cross' | 'gable' | 'gable-left';

/** What the walls are made of, which is the second thing the eye reads. */
export type WallBuild = 'boarded' | 'framed' | 'log' | 'stone';

/** And what the roof is covered with. */
export type RoofCover = 'shingle' | 'thatch' | 'slate';

/** Everything that decides how one building is put together. */
export interface StructureLook {
  /** Height of the timber wall, above any stone base. */
  readonly wallHeight: number;
  /** Height of the ridge above the wall top. */
  readonly roofHeight: number;
  /** How far the roof oversails, in pixels. */
  readonly eaves: number;
  /** Depth of the stone base under the wall. `0` for none. */
  readonly plinth: number;
  readonly wall: number;
  readonly roof: number;
  readonly timber: number;
  readonly stone: number;
  readonly form: RoofForm;
  readonly build: WallBuild;
  readonly cover: RoofCover;
  /** Openings per visible face. The door takes one of the left face's bays. */
  readonly windows: number;
  /** A door in the near-left wall. */
  readonly door: boolean;
  /** A stack on the ridge, and so smoke. */
  readonly chimney: boolean;
  /**
   * An open lean-to along the near-left wall, this many pixels deep.
   *
   * A work bay: a roof on two posts with nothing under it but the ground and
   * whatever the trade leaves lying there. It is the cheapest thing that says
   * "work happens here" rather than "people live here", and it changes the
   * silhouette, which matters more than anything painted on a wall.
   */
  readonly aisle: number;
}

export interface StructureOptions {
  readonly cx: number;
  readonly groundY: number;
  /** Half-extents of the *building*, which is smaller than its plot. */
  readonly halfW: number;
  readonly halfH: number;
}

/** Where the stack stands along the ridge, and how big it is. */
const CHIMNEY = { alongRidge: 0.42, width: 7.5, height: 11.5 } as const;

/** How tall the stack is, so smoke leaves the top of it rather than the roof. */
export const STRUCTURE_CHIMNEY_HEIGHT = CHIMNEY.height;

/** The charcoal of an unglazed opening. */
const WINDOW_DARK = 0x2b3138;

/** Panels between the posts on one wall face. */
const WALL_POSTS: readonly number[] = [0.04, 0.5, 0.96];

/** Where windows sit on a face, as a share of it. */
const WINDOWS: readonly number[] = [0.24, 0.74];

/* ------------------------------------------------------------------------- */
/* Roof frames                                                                */
/* ------------------------------------------------------------------------- */

/**
 * The four points a cross-gabled roof is built from.
 *
 * Both gables are the same height, so their ridges meet over the middle of the
 * building and the valley between them runs straight down to the near corner.
 */
interface CrossFrame {
  readonly apexLeft: Point;
  readonly apexRight: Point;
  readonly crossing: Point;
  readonly backApex: Point;
  readonly topY: number;
}

function crossFrame(look: StructureLook, options: StructureOptions): CrossFrame {
  const { cx, groundY, halfW, halfH } = options;
  const topY = groundY - look.plinth - look.wallHeight;
  const ridgeY = topY - look.roofHeight;

  return {
    apexLeft: { x: cx - halfW / 2, y: ridgeY + halfH / 2 },
    apexRight: { x: cx + halfW / 2, y: ridgeY + halfH / 2 },
    crossing: { x: cx, y: ridgeY },
    backApex: { x: cx, y: ridgeY - halfH / 2 },
    topY,
  };
}

/**
 * The frame for a single-ridge gable roof.
 *
 * `facing` is which of the two visible walls the gable end stands over: `1` the
 * near-right, `-1` the near-left. Everything else follows from it, which is what
 * makes the mirrored form free.
 *
 * `gA`/`gB` are the corners of the gable-end wall and `hA`/`hB` the corners of
 * the hidden one behind it; the near slope falls to the wall between `hA` and
 * `gB` and the far slope to the wall between `hB` and `gA`.
 */
interface GableFrame {
  readonly facing: Side;
  readonly ridgeFront: Point;
  readonly ridgeBack: Point;
  readonly gA: Point;
  readonly gB: Point;
  readonly hA: Point;
  readonly hB: Point;
  readonly topY: number;
}

function gableFrame(look: StructureLook, options: StructureOptions, facing: Side): GableFrame {
  const { cx, groundY, halfW, halfH } = options;
  const topY = groundY - look.plinth - look.wallHeight;
  const ridgeY = topY - look.roofHeight;

  return {
    facing,
    // Over the midpoint of the gable-end wall, and of the one behind it.
    ridgeFront: { x: cx + (facing * halfW) / 2, y: ridgeY + halfH / 2 },
    ridgeBack: { x: cx - (facing * halfW) / 2, y: ridgeY - halfH / 2 },
    gA: { x: cx + facing * halfW, y: topY },
    gB: { x: cx, y: topY + halfH },
    hA: { x: cx - facing * halfW, y: topY },
    hB: { x: cx, y: topY - halfH },
    topY,
  };
}

/** Where the chimney's base sits, relative to the building's anchor. */
export function structureChimneyBase(look: StructureLook, options: StructureOptions): Point {
  if (look.form === 'cross') {
    const { crossing, backApex } = crossFrame(look, options);
    return {
      x: crossing.x + (backApex.x - crossing.x) * CHIMNEY.alongRidge,
      y: crossing.y + (backApex.y - crossing.y) * CHIMNEY.alongRidge,
    };
  }

  // Along the ridge from the near gable toward the far one, so the stack stands
  // *on* the roof with tiles on every side of it rather than on the silhouette
  // edge, where it reads as hanging in the air beside the building.
  const { ridgeFront, ridgeBack } = gableFrame(look, options, look.form === 'gable-left' ? -1 : 1);
  return {
    x: ridgeFront.x + (ridgeBack.x - ridgeFront.x) * 0.36,
    y: ridgeFront.y + (ridgeBack.y - ridgeFront.y) * 0.36,
  };
}

/* ------------------------------------------------------------------------- */
/* The building                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Draws one building.
 *
 * Painter's order, and it matters: stone base, walls, framing, then the roof —
 * which sequences its own gable walls, because they stand in front of the far
 * slope and behind the barge boards that cap them, and there is no order out
 * here where that works. Openings go on last so the roof's shade falls across
 * the wall they are cut in.
 */
export function drawStructure(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
): void {
  const { cx, groundY, halfW, halfH } = options;
  const sillY = groundY - look.plinth;
  const topY = sillY - look.wallHeight;

  const topLeft = { x: cx - halfW, y: topY };
  const topFront = { x: cx, y: topY + halfH };
  const topRight = { x: cx + halfW, y: topY };
  const sillLeft = { x: cx - halfW, y: sillY };
  const sillFront = { x: cx, y: sillY + halfH };
  const sillRight = { x: cx + halfW, y: sillY };

  drawStoneBase(graphics, look, options, sillY);

  graphics.fillStyle(look.wall, 1);
  polygon(graphics, [topLeft, topFront, sillFront, sillLeft]);
  graphics.fillStyle(shade(look.wall, 0.78), 1);
  polygon(graphics, [topFront, topRight, sillRight, sillFront]);

  drawWallBuild(graphics, look, options, { sillY, topY });

  // Gloom where the walls meet the ground: the strongest single cue that a
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

  if (look.form === 'cross') {
    drawCrossRoof(graphics, look, options, crossFrame(look, options), {
      topLeft,
      topFront,
      topRight,
    });
  } else {
    drawGableRoof(graphics, look, gableFrame(look, options, look.form === 'gable-left' ? -1 : 1));
  }

  if (look.chimney) {
    drawChimney(graphics, look, structureChimneyBase(look, options));
  }

  drawWindows(graphics, look, options, sillY);
  if (look.door) {
    drawDoor(graphics, look, options, sillY);
  }
  // A lean-to hangs off an eaves wall, never off a gable end: on `gable-left`
  // the near-left wall *is* the gable, and a bay under it buries the barge
  // boards and the door together.
  if (look.aisle > 0 && look.form === 'gable') {
    drawAisle(graphics, look, options, { topY });
  }
}

/* ------------------------------------------------------------------------- */
/* Walls                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * The stone base, drawn as joints rather than as tiles.
 *
 * **Joints, not tiles.** The first version drew each stone as a pale quad from
 * `t` to `t + 0.2`, which runs off the corner for any block near the end of a
 * course and whose lower row reached below the ground line. It also read as
 * loose tiles stuck on the wall rather than as a wall built of stone, because
 * pale shapes with gaps between them are what a tile is.
 *
 * Drawing the *mortar* instead fixes both at once: beds run the whole course and
 * perpends are cut by them, so nothing can leave the face by construction, and
 * the eye reads a continuous wall with courses in it.
 */
function drawStoneBase(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  sillY: number,
): void {
  const { cx, groundY, halfW, halfH } = options;
  if (sillY >= groundY) {
    return;
  }

  graphics.fillStyle(look.stone, 1);
  polygon(graphics, [
    { x: cx - halfW, y: sillY },
    { x: cx, y: sillY + halfH },
    { x: cx, y: groundY + halfH },
    { x: cx - halfW, y: groundY },
  ]);
  graphics.fillStyle(shade(look.stone, 0.76), 1);
  polygon(graphics, [
    { x: cx, y: sillY + halfH },
    { x: cx + halfW, y: sillY },
    { x: cx + halfW, y: groundY },
    { x: cx, y: groundY + halfH },
  ]);

  coursedStone(graphics, look.stone, options, sillY, groundY);

  // A lit arris along the top of the base, where the timber sits on it.
  graphics.fillStyle(shade(look.stone, 1.24), 1);
  polygon(graphics, [
    { x: cx - halfW, y: sillY },
    { x: cx, y: sillY + halfH },
    { x: cx, y: sillY + halfH + 1.6 },
    { x: cx - halfW, y: sillY + 1.6 },
  ]);
}

/** Beds, perpends and one picked-out block, between two heights on both faces. */
function coursedStone(
  graphics: Phaser.GameObjects.Graphics,
  colour: number,
  options: StructureOptions,
  topY: number,
  bottomY: number,
): void {
  const { cx, halfW, halfH } = options;
  const depth = bottomY - topY;
  // One course per eight pixels, between two and five: fewer and it is a slab,
  // more and it is noise at the size this is actually looked at.
  const courses = Math.max(2, Math.min(5, Math.round(depth / 8)));
  const perpends = [
    [0.32, 0.66],
    [0.18, 0.5, 0.82],
  ] as const;

  for (const side of [-1, 1] as Side[]) {
    const at = (t: number, y: number): Point => wallPoint(cx, halfW, halfH, side, t, y);
    const mortar = shade(colour, side === -1 ? 0.74 : 0.58);

    // One block picked out per face, bounded by the joints around it so it can
    // never overhang: enough to say the stones are not all the same.
    graphics.fillStyle(shade(colour, side === -1 ? 1.14 : 0.7), 1);
    const blockTop = topY + (depth * 1) / courses;
    const blockBottom = topY + (depth * 2) / courses;
    polygon(graphics, [
      at(0.18, blockTop),
      at(0.5, blockTop),
      at(0.5, blockBottom),
      at(0.18, blockBottom),
    ]);

    graphics.fillStyle(mortar, 1);
    for (let bed = 1; bed < courses; bed += 1) {
      const y = topY + (depth * bed) / courses;
      polygon(graphics, strip(at(0.01, y), at(0.99, y), 1.2));
    }
    for (let band = 0; band < courses; band += 1) {
      const top = topY + (depth * band) / courses;
      const bottom = topY + (depth * (band + 1)) / courses;
      for (const t of perpends[band % perpends.length]!) {
        polygon(graphics, strip(at(t, top), at(t, bottom), 1.2));
      }
    }
  }
}

/** The construction of the walls themselves, which is half of a building's identity. */
function drawWallBuild(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  levels: { sillY: number; topY: number },
): void {
  switch (look.build) {
    case 'boarded':
      drawBoardedWalls(graphics, look, options, levels);
      return;
    case 'framed':
      drawFramedWalls(graphics, look, options, levels);
      return;
    case 'log':
      drawLogWalls(graphics, look, options, levels);
      return;
    case 'stone':
      drawStoneWalls(graphics, look, options, levels);
      return;
  }
}

/**
 * Corner posts, a mid post, a head beam and boarded panels between them.
 *
 * Three posts a face is the whole frame. A full cruck frame at this size turns
 * into noise; the panels between the posts carry the boarding.
 */
function drawBoardedWalls(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  levels: { sillY: number; topY: number },
): void {
  const { cx, halfW, halfH } = options;
  const { sillY, topY } = levels;

  for (const side of [-1, 1] as Side[]) {
    const timber = shade(look.timber, side === -1 ? 1.08 : 0.84);
    const board = shade(look.wall, side === -1 ? 0.84 : 0.66);
    const at = (t: number, y: number): Point => wallPoint(cx, halfW, halfH, side, t, y);

    // Boarding inside each panel, kept faint: it is texture, not structure.
    for (const t of [0.16, 0.28, 0.62, 0.74, 0.86]) {
      graphics.fillStyle(board, 0.5);
      polygon(graphics, strip(at(t, topY), at(t, sillY), 1.2));
    }

    graphics.fillStyle(timber, 1);
    for (const t of WALL_POSTS) {
      polygon(graphics, strip(at(t, topY), at(t, sillY), t === 0.5 ? 2.6 : 3.2));
    }

    // The head beam the roof sits on, and a sill beam on the stone.
    polygon(graphics, strip(at(0.02, topY + 1.4), at(0.98, topY + 1.4), 2.8));
    graphics.fillStyle(shade(timber, 0.88), 1);
    polygon(graphics, strip(at(0.02, sillY - 1.2), at(0.98, sillY - 1.2), 2.2));
  }
}

/**
 * Half-timbering: pale daub panels inside a dark frame, braced.
 *
 * The braces are what tell this from boarding at a distance — a diagonal is the
 * only line in the whole building that is neither upright nor along a course, so
 * the eye finds it immediately.
 */
function drawFramedWalls(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  levels: { sillY: number; topY: number },
): void {
  const { cx, halfW, halfH } = options;
  const { sillY, topY } = levels;
  const rail = sillY - (sillY - topY) * 0.52;

  for (const side of [-1, 1] as Side[]) {
    const timber = shade(look.timber, side === -1 ? 1.1 : 0.86);
    const at = (t: number, y: number): Point => wallPoint(cx, halfW, halfH, side, t, y);

    graphics.fillStyle(timber, 1);
    // Posts.
    for (const t of WALL_POSTS) {
      polygon(graphics, strip(at(t, topY), at(t, sillY), t === 0.5 ? 2.8 : 3.4));
    }
    // The mid rail, and the head and sill beams.
    polygon(graphics, strip(at(0.02, rail), at(0.98, rail), 2.4));
    polygon(graphics, strip(at(0.02, topY + 1.4), at(0.98, topY + 1.4), 3));
    graphics.fillStyle(shade(timber, 0.88), 1);
    polygon(graphics, strip(at(0.02, sillY - 1.4), at(0.98, sillY - 1.4), 2.6));

    // A brace in the lower half of each bay, rising toward the corner post.
    graphics.fillStyle(timber, 1);
    for (const [from, to] of [
      [0.46, 0.08],
      [0.54, 0.92],
    ] as const) {
      polygon(graphics, strip(at(from, sillY - 1), at(to, rail + 1), 2.2));
    }
  }
}

/**
 * Horizontal logs, with the ends crossing at the corner.
 *
 * A woodland cabin: the cheapest wall in the settlement and the one that says so.
 * The crossed ends at the near corner are the whole trick — without them stacked
 * courses read as clapboard.
 */
function drawLogWalls(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  levels: { sillY: number; topY: number },
): void {
  const { cx, halfW, halfH } = options;
  const { sillY, topY } = levels;
  const span = sillY - topY;
  const courses = Math.max(3, Math.round(span / 6));

  for (const side of [-1, 1] as Side[]) {
    const at = (t: number, y: number): Point => wallPoint(cx, halfW, halfH, side, t, y);
    const log = shade(look.wall, side === -1 ? 1.04 : 0.76);
    const groove = shade(look.wall, side === -1 ? 0.68 : 0.5);

    for (let course = 1; course < courses; course += 1) {
      const y = topY + (span * course) / courses;
      graphics.fillStyle(groove, 1);
      polygon(graphics, strip(at(0.01, y), at(0.99, y), 1.6));
      graphics.fillStyle(log, 0.55);
      polygon(graphics, strip(at(0.01, y + 1.6), at(0.99, y + 1.6), 1.4));
    }

    // The log ends, crossing past the corner post.
    graphics.fillStyle(shade(look.timber, side === -1 ? 1.12 : 0.88), 1);
    for (let course = 0; course < courses; course += 2) {
      const y = topY + (span * (course + 0.5)) / courses;
      polygon(graphics, strip(at(0.0, y), at(0.07, y), 3.2));
    }
  }
}

/** Masonry the whole way up: for the buildings that are meant to outlast people. */
function drawStoneWalls(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  levels: { sillY: number; topY: number },
): void {
  const { cx, halfW, halfH } = options;
  const { sillY, topY } = levels;

  coursedStone(graphics, look.wall, options, topY, sillY);

  // Dressed quoins up the near corner, which is what separates a built wall
  // from a heap: alternating long and short blocks, picked out lighter.
  const courses = 5;
  for (const side of [-1, 1] as Side[]) {
    const at = (t: number, y: number): Point => wallPoint(cx, halfW, halfH, side, t, y);
    graphics.fillStyle(shade(look.wall, side === -1 ? 1.16 : 0.86), 1);
    for (let course = 0; course < courses; course += 1) {
      if (course % 2 === (side === -1 ? 0 : 1)) {
        continue;
      }
      const top = topY + ((sillY - topY) * course) / courses;
      const bottom = topY + ((sillY - topY) * (course + 1)) / courses;
      polygon(graphics, [at(0.01, top), at(0.11, top), at(0.11, bottom), at(0.01, bottom)]);
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Roofs                                                                      */
/* ------------------------------------------------------------------------- */

/** How thick a cover reads at the eaves, and how much its courses show. */
function coverStyle(cover: RoofCover): {
  fascia: number;
  courses: readonly number[];
  lift: number;
} {
  switch (cover) {
    case 'thatch':
      // Thatch is laid deep and rounded: a fat sawn edge and soft courses.
      return { fascia: 5, courses: [0.24, 0.46, 0.68, 0.88], lift: 2.4 };
    case 'slate':
      // Slate is thin, and lies in more courses than anything else.
      return { fascia: 2, courses: [0.22, 0.4, 0.58, 0.76, 0.92], lift: 1.2 };
    case 'shingle':
      return { fascia: 3, courses: [0.3, 0.56, 0.82], lift: 1.5 };
  }
}

/** One band across a slope, at `t` of the way from ridge to eave. */
function roofCourse(
  graphics: Phaser.GameObjects.Graphics,
  ridgeA: Point,
  ridgeB: Point,
  eaveA: Point,
  eaveB: Point,
  t: number,
  thickness: number,
): void {
  const a = { x: ridgeA.x + (eaveA.x - ridgeA.x) * t, y: ridgeA.y + (eaveA.y - ridgeA.y) * t };
  const b = { x: ridgeB.x + (eaveB.x - ridgeB.x) * t, y: ridgeB.y + (eaveB.y - ridgeB.y) * t };
  polygon(graphics, [a, b, { x: b.x, y: b.y + thickness }, { x: a.x, y: a.y + thickness }]);
}

/**
 * The cross-gabled roof: two gables meeting over the middle.
 *
 * The valley where they cross is what gives this shape a line down the centre of
 * its silhouette rather than a flat lozenge, and leaving those two planes out is
 * what put a hole through the middle of the roof the first time it was drawn.
 *
 * It sequences the gable walls itself: they stand in front of the valley behind
 * them and behind the barge boards that cap them, and there is no order outside
 * this function where that works.
 */
function drawCrossRoof(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  frame: CrossFrame,
  walls: { topLeft: Point; topFront: Point; topRight: Point },
): void {
  const { cx, halfW, halfH } = options;
  const { apexLeft, apexRight, crossing, backApex, topY } = frame;
  const eaves = look.eaves;
  const style = coverStyle(look.cover);

  const outLeft = (p: Point): Point => ({ x: p.x - eaves, y: p.y + eaves / 2 });
  const outRight = (p: Point): Point => ({ x: p.x + eaves, y: p.y + eaves / 2 });

  const eaveLeft = outLeft({ x: cx - halfW, y: topY });
  const eaveRight = outRight({ x: cx + halfW, y: topY });
  const eaveBack = { x: cx, y: topY - halfH - eaves / 2 };
  const bargeLeft = outLeft(apexLeft);
  const bargeRight = outRight(apexRight);

  // Two slopes, each running the whole way round from a gable to the back. The
  // ridge each hangs from bends at the crossing, so the slope is a pentagon.
  graphics.fillStyle(look.roof, 1);
  polygon(graphics, [bargeLeft, crossing, backApex, eaveBack, eaveLeft]);
  graphics.fillStyle(shade(look.roof, 0.76), 1);
  polygon(graphics, [bargeRight, crossing, backApex, eaveBack, eaveRight]);

  for (const t of style.courses) {
    graphics.fillStyle(shade(look.roof, 0.86), 0.5);
    roofCourse(graphics, bargeLeft, crossing, eaveLeft, eaveBack, t, style.lift);
    graphics.fillStyle(shade(look.roof, 0.7), 0.5);
    roofCourse(graphics, bargeRight, crossing, eaveRight, eaveBack, t, style.lift);
  }

  // The sawn edge under each eave, which is what gives the roof thickness.
  graphics.fillStyle(shade(look.roof, 0.5), 1);
  for (const [a, b] of [
    [eaveLeft, eaveBack],
    [eaveRight, eaveBack],
  ] as const) {
    polygon(graphics, [a, b, { x: b.x, y: b.y + style.fascia }, { x: a.x, y: a.y + style.fascia }]);
  }

  // The valley: two more surfaces falling from each ridge into the line that
  // runs from the crossing straight down to the corner nearest the camera.
  const frontEave = { x: cx, y: topY + halfH + eaves / 2 };
  graphics.fillStyle(shade(look.roof, 0.94), 1);
  polygon(graphics, [apexLeft, crossing, frontEave]);
  graphics.fillStyle(shade(look.roof, 0.72), 1);
  polygon(graphics, [apexRight, crossing, frontEave]);
  graphics.fillStyle(shade(look.roof, 0.46), 1);
  polygon(graphics, strip(crossing, frontEave, 2));

  graphics.fillStyle(shade(look.roof, 1.2), 1);
  polygon(graphics, strip(bargeLeft, crossing, 2.4));
  polygon(graphics, strip(bargeRight, crossing, 2.4));
  polygon(graphics, strip(crossing, backApex, 2.2));

  // The gable walls, now that everything behind them is down.
  graphics.fillStyle(shade(look.wall, 0.94), 1);
  polygon(graphics, [walls.topLeft, apexLeft, walls.topFront]);
  graphics.fillStyle(shade(look.wall, 0.74), 1);
  polygon(graphics, [walls.topFront, apexRight, walls.topRight]);
  if (look.build === 'stone') {
    gableLight(graphics, look, walls.topLeft, walls.topFront, apexLeft);
    gableLight(graphics, look, walls.topFront, walls.topRight, apexRight);
  } else {
    drawGableFraming(graphics, look, [
      [walls.topLeft, apexLeft, walls.topFront, true],
      [walls.topFront, apexRight, walls.topRight, false],
    ]);
  }

  // The barge boards: the roof's own edge, running down each gable's rakes and
  // oversailing the wall below. Drawn last on this side so they sit over the
  // gable wall rather than under it, which is how a barge board actually works.
  graphics.fillStyle(shade(look.roof, 0.92), 1);
  polygon(graphics, [bargeLeft, frontEave, { x: cx, y: topY + halfH }, apexLeft]);
  graphics.fillStyle(shade(look.roof, 0.7), 1);
  polygon(graphics, [bargeRight, frontEave, { x: cx, y: topY + halfH }, apexRight]);
  graphics.fillStyle(shade(look.roof, 1.06), 1);
  polygon(graphics, [bargeLeft, eaveLeft, { x: cx - halfW, y: topY }, apexLeft]);
  graphics.fillStyle(shade(look.roof, 0.84), 1);
  polygon(graphics, [bargeRight, eaveRight, { x: cx + halfW, y: topY }, apexRight]);

  // Beam ends at the eaves only. The same block at the head of a gable is not a
  // rafter foot at all — that is the end of the ridge — and against the sky it
  // reads as a splinter of timber floating over the roof behind.
  graphics.fillStyle(shade(look.timber, 1.1), 1);
  beamEnd(graphics, eaveLeft, -1);
  graphics.fillStyle(shade(look.timber, 0.86), 1);
  beamEnd(graphics, eaveRight, 1);
}

/**
 * A single-ridge gable roof: two slopes and one gable end facing the camera.
 *
 * Simpler than the cross, and deliberately so — most of the settlement is
 * workshops and stores, and a plain gable is what they were. What keeps them
 * apart from each other is which wall the gable end stands over, how steep the
 * pitch is and what it is covered with.
 */
function drawGableRoof(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  frame: GableFrame,
): void {
  const { facing, ridgeFront, ridgeBack, gA, gB, hA, hB } = frame;
  const eaves = look.eaves;
  const style = coverStyle(look.cover);

  // The eaves oversail along each wall's own outward direction, and the barges
  // carry the ridge past the gable ends along the ridge's own.
  const nearOut = { x: -facing * eaves, y: eaves / 2 };
  const farOut = { x: facing * eaves, y: -eaves / 2 };
  const barge = { x: facing * eaves, y: eaves / 2 };
  const move = (p: Point, ...by: Point[]): Point =>
    by.reduce((q, v) => ({ x: q.x + v.x, y: q.y + v.y }), p);
  const back = { x: -barge.x, y: -barge.y };

  const nearBack = move(hA, nearOut, back);
  const nearFront = move(gB, nearOut, barge);
  const farBack = move(hB, farOut, back);
  const farFront = move(gA, farOut, barge);
  const ridgeF = move(ridgeFront, barge);
  const ridgeB = move(ridgeBack, back);

  // The gable-end wall first: the slopes oversail it on both rakes, which is
  // what makes the roof read as sitting *on* the building rather than beside it.
  graphics.fillStyle(shade(look.wall, facing === -1 ? 0.94 : 0.74), 1);
  polygon(graphics, [gB, gA, ridgeFront]);
  if (look.build === 'stone') {
    gableLight(graphics, look, gB, gA, ridgeFront);
  } else {
    drawGableFraming(graphics, look, [[gB, ridgeFront, gA, facing === -1]]);
  }

  // The far slope, then the near one. They meet along the ridge and nowhere
  // else, so between them the gable end shows through as a triangle.
  graphics.fillStyle(shade(look.roof, 0.74), 1);
  polygon(graphics, [farBack, ridgeB, ridgeF, farFront]);
  graphics.fillStyle(look.roof, 1);
  polygon(graphics, [nearBack, ridgeB, ridgeF, nearFront]);

  for (const t of style.courses) {
    graphics.fillStyle(shade(look.roof, 0.62), 0.5);
    roofCourse(graphics, ridgeB, ridgeF, farBack, farFront, t, style.lift);
    graphics.fillStyle(shade(look.roof, 0.86), 0.5);
    roofCourse(graphics, ridgeB, ridgeF, nearBack, nearFront, t, style.lift);
  }

  // The sawn edge under the near eave.
  graphics.fillStyle(shade(look.roof, 0.5), 1);
  polygon(graphics, [
    nearBack,
    nearFront,
    { x: nearFront.x, y: nearFront.y + style.fascia },
    { x: nearBack.x, y: nearBack.y + style.fascia },
  ]);

  // The barge boards down the near gable's two rakes, and the ridge over both.
  graphics.fillStyle(shade(look.roof, 1.04), 1);
  polygon(graphics, strip(nearFront, ridgeF, 2.6));
  graphics.fillStyle(shade(look.roof, 0.82), 1);
  polygon(graphics, strip(farFront, ridgeF, 2.6));
  graphics.fillStyle(shade(look.roof, 1.2), 1);
  polygon(graphics, strip(ridgeB, ridgeF, 2.6));

  graphics.fillStyle(shade(look.timber, facing === -1 ? 1.1 : 0.86), 1);
  beamEnd(graphics, nearBack, facing === -1 ? 1 : -1);
  beamEnd(graphics, nearFront, facing === -1 ? -1 : 1);
}

/**
 * Rafters and a king post on a gable wall.
 *
 * Each rafter is a wedge cut *inside* its own triangle rather than a strip laid
 * along the edge: a strip has square ends, so where two of them meet at the apex
 * their outer corners carry past it and hang a dark hook over the roof behind.
 * Insetting toward the triangle's own centre puts the rafters' outer edges on
 * the gable's edges exactly, and mitres them at the apex.
 */
function drawGableFraming(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  gables: readonly (readonly [Point, Point, Point, boolean])[],
): void {
  const timberWidth = 2.6;

  for (const [a, apex, b, lit] of gables) {
    const centre = { x: (a.x + apex.x + b.x) / 3, y: (a.y + apex.y + b.y) / 3 };
    // How far in each vertex has to move for the two rakes to gain their
    // thickness. The centre sits a third of the way off each edge, so the edge
    // travels that same fraction of the height standing over it.
    const gap = Math.min(edgeGap(centre, a, apex), edgeGap(centre, apex, b));
    const k = Math.min(0.6, Math.max(0.05, timberWidth / Math.max(gap, 0.001)));
    const inward = (p: Point): Point => ({
      x: p.x + (centre.x - p.x) * k,
      y: p.y + (centre.y - p.y) * k,
    });
    const inApex = inward(apex);

    graphics.fillStyle(shade(look.timber, lit ? 1.06 : 0.84), 1);
    polygon(graphics, [a, apex, inApex, inward(a)]);
    polygon(graphics, [apex, b, inward(b), inApex]);
    // The king post, down the middle from the ridge to the tie beam. It hangs
    // from the mitre, not the apex, so it too stays under the roof.
    const tie = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    polygon(graphics, strip(inApex, tie, 2.2));
  }
}

/**
 * The loft window high in a stone gable, with a sill under it.
 *
 * Masonry has no rafters showing, so a stone gable gets nothing where a timber
 * one gets its frame — and a blank triangle two storeys tall is the flattest
 * shape in the settlement. One opening up in it gives the wall a scale and says
 * there is a building behind it.
 *
 * **It has to be an upright window, and the first version was a diamond.** A
 * rotated square is cheap to draw and reads, unmistakably, as a window somebody
 * has fitted crooked — the eye knows which way a window goes long before it
 * knows what building it is looking at. So this is built exactly the way the
 * wall windows below it are: the head and sill run along the wall's own
 * direction, `a` to `b`, and the jambs are vertical on screen. That is what
 * makes it sit *in* the masonry instead of on top of it.
 */
function gableLight(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  a: Point,
  b: Point,
  apex: Point,
): void {
  const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  /** How far the apex stands above the wall top, in pixels. */
  const rise = base.y - apex.y;
  const head = rise * 0.62;
  const foot = rise * 0.26;
  if (head - foot < 4) {
    return;
  }

  /** A point in the gable wall's own plane. */
  const at = (t: number, lift: number): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t - lift,
  });

  // Half the width, as a share of the wall. Kept well inside the rakes: at
  // 0.135 the triangle above is still a third taller than the window's head, so
  // the frame never crosses the roof line however steep the pitch.
  const t0 = 0.5 - 0.11;
  const t1 = 0.5 + 0.11;

  // The surround, cut a little proud of the opening — dressed stone round a
  // hole in rubble, which is how the opening was actually made.
  graphics.fillStyle(shade(look.wall, 1.22), 1);
  polygon(graphics, [
    at(t0 - 0.025, head + 2),
    at(t1 + 0.025, head + 2),
    at(t1 + 0.025, foot - 2),
    at(t0 - 0.025, foot - 2),
  ]);

  graphics.fillStyle(WINDOW_DARK, 1);
  polygon(graphics, [at(t0, head), at(t1, head), at(t1, foot), at(t0, foot)]);

  // One upright mullion, as downstairs. Two tall lights rather than four panes:
  // a loft window was smaller than a hall window and this keeps it reading as
  // one at half the size.
  graphics.fillStyle(shade(look.timber, 1.1), 1);
  polygon(graphics, strip(at(0.5, head), at(0.5, foot), 1.2));

  // The reveal along the head, in shadow: the thickness of the wall.
  graphics.fillStyle(0x000000, 0.34);
  polygon(graphics, [at(t0, head), at(t1, head), at(t1, head - 2), at(t0, head - 2)]);

  // And the sill, oversailing both jambs and lit along its top.
  graphics.fillStyle(shade(look.stone, 1.12), 1);
  polygon(graphics, [
    at(t0 - 0.045, foot - 1),
    at(t1 + 0.045, foot - 1),
    at(t1 + 0.045, foot - 3.4),
    at(t0 - 0.045, foot - 3.4),
  ]);
  graphics.fillStyle(shade(look.stone, 0.8), 1);
  polygon(graphics, [
    at(t0 - 0.045, foot - 3.4),
    at(t1 + 0.045, foot - 3.4),
    at(t1 + 0.045, foot - 4.4),
    at(t0 - 0.045, foot - 4.4),
  ]);
}

/** Perpendicular distance from a point to the line through `a` and `b`. */
function edgeGap(from: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs((from.x - a.x) * dy - (from.y - a.y) * dx) / length;
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

/* ------------------------------------------------------------------------- */
/* Openings, stack and work bay                                               */
/* ------------------------------------------------------------------------- */

/** Framed openings with a cross mullion. Glass was for churches. */
function drawWindows(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  sillY: number,
): void {
  const { cx, halfW, halfH } = options;
  const head = look.wallHeight * 0.78;
  const foot = look.wallHeight * 0.3;
  if (head - foot < 5) {
    return;
  }

  for (const side of [-1, 1] as Side[]) {
    for (let index = 0; index < look.windows; index += 1) {
      // The left face gives its front bay to the door.
      const bay = look.door && side === -1 ? index + 1 : index;
      const centre = WINDOWS[bay];
      if (centre === undefined) {
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

/** A plank door in the near-left wall, with stone steps up to it. */
function drawDoor(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  sillY: number,
): void {
  const { cx, halfW, halfH } = options;
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
    graphics.fillStyle(shade(look.stone, step === 0 ? 1.16 : 1.04), 1);
    polygon(graphics, [at(t0 - 0.02, lift), at(t1 + 0.02, lift), b, a]);
    graphics.fillStyle(shade(look.stone, 0.72), 1);
    polygon(graphics, [a, b, { x: b.x, y: b.y + 2.4 }, { x: a.x, y: a.y + 2.4 }]);
  }
}

/**
 * The stack: a stone prism standing on the ridge, with a cap.
 *
 * On the ridge rather than out on a pitch. A stack on a slope reads as a post
 * leaning against the building, and one on the hip — the silhouette edge — reads
 * as hanging in the air beside it.
 */
function drawChimney(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  base: Point,
): void {
  const half = CHIMNEY.width / 2;
  const headY = base.y - CHIMNEY.height;
  const footY = base.y + 5;

  graphics.fillStyle(shade(look.stone, 1.1), 1);
  polygon(graphics, [
    { x: base.x - half, y: headY },
    { x: base.x, y: headY + half / 2 },
    { x: base.x, y: footY + half / 2 },
    { x: base.x - half, y: footY },
  ]);
  graphics.fillStyle(shade(look.stone, 0.74), 1);
  polygon(graphics, [
    { x: base.x, y: headY + half / 2 },
    { x: base.x + half, y: headY },
    { x: base.x + half, y: footY },
    { x: base.x, y: footY + half / 2 },
  ]);

  // The cap oversails, which is what stops a chimney reading as a grey post.
  const cap = half + 2;
  graphics.fillStyle(shade(look.stone, 1.3), 1);
  polygon(graphics, [
    { x: base.x - cap, y: headY },
    { x: base.x, y: headY - cap / 2 },
    { x: base.x + cap, y: headY },
    { x: base.x, y: headY + cap / 2 },
  ]);
  graphics.fillStyle(shade(look.stone, 0.86), 1);
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

/**
 * An open lean-to along the near-left wall: a work bay.
 *
 * A mono-pitch on two posts with nothing under it but the ground. It reaches out
 * across the building's own plot — never past it — and because it breaks the
 * silhouette it says "a trade is carried on here" from further away than any
 * amount of detail painted on a wall does.
 */
function drawAisle(
  graphics: Phaser.GameObjects.Graphics,
  look: StructureLook,
  options: StructureOptions,
  levels: { topY: number },
): void {
  const { cx, groundY, halfW, halfH } = options;
  const { topY } = levels;
  const reach = look.aisle;

  // **A bay, not the whole side.** Run the full length of the wall it stands
  // against and it covers the door, the steps and both windows, and the
  // building behind it stops existing. From just past the door to the side
  // corner is one bay, which is what a lean-to actually was.
  const from = 0.42;
  const to = 0.98;

  // Springs from below the eaves so it tucks under the roof above rather than
  // reading as a second roof, and falls as it goes out, or the pitch reads flat
  // and the whole thing looks like a shelf.
  const springY = topY + Math.max(4, look.wallHeight * 0.2) + look.eaves / 2;
  const drop = reach * 0.34;

  // A point `reach` out from the wall stands `reach / 2` lower on the screen:
  // the ground goes out with the roof.
  const out = (p: Point, lift: number): Point => ({
    x: p.x - reach,
    y: p.y + reach / 2 + lift,
  });
  const wallAt = (t: number, y: number): Point => wallPoint(cx, halfW, halfH, -1, t, y);

  const wallA = wallAt(from, springY);
  const wallB = wallAt(to, springY);
  const plateA = out(wallA, drop);
  const plateB = out(wallB, drop);
  const footA = out(wallAt(from, groundY), 0);
  const footB = out(wallAt(to, groundY), 0);

  // The two posts, drawn before the roof they carry so it caps them.
  for (const [head, foot] of [
    [plateB, footB],
    [plateA, footA],
  ] as const) {
    graphics.fillStyle(shade(look.timber, 1.02), 1);
    polygon(graphics, [
      { x: head.x - 1.9, y: head.y },
      { x: head.x, y: head.y + 1 },
      { x: foot.x, y: foot.y + 1 },
      { x: foot.x - 1.9, y: foot.y },
    ]);
    graphics.fillStyle(shade(look.timber, 0.78), 1);
    polygon(graphics, [
      { x: head.x, y: head.y + 1 },
      { x: head.x + 1.9, y: head.y },
      { x: foot.x + 1.9, y: foot.y },
      { x: foot.x, y: foot.y + 1 },
    ]);
  }

  // Darker than the roof above it: a lean-to is an afterthought nailed to a
  // building, and at the same tone the two read as one shape.
  graphics.fillStyle(shade(look.roof, 0.68), 1);
  polygon(graphics, [wallB, wallA, plateA, plateB]);

  const style = coverStyle(look.cover);
  for (const t of style.courses) {
    graphics.fillStyle(shade(look.roof, 0.54), 0.5);
    roofCourse(graphics, wallB, wallA, plateB, plateA, t, style.lift);
  }

  // The sawn edge along the outer plate, and the plate itself under it.
  graphics.fillStyle(shade(look.roof, 0.4), 1);
  polygon(graphics, [
    plateB,
    plateA,
    { x: plateA.x, y: plateA.y + style.fascia },
    { x: plateB.x, y: plateB.y + style.fascia },
  ]);
  graphics.fillStyle(shade(look.timber, 1.06), 1);
  polygon(
    graphics,
    strip(
      { x: plateB.x, y: plateB.y + style.fascia },
      { x: plateA.x, y: plateA.y + style.fascia },
      2.2,
    ),
  );
}
