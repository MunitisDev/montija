/**
 * Spawns villagers, gives them work, and moves them.
 *
 * Status: Phase 4. The loop the brief describes is now real:
 *
 * ```text
 * idle ─▶ ask the job board ─▶ reserve ─▶ travel ─▶ perform ─▶ complete ─▶ idle
 *   └────────────── no work available: wander instead ──────────────────┘
 * ```
 *
 * Wandering is the fallback, not the purpose. It exists so a settlement with
 * nothing designated still looks alive.
 *
 * Two rules the brief is explicit about, both honoured here:
 *
 * - **Pathfinding does not run every frame.** A route is computed once, when a
 *   destination is chosen, and reused until it is finished or invalidated.
 * - **AI does not run every frame either.** Everything below happens on fixed
 *   simulation ticks, never in the render loop.
 *
 * Path requests are budgeted per tick. With ten villagers that never matters;
 * at the two hundred the project is architected towards, letting every idle
 * villager search on the same tick would be a visible stall.
 */

import {
  FAMILY_NAMES,
  GIVEN_NAMES,
  VILLAGER_WALK_SPEED,
  WAYPOINT_TOLERANCE,
} from '@/data/villagers';
import { gridToWorld } from '@/shared/math/isometric';
import type { RandomState, SeededRandom } from '@/shared/math/random';
import type { GridPoint } from '@/shared/types/geometry';
import { recipe as findRecipe } from '@/data/recipes';
import { resourceDefinition, type ResourceId } from '@/data/resources';
import type { Job } from '@/simulation/jobs/Job';
import type { JobManager } from '@/simulation/jobs/JobManager';
import type { StorageRegistry } from '@/simulation/logistics/Storage';
import { findPath } from '@/simulation/pathfinding/AStar';
import type { World } from '@/simulation/world/World';
import { Villager } from './Villager';

/** Maximum A* searches started per tick, across all villagers. */
const PATH_REQUESTS_PER_TICK = 4;

/** How far an idle villager will pick a new spot to wander to, in cells. */
const WANDER_RADIUS = 12;

/** Ticks a villager rests on arrival before looking for work again. */
const IDLE_TICKS_MIN = 10;
const IDLE_TICKS_MAX = 60;

/** Give up choosing a wander target after this many failed guesses. */
const WANDER_ATTEMPTS = 8;


/** Neighbours checked when looking for somewhere to stand next to a job. */
const ADJACENT: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

export interface VillagerSystemStats {
  readonly pathRequests: number;
  readonly pathFailures: number;
  readonly walking: number;
  readonly working: number;
  readonly idle: number;
  readonly employed: number;
}

export class VillagerSystem {
  private readonly villagers: Villager[] = [];
  private readonly world: World;
  private readonly jobs: JobManager;
  private readonly storages: StorageRegistry;
  private readonly random: SeededRandom;
  private nextId = 1;

  private totalPathRequests = 0;
  private totalPathFailures = 0;

  constructor(world: World, jobs: JobManager, storages: StorageRegistry, random: SeededRandom) {
    this.world = world;
    this.jobs = jobs;
    this.storages = storages;
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
    let working = 0;
    let employed = 0;
    for (const villager of this.villagers) {
      if (villager.activity === 'walking' || villager.activity === 'hauling') {
        walking += 1;
      } else if (villager.activity === 'working') {
        working += 1;
      }
      if (villager.currentJobId !== null) {
        employed += 1;
      }
    }
    return {
      pathRequests: this.totalPathRequests,
      pathFailures: this.totalPathFailures,
      walking,
      working,
      idle: this.villagers.length - walking - working,
      employed,
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

      if (villager.currentJobId !== null) {
        this.workOnJob(villager);
        continue;
      }

      if (villager.idleTicks > 0) {
        villager.activity = 'idle';
        villager.idleTicks -= 1;
        continue;
      }

      villager.activity = 'idle';
      if (pathBudget <= 0) {
        continue;
      }
      pathBudget -= 1;

      // Real work first; wandering is only what they do when there is none.
      if (!this.tryTakeJob(villager)) {
        this.chooseWanderTarget(villager);
      }
    }
  }

