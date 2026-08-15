/**
 * Coordinate space vocabulary.
 *
 * The project deliberately distinguishes three spaces. Mixing them up is the
 * most common source of bugs in an isometric game, so they get distinct types:
 *
 * - {@link GridPoint}  — logical simulation tiles (integers). Authoritative.
 * - {@link WorldPoint} — continuous world units, still un-projected.
 * - {@link ScreenPoint} — pixels inside the canvas / viewport.
 *
 * The isometric projection that maps world space onto screen space lands in a
 * single dedicated subsystem in Phase 2; nothing else may re-implement it.
 */

/** An integer cell in the logical simulation grid. */
export interface GridPoint {
  readonly gx: number;
  readonly gy: number;
}

/** A continuous position in world units (un-projected). */
export interface WorldPoint {
  readonly wx: number;
  readonly wy: number;
}

/** A position in viewport pixels. */
export interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

/** An axis-aligned rectangle in world units. */
export interface WorldBounds {
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
export function containsPoint(bounds: WorldBounds, point: WorldPoint): boolean {
  return (
    point.wx >= bounds.minX &&
    point.wx <= bounds.maxX &&
    point.wy >= bounds.minY &&
    point.wy <= bounds.maxY
  );
}
