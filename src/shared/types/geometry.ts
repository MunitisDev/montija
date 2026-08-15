/**
 * Coordinate space vocabulary.
 *
 * Four spaces, each with its own type and its own field names. Confusing them
 * is the classic isometric-game bug, so the compiler is made to catch it: no
 * two spaces share a field name, which means a value from the wrong space
 * cannot be passed by accident.
 *
 * ```text
 * GridPoint   (gx, gy)   integer tiles          authoritative simulation space
 *     │  gridToWorld / worldToGrid
 * WorldPoint  (wx, wy)   continuous tiles       un-projected, still "flat"
 *     │  worldToScene / sceneToWorld            ← the isometric projection
 * ScenePoint  (px, py)   projected pixels       what Phaser positions objects at
 *     │  sceneToViewport / viewportToScene      ← the camera (pan and zoom)
 * ScreenPoint (sx, sy)   viewport pixels        what the player touches
 * ```
 *
 * Every conversion in the top three rows lives in `shared/math/isometric.ts`.
 * The bottom row belongs to the camera. Nothing else may re-implement either.
 */

/** An integer cell in the logical simulation grid. Authoritative. */
export interface GridPoint {
  readonly gx: number;
  readonly gy: number;
}

/**
 * A continuous position in world units, un-projected.
 *
 * One world unit is one grid cell, so `{ wx: 3.5, wy: 2.0 }` is the middle of
 * the top edge of cell `(3, 2)`. Villagers move through this space.
 */
export interface WorldPoint {
  readonly wx: number;
  readonly wy: number;
}

/**
 * A position in isometric scene pixels.
 *
 * This is the space Phaser game objects live in, and the space the camera pans
 * and zooms over. It is already projected, but not yet offset by the camera.
 */
export interface ScenePoint {
  readonly px: number;
  readonly py: number;
}

/** A position in viewport pixels — where a finger or cursor actually is. */
export interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

/** An axis-aligned rectangle in isometric scene pixels. */
export interface SceneBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Viewport dimensions in pixels. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** `true` when the point lies inside the bounds (edges included). */
export function containsScenePoint(bounds: SceneBounds, point: ScenePoint): boolean {
  return (
    point.px >= bounds.minX &&
    point.px <= bounds.maxX &&
    point.py >= bounds.minY &&
    point.py <= bounds.maxY
  );
}
