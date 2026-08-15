/**
 * The isometric projection subsystem.
 *
 * **This is the only place in the codebase allowed to know what "isometric"
 * means.** Every conversion between grid, world and scene space goes through
 * here. Scattering this arithmetic is how isometric projects end up with
 * objects half a tile off in three different subsystems.
 *
 * The projection is 2:1 dimetric: a tile is twice as wide as it is tall, so
 * moving one cell along +x goes right-and-down on screen, and one cell along
 * +y goes left-and-down.
 *
 * ```text
 *              (0,0)
 *               ╱╲
 *        +x   ╱    ╲   +y
 *           ╱        ╲
 *          ╲          ╱
 *            ╲      ╱
 *              ╲  ╱
 *             (W,H)
 * ```
 *
 * One world unit is one grid cell. That keeps villager movement, pathfinding
 * and building footprints all in the same natural unit, and confines the pixel
 * dimensions below to this file.
 */

import type { GridPoint, SceneBounds, ScenePoint, WorldPoint } from '@/shared/types/geometry';

/**
 * Width of one tile's diamond, in scene pixels.
 *
 * Fixed by `docs/ART_BIBLE.md`. Changing it rescales the whole world, so it
 * lives here and nowhere else.
 */
export const TILE_WIDTH = 64;

/** Height of one tile's diamond, in scene pixels. Half the width — 2:1 dimetric. */
export const TILE_HEIGHT = 32;

const HALF_TILE_WIDTH = TILE_WIDTH / 2;
const HALF_TILE_HEIGHT = TILE_HEIGHT / 2;

// --- grid <-> world ---------------------------------------------------------

/**
 * The centre of a grid cell, in world units.
 *
 * Cell `(3, 2)` spans world `[3,4) x [2,3)`, so its centre is `(3.5, 2.5)`.
 * Things that occupy a cell — a tree, a villager standing still — sit here.
 */
export function gridToWorld(cell: GridPoint): WorldPoint {
  return { wx: cell.gx + 0.5, wy: cell.gy + 0.5 };
}

/** The cell containing a world position. Truncates towards negative infinity. */
export function worldToGrid(point: WorldPoint): GridPoint {
  return { gx: Math.floor(point.wx), gy: Math.floor(point.wy) };
}

// --- world <-> scene (the projection itself) --------------------------------

/** Projects an un-projected world position into isometric scene pixels. */
export function worldToScene(point: WorldPoint): ScenePoint {
  return {
    px: (point.wx - point.wy) * HALF_TILE_WIDTH,
    py: (point.wx + point.wy) * HALF_TILE_HEIGHT,
  };
}

/**
 * Un-projects isometric scene pixels back into world units.
 *
 * The exact inverse of {@link worldToScene}, which is what makes tapping a tile
 * possible: the camera turns a touch into a scene point, and this turns that
 * into a world position.
 */
export function sceneToWorld(point: ScenePoint): WorldPoint {
  const halfWidths = point.px / HALF_TILE_WIDTH;
  const halfHeights = point.py / HALF_TILE_HEIGHT;
  return {
    wx: (halfHeights + halfWidths) / 2,
    wy: (halfHeights - halfWidths) / 2,
  };
}

// --- grid <-> scene (convenience) -------------------------------------------

/** Scene position of a grid cell's centre. */
export function gridToScene(cell: GridPoint): ScenePoint {
  return worldToScene(gridToWorld(cell));
}

/** The grid cell under a scene position. */
export function sceneToGrid(point: ScenePoint): GridPoint {
  return worldToGrid(sceneToWorld(point));
}

// --- bounds -----------------------------------------------------------------

/**
 * The scene-space rectangle enclosing a whole grid.
 *
 * A projected rectangle is a diamond, so its bounding box is wider than any
 * single edge: the west corner sits at `-height` tiles' worth of half-widths,
 * and the east corner at `+width`. Getting this wrong makes the camera clamp
 * before the map actually ends.
 */
export function gridBoundsToScene(gridWidth: number, gridHeight: number): SceneBounds {
  return {
    minX: -gridHeight * HALF_TILE_WIDTH,
    maxX: gridWidth * HALF_TILE_WIDTH,
    minY: 0,
    maxY: (gridWidth + gridHeight) * HALF_TILE_HEIGHT,
  };
}

/** `true` when the cell lies inside a `width x height` grid. */
export function isInsideGrid(cell: GridPoint, width: number, height: number): boolean {
  return cell.gx >= 0 && cell.gy >= 0 && cell.gx < width && cell.gy < height;
}