  /**
   * The RNG's exact position in its sequence.
   *
   * Saved and restored, or a loaded settlement makes different choices from
   * the one that was saved — the villagers wander elsewhere, pick different
   * jobs, and the two simulations quietly drift apart.
   */
  public get randomState(): RandomState {
    return this.random.getState();
  }

  public restoreRandomState(state: RandomState): void {
    this.random.setState(state);
  }

  /** Replaces the population from a save. */
  public restore(villagers: Villager[]): void {
    this.villagers.length = 0;
    this.villagers.push(...villagers);
    this.nextId = villagers.reduce((highest, v) => Math.max(highest, v.id + 1), 1);
  }

  /**
   * Nearest villager to a cell, within `radius`.
   *
   * The default is deliberately tight — just over half a cell — so only someone
   * genuinely standing on the tapped tile is picked. A generous radius made
   * villagers hijack taps aimed at the tree beside them.
   */
  public findNear(cell: GridPoint, radius = 0.75): Villager | null {
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

  /**
   * Removes a villager from the settlement.
   *
   * Any job they were holding goes back on the board rather than being lost
   * with them, so a death does not silently abandon work.
   */
  public remove(id: number): boolean {
    const index = this.villagers.findIndex((villager) => villager.id === id);
    if (index < 0) {
      return false;
    }

    const [villager] = this.villagers.splice(index, 1);
    if (villager?.currentJobId !== null && villager?.currentJobId !== undefined) {
      this.jobs.release(villager.currentJobId);
    }
    // Whatever they were carrying falls where they stood.
    if (villager) {
      for (const { resource, amount } of villager.inventory.contents) {
        const dropped = this.world.piles.drop(villager.cell, resource, amount);
        villager.inventory.remove(resource, dropped);
      }
    }
    return true;
  }

  public findById(id: number): Villager | null {
    return this.villagers.find((villager) => villager.id === id) ?? null;
  }

  // --- jobs ----------------------------------------------------------------

  /**
   * Claims a job and routes to it.
   *
   * @returns `true` when the villager now has work
   */
  private tryTakeJob(villager: Villager): boolean {
    const job = this.jobs.claimBest(villager.id, villager.cell);
    if (!job) {
      return false;
    }

    const standing = this.findWorkingPosition(villager, job);
    if (!standing) {
      // Unreachable — hand it back rather than holding a job nobody can do.
      this.jobs.release(job.id);
      this.totalPathFailures += 1;
      return false;
    }

    villager.currentJobId = job.id;

    if (standing.path.length === 0) {
      // Already in position; start working this tick.
      villager.activity = 'working';
      this.jobs.beginWork(job.id);
      return true;
    }

    villager.path = standing.path;
    villager.destination = standing.cell;
    villager.activity = 'walking';
    return true;
  }

  /** Performs one tick of work on the villager's current job. */
  private workOnJob(villager: Villager): void {
    const job = villager.currentJobId === null ? null : this.jobs.get(villager.currentJobId);

    if (!job || job.assignedVillager !== villager.id) {
      // Cancelled or reassigned underneath us — go back to looking for work.
      villager.currentJobId = null;
      villager.activity = 'idle';
      return;
    }

    this.jobs.beginWork(job.id);
    villager.activity = job.type === 'haul' ? 'hauling' : 'working';

    if (job.type === 'haul') {
      if (!this.advanceHaul(villager, job)) {
        // Loaded up; the next leg is a walk to the storage yard.
        this.routeToCurrentStage(villager, job);
        return;
      }
    } else {
      job.workRemaining -= 1;
      this.recordBuildProgress(job);
      if (job.workRemaining > 0) {
        return;
      }
      this.finishJob(job);
    }
    this.jobs.complete(job.id);
    villager.currentJobId = null;
    villager.activity = 'idle';
    villager.idleTicks = this.random.int(2, 8);
  }

  /** Where the villager needs to be for the job's current stage. */
  private jobDestination(job: Job): GridPoint | null {
    return job.stage === 'deliver' ? job.deliverTo : job.target;
  }

  /**
   * Runs one batch of a building's recipe.
   *
   * Inputs are consumed from what was physically carried in, and outputs are
   * **dropped on the ground** beside the building rather than teleported into
   * storage. A hauler then carries them in, exactly as with felled logs. That
   * consistency is the point: production is another source of physical goods,
   * not a shortcut past the logistics.
   */
  private runRecipe(job: Job): void {
    const building =
      job.targetEntityId === null ? null : this.world.buildings.getById(job.targetEntityId);
    if (!building || !building.definition.recipeId) {
      return;
    }

    const recipe = findRecipe(building.definition.recipeId);
    if (!recipe) {
      return;
    }

    // Take the inputs. If they are not all there, the batch is abandoned
    // rather than producing something out of nothing.
    for (const ingredient of recipe.inputs) {
      if (building.input.count(ingredient.resource) < ingredient.amount) {
        return;
      }
    }
    for (const ingredient of recipe.inputs) {
      building.input.remove(ingredient.resource, ingredient.amount);
    }

    const yieldScale = this.productionScale(recipe.seasonal);
    for (const output of recipe.outputs) {
      const amount = Math.max(0, Math.round(output.amount * yieldScale));
      if (amount > 0) {
        this.world.piles.drop(building.accessCell, output.resource, amount);
      }
    }
    this.world.buildings.markChanged();
  }

  /**
   * Season multiplier for gathered goods.
   *
   * Overridden by the simulation once seasons exist; 1 means "no seasons yet",
   * which keeps Phase 7 independent of Phase 8.
   */
  public productionScaleProvider: (() => number) | null = null;

  private productionScale(seasonal: boolean): number {
    if (!seasonal || !this.productionScaleProvider) {
      return 1;
    }
    return this.productionScaleProvider();
  }

  /** Ticks of build progress are recorded on the building as well as the job. */
  private recordBuildProgress(job: Job): void {
    if (job.type !== 'build' || job.targetEntityId === null) {
      return;
    }
    const building = this.world.buildings.getById(job.targetEntityId);
    if (building && building.buildTicksRemaining > 0) {
      building.buildTicksRemaining -= 1;
      this.world.buildings.markChanged();
    }
  }

  /** Applies a completed job's effect on the world. */
  private finishJob(job: Job): void {
    switch (job.type) {
      case 'chop-tree':
        if (job.targetEntityId !== null) {
          this.world.fellTree(job.targetEntityId);
        }
        break;
      case 'gather-stone':
        this.world.mineStone(job.target);
        break;
      case 'build': {
        const building =
          job.targetEntityId === null ? null : this.world.buildings.getById(job.targetEntityId);
        if (building) {
          this.world.buildings.complete(this.world, building);
        }
        break;
      }
      case 'produce':
        this.runRecipe(job);
        break;
      case 'haul':
      case 'move-to':
        // Handled by the haul state machine, or arriving is the whole job.
        break;
    }
  }

  /**
   * Advances a haul job that has reached its current destination.
   *
   * Two legs: load from the pile, then unload into storage. Resources move
   * between real inventories at each step — nothing is created, and if the
   * destination cannot take everything, the remainder stays with the villager
   * rather than evaporating.
   *
   * @returns `true` when the whole haul is finished
   */
  private advanceHaul(villager: Villager, job: Job): boolean {
    if (job.stage === 'collect') {
      const loaded =
        job.haulSource === 'storage'
          ? this.loadFromStorage(villager, job)
          : this.loadFromPile(villager, job);

      if (!loaded) {
        // Somebody got there first, or the stock ran out. Nothing to carry.
        return true;
      }

      job.stage = 'deliver';
      villager.activity = 'hauling';
      return false;
    }

    // Delivering. A construction site takes materials the same way a yard takes
    // goods — same inventories, same transfer, so "villagers physically deliver
    // construction materials" is enforced rather than merely intended.
    const destination = this.deliveryInventory(job.deliverTo);
    if (destination) {
      villager.inventory.transferAll(destination);
      this.storages.markChanged();
      this.world.buildings.markChanged();
    }

    if (!villager.inventory.isEmpty) {
      // The yard filled up mid-delivery. Put the remainder back on the ground
      // rather than deleting it — resources must never simply vanish.
      for (const { resource, amount } of villager.inventory.contents) {
        const dropped = this.world.piles.drop(villager.cell, resource, amount);
        villager.inventory.remove(resource, dropped);
      }
    }

    return true;
  }

  /** Loads from a pile on the ground. Returns `false` when there was nothing. */
  private loadFromPile(villager: Villager, job: Job): boolean {
    const pile = job.targetEntityId === null ? null : this.world.piles.getById(job.targetEntityId);
    if (!pile || pile.isEmpty) {
      return false;
    }

    const carryLimit = resourceDefinition(pile.resource).carryLimit;
    const room = Math.min(carryLimit, villager.inventory.freeSpace);
    pile.inventory.transfer(villager.inventory, pile.resource, room);
    this.world.piles.removeIfEmpty(pile.id);

    return !villager.inventory.isEmpty;
  }

  /**
   * Loads construction materials out of a storage yard.
   *
   * Takes only what the site still needs, so a builder does not strip the yard
   * and then carry the surplus back again.
   */
  private loadFromStorage(villager: Villager, job: Job): boolean {
    if (!job.haulResource || !job.deliverTo) {
      return false;
    }

    const storage = this.storages.all.find(
      (candidate) => candidate.cell.gx === job.target.gx && candidate.cell.gy === job.target.gy,
    );
    if (!storage) {
      return false;
    }

    const needed = this.amountNeededAt(job.deliverTo, job.haulResource);
    if (needed <= 0) {
      return false;
    }

    const carryLimit = resourceDefinition(job.haulResource).carryLimit;
    const room = Math.min(carryLimit, villager.inventory.freeSpace, needed);
    storage.inventory.transfer(villager.inventory, job.haulResource, room);
    this.storages.markChanged();

    return !villager.inventory.isEmpty;
  }

  /**
   * What accepts a delivery at a cell.
   *
   * Buildings are checked before yards, because a workshop or site standing
   * next to a yard must receive what was routed to it. An unfinished building
   * takes construction materials; a finished one takes recipe inputs. They are
   * separate stores so a woodcutter's logs are never mistaken for its walls.
   */
  private deliveryInventory(cell: GridPoint | null) {
    if (!cell) {
      return null;
    }

    const building = this.buildingAtAccess(cell);
    // A finished yard shares its doorway with the storage it opened, and the
    // building must not answer for it: goods delivered to a Food Storage were
    // landing in the building's recipe-input buffer instead of its shelves,
    // where nothing could ever eat them. A yard still under construction is a
    // different matter — it takes its own materials like anything else.
    const isOpenYard = building !== null && building.isComplete && building.definition.storage;
    if (building && !isOpenYard) {
      return building.isComplete ? building.input : building.materials;
    }

    const storage = this.storages.all.find(
      (candidate) => candidate.cell.gx === cell.gx && candidate.cell.gy === cell.gy,
    );
    return storage?.inventory ?? null;
  }

  /**
   * How much of a resource the destination still wants.
   *
   * Bounded so a hauler takes only what is needed rather than stripping the
   * yard and carrying the surplus back again.
   */
  private amountNeededAt(cell: GridPoint, resource: ResourceId): number {
    const building = this.buildingAtAccess(cell);
    if (!building) {
      return 0;
    }

    if (!building.isComplete) {
      return building.stillNeeds(resource);
    }

    const recipe = building.definition.recipeId ? findRecipe(building.definition.recipeId) : null;
    const ingredient = recipe?.inputs.find((input) => input.resource === resource);
    if (!ingredient) {
      return 0;
    }
    // Keep a few batches' worth on hand so the workshop is not idle between
    // deliveries, without hoarding the settlement's whole stock.
    const target = ingredient.amount * 5;
    return Math.max(0, target - building.input.count(resource));
  }

  /** The building whose work happens at this cell. */
  private buildingAtAccess(cell: GridPoint) {
    for (const building of this.world.buildings.all) {
      if (building.accessCell.gx === cell.gx && building.accessCell.gy === cell.gy) {
        return building;
      }
    }
    return null;
  }

  /**
   * Finds where to stand to do a job, and how to get there.
   *
   * A tree occupies its cell, so the villager works from an adjacent one.
   * Candidates are tried in a fixed order, which keeps assignment reproducible.
   */
  private findWorkingPosition(
    villager: Villager,
    job: Job,
  ): { cell: GridPoint; path: GridPoint[] } | null {
    const from = villager.cell;
    const destination = this.jobDestination(job);
    if (!destination) {
      return null;
    }

    // Standing on the target itself is fine when it is walkable — a pile lies
    // on open ground, and a move-to job goes to the cell itself.
    const candidates: GridPoint[] = this.world.isWalkable(destination) ? [destination] : [];
    for (const [dx, dy] of ADJACENT) {
      const cell = { gx: destination.gx + dx, gy: destination.gy + dy };
      if (this.world.isWalkable(cell)) {
        candidates.push(cell);
      }
    }

    for (const cell of candidates) {
      if (cell.gx === from.gx && cell.gy === from.gy) {
        return { cell, path: [] };
      }

      this.totalPathRequests += 1;
      const result = findPath(this.world.navigation, from, cell);
      if (result.path && result.path.length > 0) {
        return { cell, path: result.path };
      }
    }

    return null;
  }

  // --- movement ------------------------------------------------------------

  /**
   * Sends a villager to wherever its job's current stage happens.
   *
   * Used when a haul switches from collecting to delivering: the destination
   * changes, so the route must be recomputed — one of the few cases the brief
   * allows a path to be recalculated.
   */
  private routeToCurrentStage(villager: Villager, job: Job): void {
    const standing = this.findWorkingPosition(villager, job);
    if (!standing) {
      // Cannot reach the yard. Put the load down where we stand so it is not
      // lost, and hand the job back.
      for (const { resource, amount } of villager.inventory.contents) {
        const dropped = this.world.piles.drop(villager.cell, resource, amount);
        villager.inventory.remove(resource, dropped);
      }
      this.jobs.complete(job.id);
      villager.currentJobId = null;
      villager.activity = 'idle';
      return;
    }

    if (standing.path.length === 0) {
      villager.activity = 'hauling';
      return;
    }

    villager.path = standing.path;
    villager.destination = standing.cell;
    villager.activity = 'hauling';
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

    if (villager.path.length > 0) {
      return;
    }

    villager.destination = null;

    if (villager.currentJobId !== null) {
      // Arrived at the work site; the next tick starts the work itself.
      const job = this.jobs.get(villager.currentJobId);
      villager.activity = job?.type === 'haul' ? 'hauling' : 'working';
      this.jobs.beginWork(villager.currentJobId);
      return;
    }

    villager.activity = 'idle';
    villager.idleTicks = this.random.int(IDLE_TICKS_MIN, IDLE_TICKS_MAX);
  }

  /** Picks a nearby reachable cell and routes to it. */
  private chooseWanderTarget(villager: Villager): void {
    const from = villager.cell;

    for (let attempt = 0; attempt < WANDER_ATTEMPTS; attempt += 1) {
      const target: GridPoint = {
        gx: from.gx + this.random.int(-WANDER_RADIUS, WANDER_RADIUS + 1),
        gy: from.gy + this.random.int(-WANDER_RADIUS, WANDER_RADIUS + 1),
      };

      if (!this.world.isWalkable(target)) {
        continue;
      }
      if (target.gx === from.gx && target.gy === from.gy) {
        continue;
      }

      this.totalPathRequests += 1;
      const result = findPath(this.world.navigation, from, target);

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
      if (this.world.isWalkable(candidate)) {
        return candidate;
      }
    }

    // Fall back to a deterministic outward search so spawning cannot fail
    // merely because the random attempts were unlucky.
    return this.world.navigation.nearestWalkable(origin);
  }

  private makeName(): string {
    const given = this.random.pick(GIVEN_NAMES) ?? 'Villager';
    const family = this.random.pick(FAMILY_NAMES) ?? 'Of the Vale';
    return `${given} ${family}`;
  }
}
