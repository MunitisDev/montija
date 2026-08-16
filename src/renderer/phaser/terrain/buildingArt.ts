/**
 * Building placeholder art, built from each building's own footprint.
 *
 * Every building used to share one 128×128 texture drawn around a hard-coded
 * base line, whatever its footprint. Three things went wrong as a result, and
 * all three were visible in play:
 *
 * - a 3×3 Storage Yard was drawn exactly as large as a 2×2 House, so neither
 *   sat on the plot it actually occupied;
 * - the front corner of the base fell 22px below the texture's bottom edge, so
 *   buildings were **clipped along their front**;
 * - because the drawn base did not match the footprint, terrain in front of a
 *   building sorted over parts of it, which reads as the ground **overlapping**
 *   the walls.
 *
 * So the geometry is derived rather than hand-placed. A `w × h` footprint maps
 * to a rhombus `(w + h)·TILE_WIDTH/2` across and `(w + h)·TILE_HEIGHT/2` tall;
 * the building is that rhombus extruded upward, and the texture is sized to
 * hold it with the anchor exactly on the footprint's centre.
 *
 * ```text
 *            ▲ apex            texture top
 *           ╱ ╲
 *          ╱   ╲               roofHeight
 *         ╱_____╲
 *         │     │              wallHeight
 *      ╲  │     │  ╱
 *        ╲│_____│╱             ◀── ground line: the anchor, at the
 *         ╲     ╱                  footprint's centre
 *           ╲ ╱                 half the base rhombus, below the anchor
 *            ▼                 texture bottom
 * ```
 */

import type Phaser from 'phaser';

import { BUILDINGS, type BuildingId } from '@/data/buildings';
import { TILE_HEIGHT, TILE_WIDTH } from '@/shared/math/isometric';

export interface BuildingPalette {
  readonly wall: number;
  readonly roof: number;
  readonly trim: number;
}

/** How each building is massed. Footprint comes from the building data. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** The four corners of a footprint rhombus, at some height. */
interface Rhombus {
  readonly back: Point;
  readonly right: Point;
  readonly front: Point;
  readonly left: Point;
}

interface BuildingMass {
  /** Height of the walls, in pixels. */
  readonly wallHeight: number;
  /** Height of the roof above the walls. `0` leaves the building open. */
  readonly roofHeight: number;
  /** How far the roof oversails the walls, in pixels. */
  readonly eaves: number;
  /** Set for buildings that are a yard rather than a hall: no roof, low walls. */
  readonly open?: boolean;
  /** A stone footing under the walls, in pixels. Damp-proofing, and weight. */
  readonly plinth?: number;
  /** Set when the building has a hearth, and so a chimney and smoke. */
  readonly chimney?: boolean;
  /** How many window openings the front wall carries. */
  readonly windows?: number;
  /** Set for a thatched roof rather than shingled: softer, straw-coloured. */
  readonly thatch?: boolean;
  /** Set for worked land rather than a structure: furrows, or fruit trees. */
  readonly field?: 'crop' | 'orchard';
}

/**
 * Roof heights are large on purpose.
 *
 * A pyramid roof only reads as pitched once its apex clears the *back* corner
 * of its own rhombus — for a 2x2 building that corner is already 32px above the
 * centre, so a 30px roof produced a flat lozenge with a suspicion of a ridge.
 * Steep pitches are also what the period asks for.
 */
