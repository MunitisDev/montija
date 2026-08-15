/**
 * Isometric draw order.
 *
 * **The single source of depth values.** No gameplay or rendering code may
 * assign a depth by hand; hand-tuned z-indexes are how isometric scenes end up
 * with a villager standing inside a wall.
 *
 * The rule: things further from the camera draw first. In this projection
 * "further back" means a smaller `gx + gy`, because both axes run towards the
 * viewer. Within one cell, {@link RenderLayer} decides what stacks on top.
 */

/** What sits on top of what, within a single cell. */
export enum RenderLayer {
  /** Ground tiles. */
  Terrain = 0,
  /** Flat markings painted onto the ground: roads, designations, ghosts. */
  Overlay = 1,
  /** Loose resources lying on the ground. */
  ResourcePile = 2,
  /** Trees, buildings — anything with height. */
  Structure = 3,
  /** Villagers, so they pass in front of the object they are working on. */
  Character = 4,
  /** Smoke, weather, selection rings. */
  Effect = 5,
}

/**
 * Depth granularity per cell.
 *
 * Must exceed the largest {@link RenderLayer}, with room to spare so that
 * inserting a layer later does not require re-tuning every call site.
 */
const LAYER_SPAN = 16;

/**
 * The depth for something occupying a single cell.
 *
 * @param gx grid column
 * @param gy grid row
 * @param layer what it is, within that cell
 */
export function depthFor(gx: number, gy: number, layer: RenderLayer): number {
  return (gx + gy) * LAYER_SPAN + layer;
}

/**
 * The depth for something occupying several cells, such as a 2x2 house.
 *
 * Sorts by the footprint's front-most corner. Using the origin corner instead
 * would let a villager standing beside a large building incorrectly draw behind
 * it, because the building's far corner sorts earlier than the villager.
 *
 * @param gx origin column of the footprint
 * @param gy origin row of the footprint
 * @param width footprint width in cells
 * @param height footprint height in cells
 */
export function depthForFootprint(
  gx: number,
  gy: number,
  width: number,
  height: number,
  layer: RenderLayer,
): number {
  return depthFor(gx + width - 1, gy + height - 1, layer);
}
