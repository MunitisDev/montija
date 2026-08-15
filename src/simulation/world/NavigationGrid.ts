/**
 * Where villagers may walk, and how expensive each step is.
 *
 * Derived from the terrain today; from Phase 6 it will also account for
 * buildings occupying cells. Pathfinding reads this rather than the terrain
 * directly, so adding obstacles later touches one class instead of every
 * caller.
 *
 * Costs are stored pre-multiplied as integers to keep the A* inner loop free of
 * lookups into the terrain definitions.
 */

import { terrainDefinition } from '@/data/terrain';
import type { GridPoint } from '@/shared/types/geometry';
import type { TerrainGrid } from './TerrainGrid';

/** Cost scale: `movementCost` of 1 becomes this, so costs stay integral. */
export const COST_SCALE = 10;

/** Marks a cell nothing can enter. */
const BLOCKED = 0;

export class NavigationGrid {
  public readonly width: number;
  public readonly height: number;
  /** Entry cost per cell, or {@link BLOCKED}. */
  private readonly costs: Uint16Array;

  constructor(terrain: TerrainGrid) {
    this.width = terrain.width;
    this.height = terrain.height;
    this.costs = new Uint16Array(this.width * this.height);
    this.rebuild(terrain);
  }

  /** Recomputes every cell from the terrain. */
  public rebuild(terrain: TerrainGrid): void {
    terrain.forEach((gx, gy) => {
      this.refreshCell(terrain, gx, gy);
    });
  }

  /**
   * Recomputes a single cell.
   *
   * Called when terrain changes underfoot — felling a tree turns forest into
   * grass. A stale cost here would send villagers the long way round for the
   * rest of the game, so the two must never drift apart.
   */
  public refreshCell(terrain: TerrainGrid, gx: number, gy: number): void {
    if (!this.contains(gx, gy)) {
      return;
    }
    const definition = terrainDefinition(terrain.get(gx, gy));
    this.costs[gy * this.width + gx] = definition.walkable
      ? Math.max(1, Math.round(definition.movementCost * COST_SCALE))
      : BLOCKED;
  }

  public contains(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
  }

  /** `true` when a villager may occupy this cell. */
  public isWalkable(gx: number, gy: number): boolean {
    if (!this.contains(gx, gy)) {
      return false;
    }
    return (this.costs[gy * this.width + gx] ?? BLOCKED) !== BLOCKED;
  }

  /** Scaled cost of entering a cell. `0` means blocked. */
  public costAt(gx: number, gy: number): number {
    if (!this.contains(gx, gy)) {
      return BLOCKED;
    }
    return this.costs[gy * this.width + gx] ?? BLOCKED;
  }

  /** Blocks a cell — used by construction sites and buildings from Phase 6. */
  public block(gx: number, gy: number): void {
    if (this.contains(gx, gy)) {
      this.costs[gy * this.width + gx] = BLOCKED;
    }
  }

  /**
   * The nearest walkable cell to a target, searched outward in rings.
   *
   * Used for spawning and for "walk as close as you can" behaviour. Returns
   * `null` when nothing walkable exists within `maxRadius`.
   */
  public nearestWalkable(origin: GridPoint, maxRadius = 24): GridPoint | null {
    if (this.isWalkable(origin.gx, origin.gy)) {
      return origin;
    }

    for (let radius = 1; radius <= maxRadius; radius += 1) {
      // Walk the perimeter of the ring; the first hit is nearest by
      // Chebyshev distance, which is close enough for spawn placement.
      for (let offset = -radius; offset <= radius; offset += 1) {
        const candidates: GridPoint[] = [
          { gx: origin.gx + offset, gy: origin.gy - radius },
          { gx: origin.gx + offset, gy: origin.gy + radius },
          { gx: origin.gx - radius, gy: origin.gy + offset },
          { gx: origin.gx + radius, gy: origin.gy + offset },
        ];
        for (const candidate of candidates) {
          if (this.isWalkable(candidate.gx, candidate.gy)) {
            return candidate;
          }
        }
      }
    }

    return null;
  }
}