const MASS: Readonly<Record<BuildingId, BuildingMass>> = {
  // The only building people live in, and the only one with a hearth — so it is
  // the only one with smoke coming out of it, which is most of what makes a
  // settlement look inhabited rather than built.
  house: { wallHeight: 24, roofHeight: 48, eaves: 6, plinth: 5, chimney: true, windows: 2 },
  // An open yard. Low walls, no roof, so the player can see it is a place for
  // things rather than a place for people.
  'storage-yard': { wallHeight: 13, roofHeight: 0, eaves: 0, open: true },
  // A granary: shut tight, because its whole purpose is keeping weather out.
  // No windows for the same reason, and a stone footing to keep damp off grain.
  'food-storage': { wallHeight: 20, roofHeight: 40, eaves: 7, plinth: 6 },
  // A forager's shelter: thatched, cheap, one opening.
  'gatherer-hut': { wallHeight: 20, roofHeight: 42, eaves: 6, thatch: true, windows: 1 },
  // A workshop. Taller than it needs to be, because the work happens indoors.
  woodcutter: { wallHeight: 22, roofHeight: 44, eaves: 6, plinth: 4, windows: 1 },
  // A lodge out among the trees: low, thatched, one window, no stone to spare.
  forester: { wallHeight: 18, roofHeight: 38, eaves: 7, thatch: true, windows: 1 },
  // A quarry is a hole with a shed over it. Low walls and a deep stone footing,
  // because most of what the player should read is *cut rock*.
  quarry: { wallHeight: 14, roofHeight: 22, eaves: 5, plinth: 10 },
  // A mine is a mouth in the hillside: a short stone head and a shallow roof.
  mine: { wallHeight: 16, roofHeight: 26, eaves: 5, plinth: 8 },
  // A forge: stone-footed against the fire, and the second building in the game
  // with a chimney — because the second building in the game with a hearth.
  blacksmith: { wallHeight: 20, roofHeight: 34, eaves: 6, plinth: 6, chimney: true, windows: 1 },
  // Not buildings at all: broken ground inside a low fence. Drawn flat so the
  // settlement's skyline stays buildings, and a field reads as worked land.
  'crop-field': { wallHeight: 4, roofHeight: 0, eaves: 0, field: 'crop' },
  orchard: { wallHeight: 4, roofHeight: 0, eaves: 0, field: 'orchard' },
};

/** Muted, earthy, and distinguishable at a glance without being colourful. */
export const BUILDING_COLOURS: Readonly<Record<BuildingId, BuildingPalette>> = {
  house: { wall: 0x6b5a44, roof: 0x5a4a35, trim: 0x4a3d2c },
  'storage-yard': { wall: 0x6b573c, roof: 0x574733, trim: 0x453824 },
  'food-storage': { wall: 0x6a6048, roof: 0x565039, trim: 0x45402d },
  'gatherer-hut': { wall: 0x5f6248, roof: 0x4c5039, trim: 0x3d402d },
  woodcutter: { wall: 0x67543f, roof: 0x534431, trim: 0x423628 },
  forester: { wall: 0x5b5c41, roof: 0x4a4b34, trim: 0x3b3c29 },
  quarry: { wall: 0x6c6960, roof: 0x565349, trim: 0x413f38 },
  mine: { wall: 0x615d55, roof: 0x4b4840, trim: 0x38352f },
  blacksmith: { wall: 0x5e5044, roof: 0x413a33, trim: 0x332e28 },
  'crop-field': { wall: 0x6d6234, roof: 0x5b5230, trim: 0x4a4128 },
  orchard: { wall: 0x4f5c37, roof: 0x44502f, trim: 0x3a4428 },
};

/** Breathing room above the roof, so nothing touches the texture edge. */
const TOP_MARGIN = 4;

/** Rubble footing and chimney stone. Cold and grey against the warm timber. */
const STONE_FOOTING = 0x6a675e;

/** A window opening. Dark, because glass was for churches. */
const WINDOW_DARK = 0x2a2620;

/** Straw, for the buildings too cheap to be shingled. */
const THATCH = 0x7d6a42;

/**
 * How far the walls are pulled in from the footprint edge.
 *
 * A building drawn to the exact edge of its plot touches its neighbour's, which
 * reads as two buildings fused together. A couple of pixels of garden fixes it.
 */
const FOOTPRINT_INSET = 3;

export interface BuildingTextureSpec {
  readonly width: number;
  readonly height: number;
  /** Origin Y, in `0..1`, putting the anchor on the footprint's centre. */
  readonly groundLine: number;
}

/** The rhombus a footprint occupies on screen. */
function baseSize(footprint: { width: number; height: number }) {
  const span = footprint.width + footprint.height;
  return { width: (span * TILE_WIDTH) / 2, height: (span * TILE_HEIGHT) / 2 };
}

/**
 * Texture dimensions and anchor for a building.
 *
 * Exported because the renderer needs the same ground line the texture was
 * drawn with — the two must agree, and deriving both from here is what keeps
 * them agreeing.
 */
export function buildingTextureSpec(id: BuildingId): BuildingTextureSpec {
  const base = baseSize(BUILDINGS[id].footprint);
  const mass = MASS[id];

  // Room for the roof's overhang on both sides.
  const width = Math.ceil(base.width + mass.eaves * 2);
  // Everything above the anchor, plus the half-rhombus that falls in front of
  // it. Forgetting that half is exactly what clipped every building's front.
  const above = base.height / 2 + mass.wallHeight + mass.roofHeight + TOP_MARGIN;
  const below = base.height / 2;

  return {
    width,
    height: Math.ceil(above + below),
    groundLine: above / (above + below),
  };
}

