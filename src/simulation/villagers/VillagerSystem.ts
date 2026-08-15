/**
 * Spawns villagers and moves them.
 *
 * Status: Phase 3. Villagers with nothing to do wander — pick a reachable cell
 * nearby, walk there, pause, repeat. That is a placeholder for the job system
 * in Phase 4, which will hand them real work instead. It exists so navigation
 * can be seen and tested independently of jobs.
 *
 * Two rules the brief is explicit about, both honoured here:
 *
 * - **Pathfinding does not run every frame.** A route is computed once, when a
 *   destination is chosen, and reused until it is finished or invalidated.
 * - **AI does not run every frame either.** Everything below happens on fixed
 *   simulation ticks, never in the render loop.
 *
 * Path requests are also budgeted per tick. With ten villagers that never
 * matters; at the two hundred the project is architected towards, letting every
 * idle villager search on the same tick would be a visible stall.
 */

import {
  FAMILY_NAMES,
  GIVEN_NAMES,
  VILLAGER_WALK_SPEED,
  WAYPOINT_TOLERANCE,
} from '@/data/villagers';
import { gridToWorld } from '@/shared/math/isometric';
import type { RandomSource } from '@/shared/math/random';
import type { GridPoint } from '@/shared/types/geometry';
import { findPath } from '@/simulation/pathfinding/AStar';
import type { NavigationGrid } from '@/simulation/world/NavigationGrid';
import { Villager } from './Villager';

/** Maximum A* searches started per tick, across all villagers. */
const PATH_REQUESTS_PER_TICK = 4;

/** How far an idle villager will pick a new spot to wander to, in cells. */
const WANDER_RADIUS = 12;

/** Ticks a villager rests on arrival before wandering again. */
const IDLE_TICKS_MIN = 10;
const IDLE_TICKS_MAX = 60;

/** Give up choosing a wander target after this many failed guesses. */
const WANDER_ATTEMPTS = 8;

export interface VillagerSystemStats {
  readonly pathRequests: number;
  readonly pathFailures: number;
  readonly walking: number;
  readonly idle: number;
}

export class VillagerSystem {
  private readonly villagers: Villager[] = [];
  private readonly navigation: NavigationGrid;
  private readonly random: RandomSource;
  private nextId = 1;

  private totalPathRequests = 0;
  private totalPathFailures = 0;

  constructor(navigation: NavigationGrid, random: RandomSource) {
    this.navigation = navigation;
    this.random = random;
  }

  public get all(): readonly Villager[] {
    return this.villagers;
  }

  public get count(): number {
    return this.villagers.length;
  }

  public stats(): VillagerSystemStats {
    let walking = 0;
    for (const villager of this.villagers) {
      if (villager.activity === 'walking') {
        walking += 1;
      }
    }
    return {
      pathRequests: this.totalPathRequests,
      pathFailures: this.totalPathFailures,
      walking,
      idle: this.villagers.length - walking,
    };
  }

  /**
   * Places villagers on walkable ground around a point.
   *
   * @returns how many were actually placed; fewer than requested if the area
   *   has no room, which the caller should notice rather than assume success.
   */
  public spawnNear(origin: GridPoint, count: number): number {
    let placed = 0;

    for (let i = 0; i < count; i += 1) {
      const cell = this.findSpawnCell(origin);
      if (!cell) {
        break;
      }

      this.villagers.push(
        new Villager({
          id: this.nextId,
          name: this.makeName(),
          // A founding settlement is adults, not children.
          age: this.random.int(18, 46),
          position: gridToWorld(cell),
        }),
      );
      this.nextId += 1;
      placed += 1;
    }

    return placed;
  }

  /** Advances every villager by one fixed tick. */
  public update(tickSeconds: number): void {
    let pathBudget = PATH_REQUESTS_PER_TICK;

    for (const villager of this.villagers) {
      villager.previousPosition = villager.position;

      if (villager.isMoving) {
        this.advanceAlongPath(villager, tickSeconds);
        continue;
      }

      villager.activity = 'idle';

      if (villager.idleTicks > 0) {
        villager.idleTicks -= 1;
        continue;
      }

      if (pathBudget > 0) {
        pathBudget -= 1;
        this.chooseWanderTarget(villager);
      }
    }
  }

