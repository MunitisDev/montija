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
import { ROAD_COST_MULTIPLIER, type RoadGrid } from './RoadGrid';
import type { TerrainGrid } from './TerrainGrid';

/** Cost scale: `movementCost` of 1 becomes this, so costs stay integral. */
export const COST_SCALE = 10;

/** The cheapest a step can be once a road is laid. */
const PAVED_ENTRY_COST = Math.max(1, Math.round(ROAD_COST_MULTIPLIER * COST_SCALE));

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

  /**
   * Roads laid over the terrain, or `null` before any exist.
   *
   * Held rather than folded into the costs at build time, so that lifting a
   * road gives back the ground underneath instead of a guess at what was there.
   */
  private roads: RoadGrid | null = null;

  /** Points the grid at the settlement's roads, and re-costs every cell. */
  public useRoads(roads: RoadGrid, terrain: TerrainGrid): void {
    this.roads = roads;
    this.rebuild(terrain);
  }

  /**
   * The cheapest a single step could possibly be on this grid right now.
   *
   * A*'s heuristic must never overestimate what remains, or the search stops
   * being optimal and returns whichever route it reached first — which, with
   * roads, means walking across a field past the road beside it. So the
   * heuristic has to be priced at the cheapest step available.
   *
   * Reported as a live figure rather than a constant because a weaker heuristic
   * expands more nodes, and a settlement that has never laid a road should not
   * pay for one. Until the first is finished this is exactly what it always
   * was, and every path is found on exactly the terms it used to be.
   */
  public get minEntryCost(): number {
    return this.roads !== null && this.roads.count > 0 ? PAVED_ENTRY_COST : COST_SCALE;
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
    if (!definition.walkable) {
      this.costs[gy * this.width + gx] = BLOCKED;
      return;
    }

    // A road makes the step cheaper, so pathfinding prefers it without any
    // special case in the search itself — the cost model was already there.
    const surface = this.roads?.has(gx, gy) === true ? ROAD_COST_MULTIPLIER : 1;
    this.costs[gy * this.width + gx] = Math.max(
      1,
      Math.round(definition.movementCost * surface * COST_SCALE),
    );
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