/**
 * Draws one building into `graphics`, sized to its own footprint.
 *
 * The result is an isometric box standing exactly on its plot: the base rhombus
 * is the footprint, the walls rise from it, and the roof caps them.
 */
export function drawBuilding(
  graphics: Phaser.GameObjects.Graphics,
  id: BuildingId,
  palette: BuildingPalette,
): void {
  const spec = buildingTextureSpec(id);
  const base = baseSize(BUILDINGS[id].footprint);
  const mass = MASS[id];

  const cx = spec.width / 2;
  const groundY = spec.height * spec.groundLine;

  const halfW = base.width / 2 - FOOTPRINT_INSET;
  const halfH = base.height / 2 - FOOTPRINT_INSET / 2;

  /** The four corners of a rhombus centred on `cx`, at height `y`. */
  const rhombus = (y: number): Rhombus => ({
    back: { x: cx, y: y - halfH },
    right: { x: cx + halfW, y },
    front: { x: cx, y: y + halfH },
    left: { x: cx - halfW, y },
  });

  const ground = rhombus(groundY);
  const plinthHeight = mass.plinth ?? 0;
  const sill = rhombus(groundY - plinthHeight);
  const top = rhombus(groundY - mass.wallHeight);

  // A soft shadow on the plot itself, so the building is planted rather than
  // floating. Drawn to the full footprint, inset included, so it reads as
  // contact rather than as a halo.
  graphics.fillStyle(0x000000, 0.22);
  polygon(graphics, [
    { x: cx, y: groundY - halfH },
    { x: cx + halfW + 2, y: groundY },
    { x: cx, y: groundY + halfH + 1 },
    { x: cx - halfW - 2, y: groundY },
  ]);

  // A stone footing, where the building has one. Rubble rather than dressed
  // masonry: this is a frontier settlement, not a cathedral.
  if (plinthHeight > 0) {
    graphics.fillStyle(STONE_FOOTING, 1);
    polygon(graphics, [sill.left, sill.front, ground.front, ground.left]);
    graphics.fillStyle(shade(STONE_FOOTING, 0.76), 1);
    polygon(graphics, [sill.front, sill.right, ground.right, ground.front]);
    // A couple of larger stones picked out along the lit face.
    graphics.fillStyle(shade(STONE_FOOTING, 1.16), 1);
    for (const t of [0.3, 0.62]) {
      const x = cx - halfW + halfW * t;
      const y = groundY + halfH * (t - 0.5) * 0.9 - plinthHeight * 0.55;
      graphics.fillRect(x, y, 7, 3);
    }
  }

  if (mass.field) {
    drawField(graphics, { palette, cx, groundY, halfW, halfH, kind: mass.field });
    return;
  }

  // Left wall, catching the light.
  graphics.fillStyle(palette.wall, 1);
  polygon(graphics, [top.left, top.front, sill.front, sill.left]);

  // Right wall, in shadow: the key light comes from the upper left throughout.
  graphics.fillStyle(shade(palette.wall, 0.78), 1);
  polygon(graphics, [top.front, top.right, sill.right, sill.front]);

  if (mass.open) {
    // An open yard: show the floor inside the low walls rather than a roof.
    graphics.fillStyle(shade(palette.trim, 0.9), 1);
    polygon(graphics, [top.back, top.right, top.front, top.left]);
    drawStackedGoods(graphics, cx, groundY - mass.wallHeight, halfW);
    return;
  }

  // Timber framing on both walls. Uprights only — a full cruck frame at this
  // size turns into noise, whereas four posts read instantly as a timber
  // building and cost four polygons.
  drawFraming(graphics, {
    palette,
    cx,
    halfW,
    halfH,
    sillY: groundY - plinthHeight,
    topY: groundY - mass.wallHeight,
  });

  drawRoof(graphics, {
    palette,
    top,
    cx,
    apexY: groundY - mass.wallHeight - mass.roofHeight,
    eaves: mass.eaves,
    thatch: mass.thatch === true,
  });

  // A door on the left wall, which faces the camera.
  const wallSpan = mass.wallHeight - plinthHeight;
  const doorHeight = Math.min(wallSpan - 3, 16);
  if (doorHeight > 6) {
    const doorY = groundY - plinthHeight;
    graphics.fillStyle(palette.trim, 1);
    polygon(graphics, [
      { x: cx - halfW * 0.42, y: doorY + halfH * 0.42 - doorHeight },
      { x: cx - halfW * 0.16, y: doorY + halfH * 0.16 - doorHeight },
      { x: cx - halfW * 0.16, y: doorY + halfH * 0.16 },
      { x: cx - halfW * 0.42, y: doorY + halfH * 0.42 },
    ]);
    // A lintel over it, one shade lighter, so the opening has an edge.
    graphics.fillStyle(shade(palette.trim, 1.4), 1);
    polygon(graphics, [
      { x: cx - halfW * 0.46, y: doorY + halfH * 0.46 - doorHeight - 2 },
      { x: cx - halfW * 0.12, y: doorY + halfH * 0.12 - doorHeight - 2 },
      { x: cx - halfW * 0.12, y: doorY + halfH * 0.12 - doorHeight },
      { x: cx - halfW * 0.46, y: doorY + halfH * 0.46 - doorHeight },
    ]);
  }

  // Windows on the right wall, small and dark: glass was for churches.
  for (let index = 0; index < (mass.windows ?? 0); index += 1) {
    const t = 0.28 + index * 0.34;
    const y = groundY - plinthHeight + halfH * t - wallSpan * 0.62;
    const x = cx + halfW * t;
    graphics.fillStyle(WINDOW_DARK, 1);
    polygon(graphics, [
      { x: x - 5, y: y - 2 },
      { x: x + 1, y: y + 1 },
      { x: x + 1, y: y + 8 },
      { x: x - 5, y: y + 5 },
    ]);
  }

  if (mass.chimney === true) {
    // Placed *on* the roof plane, by interpolating along the left pitch from
    // the apex to the eaves. Guessing a height instead put the stack below the
    // roof surface, where it read as a post leaning against the gable.
    const along = 0.34;
    const apexY = groundY - mass.wallHeight - mass.roofHeight;
    const eaveX = cx - halfW - mass.eaves;
    const eaveY = groundY - mass.wallHeight + mass.eaves / 2;
    drawChimney(graphics, cx + (eaveX - cx) * along, apexY + (eaveY - apexY) * along);
  }
}