  /** Nearest villager to a cell, within `radius`. Used for tap selection. */
  public findNear(cell: GridPoint, radius = 1.5): Villager | null {
    let best: Villager | null = null;
    let bestDistance = radius;

    for (const villager of this.villagers) {
      const dx = villager.position.wx - (cell.gx + 0.5);
      const dy = villager.position.wy - (cell.gy + 0.5);
      const distance = Math.hypot(dx, dy);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = villager;
      }
    }

    return best;
  }

  public findById(id: number): Villager | null {
    return this.villagers.find((villager) => villager.id === id) ?? null;
  }

  /**
   * Moves a villager along its path.
   *
   * Consumes as many waypoints as the tick's travel budget allows, so a fast
   * villager or a slow tick rate never causes stuttering between cells.
   */
  private advanceAlongPath(villager: Villager, tickSeconds: number): void {
    villager.activity = 'walking';
    let remaining = VILLAGER_WALK_SPEED * tickSeconds;

    while (remaining > 0 && villager.path.length > 0) {
      const waypoint = villager.path[0];
      if (!waypoint) {
        break;
      }

      const target = gridToWorld(waypoint);
      const dx = target.wx - villager.position.wx;
      const dy = target.wy - villager.position.wy;
      const distance = Math.hypot(dx, dy);

      if (distance <= remaining + WAYPOINT_TOLERANCE) {
        villager.position = target;
        villager.path.shift();
        remaining -= distance;
        continue;
      }

      villager.position = {
        wx: villager.position.wx + (dx / distance) * remaining,
        wy: villager.position.wy + (dy / distance) * remaining,
      };
      remaining = 0;
    }

    if (villager.path.length === 0) {
      villager.destination = null;
      villager.activity = 'idle';
      villager.idleTicks = this.random.int(IDLE_TICKS_MIN, IDLE_TICKS_MAX);
    }
  }

  /** Picks a nearby reachable cell and routes to it. */
  private chooseWanderTarget(villager: Villager): void {
    const from = villager.cell;

    for (let attempt = 0; attempt < WANDER_ATTEMPTS; attempt += 1) {
      const target: GridPoint = {
        gx: from.gx + this.random.int(-WANDER_RADIUS, WANDER_RADIUS + 1),
        gy: from.gy + this.random.int(-WANDER_RADIUS, WANDER_RADIUS + 1),
      };

      if (!this.navigation.isWalkable(target.gx, target.gy)) {
        continue;
      }
      if (target.gx === from.gx && target.gy === from.gy) {
        continue;
      }

      this.totalPathRequests += 1;
      const result = findPath(this.navigation, from, target);

      if (result.path && result.path.length > 0) {
        villager.path = result.path;
        villager.destination = target;
        villager.activity = 'walking';
        return;
      }

      this.totalPathFailures += 1;
    }

    // Nowhere to go right now — rest and try again shortly rather than
    // hammering the pathfinder every tick.
    villager.idleTicks = this.random.int(IDLE_TICKS_MIN, IDLE_TICKS_MAX);
  }

  private findSpawnCell(origin: GridPoint): GridPoint | null {
    // Try a scattered spot first so the founders do not stand in one stack.
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate: GridPoint = {
        gx: origin.gx + this.random.int(-6, 7),
        gy: origin.gy + this.random.int(-6, 7),
      };
      if (this.navigation.isWalkable(candidate.gx, candidate.gy)) {
        return candidate;
      }
    }

    // Fall back to a deterministic outward search so spawning cannot fail
    // merely because the random attempts were unlucky.
    return this.navigation.nearestWalkable(origin);
  }

  private makeName(): string {
    const given = this.random.pick(GIVEN_NAMES) ?? 'Villager';
    const family = this.random.pick(FAMILY_NAMES) ?? 'Of the Vale';
    return `${given} ${family}`;
  }
}
