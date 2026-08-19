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

/**
 * The eight ways off a cell.
 *
 * Eight because that is what both the region map and the pathfinder use: a
 * connectivity test that disagreed with the pathfinder would refuse placements
 * that are fine, or allow ones that are not.
 */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/**
 * `true` when a step from one cell to a neighbour is one a villager can take.
 *
 * **The rule that has to match the pathfinder exactly.** `AStar` forbids cutting
 * a corner: a diagonal step is legal only when *both* orthogonal cells it passes
 * between are clear, because the looser rule reads as walking through a wall. So
 * a purely diagonal gap is impassable — and the region map used to count it as a
 * way through.
 *
 * That mismatch was the most expensive bug this project has had. `connects` said
 * two cells were joined; every route between them failed after burning the whole
 * node budget; villagers claimed errands they could not finish, dropped their
 * loads and were handed the same errand again. Measured on a settlement of fifty:
 * **twenty-nine thousand** material errands completed carrying nothing, nineteen
 * sites had not moved in a hundred days, and the ground filled with heaps nobody
 * could deliver. It also quietly broke everything built on top of `connects` —
 * the sealed-pocket rule, the rescue for stranded villagers, the check that stops
 * a villager claiming work across a wall.
 *
 * `blocked` is ground that is about to close: see {@link NavigationGrid.wouldSeal}.
 */