/** Four uprights, so a wall reads as a timber frame rather than as a slab. */
function drawFraming(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    cx: number;
    halfW: number;
    halfH: number;
    sillY: number;
    topY: number;
  },
): void {
  const { palette, cx, halfW, halfH, sillY, topY } = options;
  const timber = shade(palette.trim, 1.18);
  const shaded = shade(palette.trim, 0.86);

  // Left wall: posts run from the sill to the wall head, following the slope.
  graphics.fillStyle(timber, 1);
  for (const t of [0.3, 0.66]) {
    const x = cx - halfW * t;
    const drop = halfH * t;
    polygon(graphics, [
      { x: x - 1.5, y: topY + drop },
      { x: x + 1.5, y: topY + drop },
      { x: x + 1.5, y: sillY + drop },
      { x: x - 1.5, y: sillY + drop },
    ]);
  }

  graphics.fillStyle(shaded, 1);
  for (const t of [0.3, 0.66]) {
    const x = cx + halfW * t;
    const drop = halfH * t;
    polygon(graphics, [
      { x: x - 1.5, y: topY + drop },
      { x: x + 1.5, y: topY + drop },
      { x: x + 1.5, y: sillY + drop },
      { x: x - 1.5, y: sillY + drop },
    ]);
  }

  // A wall plate along the top, tying the posts together.
  graphics.fillStyle(timber, 1);
  polygon(graphics, [
    { x: cx - halfW, y: topY },
    { x: cx, y: topY + halfH },
    { x: cx, y: topY + halfH + 2.5 },
    { x: cx - halfW, y: topY + 2.5 },
  ]);
  graphics.fillStyle(shaded, 1);
  polygon(graphics, [
    { x: cx + halfW, y: topY },
    { x: cx, y: topY + halfH },
    { x: cx, y: topY + halfH + 2.5 },
    { x: cx + halfW, y: topY + 2.5 },
  ]);
}

