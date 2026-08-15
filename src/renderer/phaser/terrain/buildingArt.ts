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
interface BuildingMass {
  /** Height of the walls, in pixels. */
  readonly wallHeight: number;
  /** Height of the roof above the walls. `0` leaves the building open. */
  readonly roofHeight: number;
  /** How far the roof oversails the walls, in pixels. */
  readonly eaves: number;
  /** Set for buildings that are a yard rather than a hall: no roof, low walls. */
  readonly open?: boolean;
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
  house: { wallHeight: 24, roofHeight: 48, eaves: 6 },
  // An open yard. Low walls, no roof, so the player can see it is a place for
  // things rather than a place for people.
  'storage-yard': { wallHeight: 13, roofHeight: 0, eaves: 0, open: true },
  // A granary: shut tight, because its whole purpose is keeping weather out.
  'food-storage': { wallHeight: 20, roofHeight: 40, eaves: 7 },
  'gatherer-hut': { wallHeight: 20, roofHeight: 42, eaves: 6 },
  woodcutter: { wallHeight: 22, roofHeight: 44, eaves: 6 },
};

/** Muted, earthy, and distinguishable at a glance without being colourful. */
export const BUILDING_COLOURS: Readonly<Record<BuildingId, BuildingPalette>> = {
  house: { wall: 0x6b5a44, roof: 0x5a4a35, trim: 0x4a3d2c },
  'storage-yard': { wall: 0x6b573c, roof: 0x574733, trim: 0x453824 },
  'food-storage': { wall: 0x6a6048, roof: 0x565039, trim: 0x45402d },
  'gatherer-hut': { wall: 0x5f6248, roof: 0x4c5039, trim: 0x3d402d },
  woodcutter: { wall: 0x67543f, roof: 0x534431, trim: 0x423628 },
};

/** Breathing room above the roof, so nothing touches the texture edge. */
const TOP_MARGIN = 4;

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
  const rhombus = (y: number) => ({
    back: { x: cx, y: y - halfH },
    right: { x: cx + halfW, y },
    front: { x: cx, y: y + halfH },
    left: { x: cx - halfW, y },
  });

  const ground = rhombus(groundY);
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

  // Left wall, catching the light.
  graphics.fillStyle(palette.wall, 1);
  polygon(graphics, [top.left, top.front, ground.front, ground.left]);

  // Right wall, in shadow: the key light comes from the upper left throughout.
  graphics.fillStyle(shade(palette.wall, 0.78), 1);
  polygon(graphics, [top.front, top.right, ground.right, ground.front]);

  if (mass.open) {
    // An open yard: show the floor inside the low walls rather than a roof.
    graphics.fillStyle(shade(palette.trim, 0.9), 1);
    polygon(graphics, [top.back, top.right, top.front, top.left]);
    drawStackedGoods(graphics, cx, groundY - mass.wallHeight, halfW);
    return;
  }

  drawRoof(graphics, {
    palette,
    top,
    cx,
    apexY: groundY - mass.wallHeight - mass.roofHeight,
    eaves: mass.eaves,
    halfW,
    halfH,
  });

  // A door on the left wall, which faces the camera.
  const doorHeight = Math.min(mass.wallHeight - 4, 16);
  if (doorHeight > 6) {
    graphics.fillStyle(palette.trim, 1);
    polygon(graphics, [
      { x: cx - halfW * 0.42, y: groundY + halfH * 0.42 - doorHeight },
      { x: cx - halfW * 0.16, y: groundY + halfH * 0.16 - doorHeight },
      { x: cx - halfW * 0.16, y: groundY + halfH * 0.16 },
      { x: cx - halfW * 0.42, y: groundY + halfH * 0.42 },
    ]);
  }
}

/** A hipped roof: one silhouette, then the shaded half. */
function drawRoof(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    top: ReturnType<typeof rhombusType>;
    cx: number;
    apexY: number;
    eaves: number;
    halfW: number;
    halfH: number;
  },
): void {
  const { palette, top, cx, apexY, eaves, halfW, halfH } = options;

  // The eaves oversail the walls on every side.
  const eL = { x: top.left.x - eaves, y: top.left.y + eaves / 2 };
  const eR = { x: top.right.x + eaves, y: top.right.y + eaves / 2 };
  const eF = { x: top.front.x, y: top.front.y + eaves / 2 };
  const eB = { x: top.back.x, y: top.back.y - eaves / 2 };
  const apex = { x: cx, y: apexY };

  // The far pitches first, so their silhouette shows above the ridge without
  // being drawn over the near ones.
  graphics.fillStyle(shade(palette.roof, 0.88), 1);
  polygon(graphics, [apex, eB, eL]);
  polygon(graphics, [apex, eB, eR]);

  // Near-left pitch, catching the light.
  graphics.fillStyle(palette.roof, 1);
  polygon(graphics, [apex, eL, eF]);

  // Near-right pitch, away from it.
  graphics.fillStyle(shade(palette.roof, 0.74), 1);
  polygon(graphics, [apex, eR, eF]);

  // A ridge line, so the two pitches read as separate planes rather than a
  // flat lozenge.
  graphics.fillStyle(shade(palette.roof, 1.12), 1);
  polygon(graphics, [
    { x: apex.x - 1, y: apex.y },
    { x: apex.x + 1, y: apex.y },
    { x: eF.x + 1, y: eF.y },
    { x: eF.x - 1, y: eF.y },
  ]);

  void halfW;
  void halfH;
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

/** Declared only so the roof options can name the rhombus shape. */
function rhombusType() {
  return {
    back: { x: 0, y: 0 },
    right: { x: 0, y: 0 },
    front: { x: 0, y: 0 },
    left: { x: 0, y: 0 },
  };
}

function polygon(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly { x: number; y: number }[],
): void {
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