function stepAllowed(
  passable: (gx: number, gy: number) => boolean,
  gx: number,
  gy: number,
  dx: number,
  dy: number,
): boolean {
  if (dx === 0 || dy === 0) {
    return true;
  }
  return passable(gx + dx, gy) && passable(gx, gy + dy);
}

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
   * Which connected patch of walkable ground each cell belongs to.
   *
   * **The river made this necessary.** Before it, everything walkable was one
   * piece and a route always existed; A* proved that by finding it. A river
   * splits the map in two until somebody builds a bridge, and then every job on
   * the far bank costs a full four-thousand-node search to discover it is
   * unreachable — per villager, per attempt, for ever. A settlement looked
   * frozen while it did nothing but fail to find routes.
   *
   * Rebuilt lazily, and only when a cell's walkability actually flips: felling a
   * tree changes what a step costs but not what connects to what, and the great
   * majority of grid changes are of that kind.
   */
  private regions: Int32Array | null = null;
  /** Cells per region, built with the region map and thrown away with it. */
  private regionSizes: Map<number, number> | null = null;
  private structure = 0;

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
    this.regions = null;
    this.regionSizes = null;
    this.structure += 1;
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
    const index = gy * this.width + gx;
    const was = (this.costs[index] ?? BLOCKED) !== BLOCKED;
    const definition = terrainDefinition(terrain.get(gx, gy));
    const paved = this.roads?.has(gx, gy) === true;

    if (!definition.walkable) {
      // **A bridge is a road laid over water.** Nothing else can make an
      // unwalkable cell crossable: rock stays rock however many boards are put
      // on it, and the terrain says which is which.
      this.costs[index] = paved && definition.spannable ? PAVED_ENTRY_COST : BLOCKED;
      this.noteStructure(was, index);
      return;
    }

    // A road makes the step cheaper, so pathfinding prefers it without any
    // special case in the search itself — the cost model was already there.
    const surface = paved ? ROAD_COST_MULTIPLIER : 1;
    this.costs[index] = Math.max(1, Math.round(definition.movementCost * surface * COST_SCALE));
    this.noteStructure(was, index);
  }

  /** Throws the region map away when a cell's walkability has just flipped. */
  private noteStructure(wasWalkable: boolean, index: number): void {
    const now = (this.costs[index] ?? BLOCKED) !== BLOCKED;
    if (wasWalkable !== now) {
      this.regions = null;
      this.regionSizes = null;
      this.structure += 1;
    }
  }

  /**
   * Bumped whenever what-connects-to-what may have changed.
   *
   * Anything caching an answer about reachability can hold it against this
   * number: villagers walk about constantly, but the *shape* of the walkable
   * ground changes only when a wall goes up, a bridge is finished or a channel is
   * cut.
   */
  public get structureVersion(): number {
    return this.structure;
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
    if (!this.contains(gx, gy)) {
      return;
    }
    const index = gy * this.width + gx;
    const was = (this.costs[index] ?? BLOCKED) !== BLOCKED;
    this.costs[index] = BLOCKED;
    this.noteStructure(was, index);
  }

  /**
   * Which patch of connected ground a cell belongs to, or `-1` where nobody can
   * stand.
   *
   * Cells share a number exactly when a villager could walk between them. That
   * is the whole question a failed path answers, and answering it here costs
   * one array read instead of a search across the map.
   */
  public regionAt(gx: number, gy: number): number {
    if (!this.contains(gx, gy)) {
      return -1;
    }
    const regions = this.regions ?? this.mapRegions();
    return regions[gy * this.width + gx] ?? -1;
  }

  /**
   * `true` when blocking these cells would cut the ground into pieces.
   *
   * **The rule that stops a settlement walling itself in.** Buildings block
   * their footprints, and four of them raised shoulder to shoulder leave a yard
   * between them with no way out. Measured on an ordinary opening: by day
   * twenty-four every villager in the settlement *and* its only store were
   * sealed into a four-cell pocket, nobody could reach a job or a pile again,
   * and they starved with three hundred food on the ground and the works
   * reported stopped for want of timber. A player who has just placed a house
   * has no way to see that coming, so the game has to refuse.
   *
   * The test is local and exact. Blocking a set can only separate two cells if
   * they were joined *only* through that set — so it is enough to ask whether
   * every walkable neighbour of the footprint still reaches every other one once
   * the footprint is gone. If they do, any route that went through it can go
   * round it, and nothing anywhere is cut off.
   *
   * The search is a flood fill that stops the moment it has found all of them,
   * which for an ordinary plot in open ground is a dozen cells.
   */
  public wouldSeal(cells: readonly GridPoint[], alsoBlocked: readonly GridPoint[] = []): boolean {
    const inside = new Set(cells.map((cell) => cell.gy * this.width + cell.gx));
    // **Ground that is about to close but has not closed yet.** A construction
    // site does not block traffic while it is being built — deliberately, so
    // haulers can reach it — so two placements can each pass this test on its
    // own and seal a pocket between them the day they both finish. Measured: a
    // settlement of fifty-eight had thirty-one of its people in a four-cell yard
    // and a one-cell hole, both walled in by pairs of houses raised side by side.
    const pending = new Set(alsoBlocked.map((cell) => cell.gy * this.width + cell.gx));
    const closed = (index: number): boolean => inside.has(index) || pending.has(index);

    // The walkable ring around the footprint, which is what has to stay joined.
    /** Ground somebody could stand on once this plot is built. */
    const open = (gx: number, gy: number): boolean =>
      this.isWalkable(gx, gy) && !closed(gy * this.width + gx);

    const ring: number[] = [];
    for (const cell of cells) {
      for (const [dx, dy] of NEIGHBOURS) {
        const gx = cell.gx + dx;
        const gy = cell.gy + dy;
        if (!open(gx, gy)) {
          continue;
        }
        const index = gy * this.width + gx;
        if (closed(index) || ring.includes(index)) {
          continue;
        }
        ring.push(index);
      }
    }
    if (ring.length <= 1) {
      // Nothing, or one cell: there is no pair to separate. A plot with no
      // walkable ground beside it at all is refused elsewhere, for being
      // unreachable.
      return false;
    }

    const wanted = new Set(ring);
    const start = ring[0]!;
    wanted.delete(start);

    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length > 0 && wanted.size > 0) {
      const index = queue.pop()!;
      const gx = index % this.width;
      const gy = (index - gx) / this.width;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (!open(nx, ny)) {
          continue;
        }
        // The same corner rule the pathfinder uses, against the map as it will
        // be once this plot is built: a diagonal squeeze is not a way round.
        if (!stepAllowed(open, gx, gy, dx, dy)) {
          continue;
        }
        const next = ny * this.width + nx;
        if (seen.has(next)) {
          continue;
        }
        seen.add(next);
        wanted.delete(next);
        queue.push(next);
      }
    }

    return wanted.size > 0;
  }

  /**
   * How many cells belong to a region, or `0` for none.
   *
   * **What tells a settlement from a pocket.** Asking whether a region holds one
   * of the settlement's stores is not enough: a four-cell yard walled in between
   * four houses had a store's doorway inside it, so it looked like part of the
   * settlement and the thirty people trapped in it were never rescued. Size is a
   * structural fact and cannot be argued with.
   *
   * Counted off the same region map every other question uses, and cached with
   * it, so this costs one array read after the first call.
   */
  public regionCellCount(region: number): number {
    if (region < 0) {
      return 0;
    }
    if (!this.regionSizes || !this.regions) {
      this.regions ??= this.mapRegions();
      const sizes = new Map<number, number>();
      for (const at of this.regions) {
        if (at >= 0) {
          sizes.set(at, (sizes.get(at) ?? 0) + 1);
        }
      }
      this.regionSizes = sizes;
    }
    return this.regionSizes.get(region) ?? 0;
  }

  /** `true` when a villager standing on one cell could reach the other. */
  public connects(from: GridPoint, to: GridPoint): boolean {
    const region = this.regionAt(from.gx, from.gy);
    return region >= 0 && region === this.regionAt(to.gx, to.gy);
  }

  /**
   * Flood-fills the walkable ground into numbered patches.
   *
   * Eight-way, to match how villagers actually step: a diagonal gap between two
   * ponds is a route, and calling it a wall here would have the settlement
   * refuse work it could plainly do.
   *
   * An explicit stack rather than recursion — a map is tens of thousands of
   * cells and one patch of open country would blow the call stack.
   */
  private mapRegions(): Int32Array {
    const regions = new Int32Array(this.width * this.height).fill(-1);
    const stack: number[] = [];
    let next = 0;

    for (let start = 0; start < regions.length; start += 1) {
      if (regions[start] !== -1 || (this.costs[start] ?? BLOCKED) === BLOCKED) {
        continue;
      }
      const region = next;
      next += 1;
      regions[start] = region;
      stack.push(start);

      while (stack.length > 0) {
        const index = stack.pop() as number;
        const gx = index % this.width;
        const gy = (index - gx) / this.width;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) {
              continue;
            }
            // The pathfinder will not cut this corner, so neither may the map
            // that claims to say what the pathfinder can do. See `stepAllowed`.
            if (!stepAllowed((x, y) => this.isWalkable(x, y), gx, gy, dx, dy)) {
              continue;
            }
            const neighbour = ny * this.width + nx;
            if (regions[neighbour] !== -1 || (this.costs[neighbour] ?? BLOCKED) === BLOCKED) {
              continue;
            }
            regions[neighbour] = region;
            stack.push(neighbour);
          }
        }
      }
    }

    this.regions = regions;
    return regions;
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