/** A stone chimney breaking the roofline. Only houses have hearths. */
function drawChimney(graphics: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const width = 7;
  const height = 16;

  graphics.fillStyle(STONE_FOOTING, 1);
  graphics.fillRect(x - width / 2, y - height, width / 2, height);
  graphics.fillStyle(shade(STONE_FOOTING, 0.74), 1);
  graphics.fillRect(x, y - height, width / 2, height);
  // The cap, brightest: it is the one face pointing at the sky.
  graphics.fillStyle(shade(STONE_FOOTING, 1.3), 1);
  graphics.fillRect(x - width / 2 - 1, y - height - 2.5, width + 2, 2.5);
}

/**
 * Worked land: furrows inside a low fence, or a stand of fruit trees.
 *
 * Drawn flat on purpose. A field is not a building, and giving it walls and a
 * roof would put a second row of structures across the settlement's skyline —
 * the one thing the art bible is most insistent about is that buildings
 * dominate and everything else stays subordinate to them.
 */
function drawField(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    cx: number;
    groundY: number;
    halfW: number;
    halfH: number;
    kind: 'crop' | 'orchard';
  },
): void {
  const { palette, cx, groundY, halfW, halfH, kind } = options;

  // Broken earth, in two facets like the ground it replaced.
  graphics.fillStyle(shade(palette.trim, 1.04), 1);
  polygon(graphics, [
    { x: cx, y: groundY - halfH },
    { x: cx + halfW, y: groundY },
    { x: cx, y: groundY + halfH },
  ]);
  graphics.fillStyle(palette.trim, 1);
  polygon(graphics, [
    { x: cx, y: groundY - halfH },
    { x: cx - halfW, y: groundY },
    { x: cx, y: groundY + halfH },
  ]);

  if (kind === 'crop') {
    // Furrows running along one axis, in the crop's own colour. Seven of them:
    // enough to read as ploughed, few enough not to shimmer when the camera
    // moves.
    for (let index = 1; index <= 7; index += 1) {
      const t = -1 + (index * 2) / 8;
      const spanX = halfW * t;
      const spanY = halfH * (1 - Math.abs(t));
      graphics.fillStyle(shade(palette.wall, index % 2 === 0 ? 1.1 : 0.94), 1);
      polygon(graphics, [
        { x: cx + spanX, y: groundY - spanY },
        { x: cx + spanX, y: groundY + spanY },
        { x: cx + spanX + 3, y: groundY + spanY - 1.5 },
        { x: cx + spanX + 3, y: groundY - spanY - 1.5 },
      ]);
    }
  } else {
    // Fruit trees in rows: small rounded crowns on short trunks, so an orchard
    // reads as trees the settlement planted rather than as wild wood.
    for (const [ox, oy] of [
      [-0.5, -0.25],
      [0, -0.5],
      [0.5, -0.25],
      [-0.5, 0.25],
      [0, 0],
      [0.5, 0.25],
      [0, 0.5],
    ] as const) {
      const x = cx + halfW * ox * 0.72;
      const y = groundY + halfH * oy * 0.72;
      graphics.fillStyle(0x000000, 0.18);
      graphics.fillEllipse(x, y + 1, 11, 4);
      graphics.fillStyle(0x4a3d2c, 1);
      graphics.fillRect(x - 1.2, y - 9, 2.4, 9);
      graphics.fillStyle(shade(palette.wall, 1.18), 1);
      graphics.fillEllipse(x - 1.5, y - 14, 13, 11);
      graphics.fillStyle(shade(palette.wall, 0.82), 1);
      graphics.fillEllipse(x + 3, y - 12, 8, 8);
    }
  }

  // A low fence on the two back edges only. Across the front it would hide the
  // crop, which is the one thing the player needs to see.
  graphics.lineStyle(2, shade(palette.roof, 1.1), 0.9);
  graphics.beginPath();
  graphics.moveTo(cx - halfW, groundY - 4);
  graphics.lineTo(cx, groundY - halfH - 4);
  graphics.lineTo(cx + halfW, groundY - 4);
  graphics.strokePath();
  graphics.fillStyle(shade(palette.roof, 0.9), 1);
  for (const t of [-0.66, -0.33, 0, 0.33, 0.66]) {
    const x = cx + halfW * t;
    const y = groundY - halfH * (1 - Math.abs(t));
    graphics.fillRect(x - 1, y - 7, 2, 7);
  }
}

/** A hipped roof: one silhouette, then the shaded half. */
function drawRoof(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    top: Rhombus;
    cx: number;
    apexY: number;
    eaves: number;
    thatch: boolean;
  },
): void {
  const { palette, top, cx, apexY, eaves, thatch } = options;
  const roof = thatch ? THATCH : palette.roof;

  // The eaves oversail the walls on every side.
  const eL = { x: top.left.x - eaves, y: top.left.y + eaves / 2 };
  const eR = { x: top.right.x + eaves, y: top.right.y + eaves / 2 };
  const eF = { x: top.front.x, y: top.front.y + eaves / 2 };
  const eB = { x: top.back.x, y: top.back.y - eaves / 2 };
  const apex = { x: cx, y: apexY };

  // The far pitches first, so their silhouette shows above the ridge without
  // being drawn over the near ones.
  graphics.fillStyle(shade(roof, 0.88), 1);
  polygon(graphics, [apex, eB, eL]);
  polygon(graphics, [apex, eB, eR]);

  // Near-left pitch, catching the light.
  graphics.fillStyle(roof, 1);
  polygon(graphics, [apex, eL, eF]);

  // Near-right pitch, away from it.
  graphics.fillStyle(shade(roof, 0.74), 1);
  polygon(graphics, [apex, eR, eF]);

  // Courses across the near pitches: shingle lines, or the bound bundles of a
  // thatch. Three of them, faint — enough to say what the roof is made of
  // without turning the largest surface on the building into a pattern.
  const courses = thatch ? 3 : 4;
  for (let index = 1; index <= courses; index += 1) {
    const t = index / (courses + 1);
    graphics.fillStyle(shade(roof, thatch ? 0.82 : 1.14), thatch ? 0.7 : 0.55);
    polygon(graphics, [
      { x: apex.x + (eL.x - apex.x) * t, y: apex.y + (eL.y - apex.y) * t },
      { x: apex.x + (eF.x - apex.x) * t, y: apex.y + (eF.y - apex.y) * t },
      { x: apex.x + (eF.x - apex.x) * t, y: apex.y + (eF.y - apex.y) * t + 1.5 },
      { x: apex.x + (eL.x - apex.x) * t, y: apex.y + (eL.y - apex.y) * t + 1.5 },
    ]);
    polygon(graphics, [
      { x: apex.x + (eR.x - apex.x) * t, y: apex.y + (eR.y - apex.y) * t },
      { x: apex.x + (eF.x - apex.x) * t, y: apex.y + (eF.y - apex.y) * t },
      { x: apex.x + (eF.x - apex.x) * t, y: apex.y + (eF.y - apex.y) * t + 1.5 },
      { x: apex.x + (eR.x - apex.x) * t, y: apex.y + (eR.y - apex.y) * t + 1.5 },
    ]);
  }

  // A ridge line, so the two pitches read as separate planes rather than a
  // flat lozenge.
  graphics.fillStyle(shade(roof, 1.12), 1);
  polygon(graphics, [
    { x: apex.x - 1, y: apex.y },
    { x: apex.x + 1, y: apex.y },
    { x: eF.x + 1, y: eF.y },
    { x: eF.x - 1, y: eF.y },
  ]);
}

/** Crates and sacks, so a storage yard reads as holding something. */
function drawStackedGoods(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  y: number,
  halfW: number,
): void {
  const crate = Math.max(6, halfW * 0.16);
  graphics.fillStyle(0x5a4a33, 1);
  graphics.fillRect(cx - crate * 1.6, y - crate * 0.9, crate * 1.4, crate);
  graphics.fillRect(cx + crate * 0.3, y - crate * 0.6, crate * 1.2, crate * 0.8);
  graphics.fillStyle(0x6d5c40, 1);
  graphics.fillRect(cx - crate * 0.5, y - crate * 1.5, crate, crate * 0.9);
}

function polygon(graphics: Phaser.GameObjects.Graphics, points: readonly Point[]): void {
  graphics.beginPath();
  const [first, ...rest] = points;
  if (!first) {
    return;
  }
  graphics.moveTo(first.x, first.y);
  for (const point of rest) {
    graphics.lineTo(point.x, point.y);
  }
  graphics.closePath();
  graphics.fillPath();
}

/** Multiplies a colour's brightness, clamped per channel. */
function shade(colour: number, factor: number): number {
  const r = Math.min(255, Math.round(((colour >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((colour >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((colour & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}
