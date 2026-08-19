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
  FEMININE_NAMES,
  MASCULINE_NAMES,
  VILLAGER_WALK_SPEED,
  WAYPOINT_TOLERANCE,
} from '@/data/villagers';
import {
  ADULT_AGE,
  FOUNDER_AGE_MAX,
  FOUNDER_AGE_MIN,
  FOUNDING_YOUNG_AGE_MAX,
  FOUNDING_YOUNG_AGE_MIN,
  FOUNDING_YOUNG_SHARE,
  IMMIGRANT_AGE_MAX,
  IMMIGRANT_AGE_MIN,
} from '@/data/population';
import { rollLifespan } from '@/simulation/population/PopulationSystem';
import { gridToWorld } from '@/shared/math/isometric';
import type { RandomState, SeededRandom } from '@/shared/math/random';
import type { GridPoint } from '@/shared/types/geometry';
import { recipe as findRecipe } from '@/data/recipes';
import { resourceDefinition, type ResourceId } from '@/data/resources';
import type { Building } from '@/simulation/buildings/Building';
import type { Job } from '@/simulation/jobs/Job';
import type { JobManager } from '@/simulation/jobs/JobManager';
import type { StorageRegistry } from '@/simulation/logistics/Storage';
import { findPath } from '@/simulation/pathfinding/AStar';
import { ROAD_SPEED_MULTIPLIER } from '@/simulation/world/RoadGrid';
import type { SeasonalProfile } from '@/simulation/seasons/SeasonClock';
import type { World } from '@/simulation/world/World';
import { Villager, type Sex } from './Villager';

/** Maximum A* searches started per tick, across all villagers. */
/**
 * How many villagers may look for work in one tick, at the very least.
 *
 * **A cap chosen when a settlement had ten people, and it does not scale.** Every
 * villager who wants to start anything needs a route, and routes are the one
 * genuinely expensive thing in a tick, so the search is rationed. At sixty-one
 * villagers that ration meant each of them got to look for work about once every
 * fifteen ticks — and half the rations went to children going for a walk.
 * Measured: sixteen able adults standing free with thirty-seven material hauls on
 * the board, thirteen sites that had not moved in eighty days, and eighty heaps
 * of goods lying about a working settlement of sixty.
 *
 * It is a floor now rather than a ceiling: see {@link workSearchBudget}.
 */
const PATH_REQUESTS_PER_TICK = 4;

/**
 * How many villagers may look for **work** this tick.
 *
 * A quarter of the settlement, so the ration grows with the village that has to
 * be run. Below sixteen people this is exactly the old four, which is why every
 * measurement taken of a ten-villager settlement still holds.
 */
function workSearchBudget(population: number): number {
  return Math.max(PATH_REQUESTS_PER_TICK, Math.ceil(population / 4));
}

/** How far an idle villager will pick a new spot to wander to, in cells. */
const WANDER_RADIUS = 12;

/**
 * How far a very small child strays, in cells.
 *
 * **Not a rule, a picture.** A two-year-old crossing twelve cells of wilderness
 * on their own was the settlement saying something untrue about itself. Under
 * this age they stay within sight of the house; over it they have the run of the
 * village, which is what children in a village do.
 *
 * Deliberately the same *number of random draws* as a full-range wander, so
 * adding it did not re-roll every existing seed — only the radius changes, not
 * the sequence. See `docs/GAME_DESIGN.md` on determinism.
 */
const TODDLER_AGE = 4;
const TODDLER_RADIUS = 3;

/**
 * Chance per decision that a school-age child heads for the school.
 *
 * Not every time: a village child who only ever walks between home and school is
 * a commuter, not a child. The rest of the time they are somewhere about the
 * place, which is the same wandering everybody else does.
 *
 * The draw only happens when a school actually stands, so a settlement without
 * one consumes exactly the random numbers it always did.
 */
const SCHOOL_CHANCE = 0.45;

/** Ticks a villager rests on arrival before looking for work again. */
const IDLE_TICKS_MIN = 10;
const IDLE_TICKS_MAX = 60;

/** Give up choosing a wander target after this many failed guesses. */
const WANDER_ATTEMPTS = 8;

/**
 * How far out a founder or a newcomer will look for a spot to stand.
 *
 * Wide enough to clear the camp's own footprint and the wood around it, narrow
 * enough that arriving is arriving *here* rather than somewhere over the hill.
 */
const SPAWN_SEARCH = 12;

/** Neighbours checked when looking for somewhere to stand next to a job. */
/**
 * How far somebody walled into a pocket will look for a way back.
 *
 * Wide enough to cross any pocket a settlement's own buildings can make — the
 * ones measured were four cells and one — and narrow enough that nobody is ever
 * moved somewhere a player would not recognise as "just outside".
 */
const POCKET_ESCAPE = 10;

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
  private readonly randomSource: SeededRandom;
  private nextId = 1;

  private totalPathRequests = 0;
  private totalPathFailures = 0;

  constructor(world: World, jobs: JobManager, storages: StorageRegistry, random: SeededRandom) {
    this.world = world;
    this.jobs = jobs;
    this.storages = storages;
    this.randomSource = random;
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
   * Places the founding party on walkable ground around a point.
   *
   * Their sexes are still an even coin each, so a party can come out seven to
   * three and make fewer couples than another. Dealing a balanced five-and-five
   * was measured and is a real improvement for the lopsided seeds, but it moves
   * which seed the balance suite's single pinned scenario survives on — see
   * `docs/GAME_DESIGN.md` — so it is a decision to take with the difficulty
   * pass rather than ahead of it.
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

      // Alternating rather than rolled, so ten survivors are five and five.
      //
      // This used to be a coin per founder, on the reasoning that a party that
      // came out seven to three was a real consequence of the seed. It is not a
      // consequence a player can see, plan around or recover from: it silently
      // halves the number of couples on day one and therefore the settlement's
      // whole growth curve, for reasons the game never shows them. Founding
      // composition is the one place variance buys nothing. Children and
      // newcomers are still an even coin.
      const sex: Sex = this.rollSex();
      // **The last few of the party are young people, not grown-ups.** Taken
      // from the end of the list rather than rolled, for the same reason the
      // sexes alternate: how many of them there are must not be a lottery the
      // player cannot see, because it decides when the second generation
      // arrives. See FOUNDING_YOUNG_SHARE.
      const young = placed >= Math.round(count * (1 - FOUNDING_YOUNG_SHARE));
      this.villagers.push(
        new Villager({
          id: this.nextId,
          name: this.makeName(sex),
          sex,
          age: young
            ? this.randomSource.int(FOUNDING_YOUNG_AGE_MIN, FOUNDING_YOUNG_AGE_MAX + 1)
            : this.randomSource.int(FOUNDER_AGE_MIN, FOUNDER_AGE_MAX + 1),
          position: gridToWorld(cell),
          lifespan: rollLifespan(this.random),
        }),
      );
      this.nextId += 1;
      placed += 1;
    }

    return placed;
  }

  /**
   * Adds a newborn at a cell.
   *
   * Born at home rather than at the map's centre, and with a lifespan of their
   * own drawn from the same seeded stream, so a generation does not die
   * together.
   */
  public bear(
    cell: GridPoint,
    homeId: number,
    parents?: readonly [number, number],
    familyName?: string,
  ): Villager {
    const sex = this.rollSex();
    const villager = new Villager({
      id: this.nextId,
      // Born into a family, not named from scratch: a child carries the house's
      // name, which is what makes a roster read as households rather than as a
      // list of strangers who happen to share a roof.
      name: familyName ? `${this.givenName(sex)} ${familyName}` : this.makeName(sex),
      sex,
      age: 0,
      position: gridToWorld(this.world.navigation.nearestWalkable(cell) ?? cell),
      lifespan: rollLifespan(this.random),
    });
    villager.homeId = homeId;
    if (parents) {
      villager.parentIds = parents;
    }
    this.nextId += 1;
    this.villagers.push(villager);
    return villager;
  }

  /**
   * Adds an adult who has walked in from outside.
   *
   * Distinct from `spawnNear` because founders and newcomers are not the same
   * people: a stranger who made the journey is young enough to start again, and
   * arrives with nothing and nowhere to sleep until the settlement houses them.
   */
  public welcome(near: GridPoint): Villager | null {
    const cell = this.findSpawnCell(near);
    if (!cell) {
      return null;
    }

    const sex = this.rollSex();
    const villager = new Villager({
      id: this.nextId,
      name: this.makeName(sex),
      sex,
      age: this.randomSource.int(IMMIGRANT_AGE_MIN, IMMIGRANT_AGE_MAX + 1),
      position: gridToWorld(cell),
      lifespan: rollLifespan(this.randomSource),
    });
    this.nextId += 1;
    this.villagers.push(villager);
    return villager;
  }

  /** Advances every villager by one fixed tick. */
  public update(tickSeconds: number): void {
    let workBudget = workSearchBudget(this.villagers.length);
    // **Wandering has its own ration.** Children and elders take the same routes
    // as anybody else, and out of one shared pool a village of thirty-three
    // children stopped its adults from working: the walk to nowhere and the walk
    // to a job competed, and there were twice as many walkers.
    let wanderBudget = PATH_REQUESTS_PER_TICK;

    for (const villager of this.villagers) {
      villager.previousPosition = villager.position;

      // Anybody *stuck* where the ground has closed over them steps clear.
      // Somebody merely walking past a wall is left alone — see `stepClear`.
      if (!villager.isMoving && !this.world.isWalkable(villager.cell)) {
        this.stepClear(villager);
      } else if (!villager.isMoving && this.isCutOff?.(villager.cell) === true) {
        // And anybody walled *into* a pocket climbs out of it — see
        // `stepOutOfPocket`. The ground under them is fine; it is the ground
        // between them and the settlement that has closed.
        this.stepOutOfPocket(villager);
      }

      // Somebody unwell keeps to their bed. This is the whole cost of illness:
      // not health, but hands — and in a marginal settlement that is still
      // fatal, by starvation, in winter, which is the failure this game is
      // about rather than a second one racing it.
      if (villager.isIll) {
        this.restUntilWell(villager);
        continue;
      }

      if (villager.isMoving) {
        this.advanceAlongPath(villager, tickSeconds);
        continue;
      }

      if (villager.currentJobId !== null) {
        this.workOnJob(villager);
        continue;
      }

      // **Nobody walks around full.** A villager can end a job still holding
      // goods — they fall ill mid-errand, or they are rescued out of a pocket, or
      // the load they fetched turned out not to be wanted — and a full pack means
      // every future errand loads nothing at all. They were then useless for the
      // rest of their lives while still claiming work: measured on a settlement of
      // sixty-seven, eight of its haulers were walking about with forty logs each,
      // forty thousand material errands had completed carrying nothing, and twelve
      // sites had not moved in a hundred days.
      //
      // Put down rather than deleted, and the heap posts its own haul job like any
      // other, so nothing is lost and somebody picks it up.
      if (!villager.inventory.isEmpty) {
        this.putDown(villager);
      }

      if (villager.idleTicks > 0) {
        villager.activity = 'idle';
        villager.idleTicks -= 1;
        continue;
      }

      villager.activity = 'idle';

      // Real work first; wandering is only what they do when there is none.
      // Children below working age are not put to work — they eat and grow up,
      // which is the cost of a population that renews itself — and neither are
      // elders, who have earned the walk about the village they are taking.
      if (villager.canWork) {
        if (workBudget <= 0) {
          continue;
        }
        workBudget -= 1;
        if (this.tryTakeJob(villager)) {
          continue;
        }
      }

      if (wanderBudget <= 0) {
        continue;
      }
      wanderBudget -= 1;
      this.chooseWanderTarget(villager);
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
    return this.randomSource.getState();
  }

  public restoreRandomState(state: RandomState): void {
    this.randomSource.setState(state);
  }

  /**
   * The villagers' seeded stream.
   *
   * Shared with the population system on purpose: births are villager business,
   * and giving them their own stream would mean one more thing to save and one
   * more way for a loaded settlement to diverge from the one it came from.
   */
  public get random(): SeededRandom {
    return this.randomSource;
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
      this.putDown(villager);
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
    const job = this.jobs.claimBest(villager.id, villager.cell, (candidate) =>
      this.mayWork(villager, candidate),
    );
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
      // Tools and spirit buy speed for the whole settlement; experience buys it
      // for one person at one trade. All three multiply into the same number,
      // which is the single place in the game where any of them pays off.
      job.workRemaining -= this.workRate() * this.skillRate(villager, job);
      this.recordBuildProgress(job);
      if (job.workRemaining > 0) {
        return;
      }
      this.finishJob(job);
    }
    this.jobs.complete(job.id);
    villager.currentJobId = null;
    villager.activity = 'idle';
    villager.idleTicks = this.randomSource.int(2, 8);
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
        // Spilling onto the next cell when the doorstep is full: a pile holds one
        // stack, and everything past it used to be made and then lost.
        this.world.dropNear(building.accessCell, output.resource, amount);
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
  public productionScaleProvider: ((profile: SeasonalProfile) => number) | null = null;

  /**
   * How much work a tick of labour is worth, set by the simulation.
   *
   * A provider rather than a field, for the same reason as the production
   * scale: the villagers do not know what a tool is, and the survival system
   * that does must not be imported here.
   */
  public workRateProvider: (() => number) | null = null;

  /**
   * How much this villager's own experience is worth at the job in hand.
   *
   * **Split from the settlement-wide rate rather than folded into it**, because
   * the two answer different questions: tools and spirit are facts about the
   * village, and a master woodcutter is a fact about one person doing one kind of
   * work. Multiplying them together is right; conflating them would have meant
   * either everybody sharing one skill level or the whole settlement speeding up
   * when one villager reached five years.
   *
   * A provider for the same reason as the other: the villagers do not know what a
   * building definition is, and nothing here may import one.
   */
  public skillRateProvider: ((villager: Villager, job: Job) => number) | null = null;

  /**
   * Called when a demolition job finishes.
   *
   * A callback rather than direct work, for the same reason as the production
   * scale: pulling a building down touches storages, employment and the job
   * board, none of which the villagers know about. They do the labour; the
   * simulation deals with the consequences.
   */
  /**
   * Asks whether somebody standing here can reach the settlement at all.
   *
   * A provider for the same reason as the others: the villagers do not know what
   * a storage yard is, and nothing here may import one. `null` until the
   * simulation sets it, which means "assume nobody is cut off".
   */
  public isCutOff: ((cell: GridPoint) => boolean) | null = null;

  public onDemolished: ((buildingId: number) => void) | null = null;

  /**
   * Called the moment a tree comes down, with the cell and who ordered it.
   *
   * What the ground does next is the settlement's business rather than this
   * system's: a workshop's felling leaves a sapling standing on the cell and the
   * player's own clears it for good. See `world/Woodland.ts`.
   */
  public onTreeFelled: ((cell: GridPoint, playerOrdered: boolean) => void) | null = null;

  private workRate(): number {
    return this.workRateProvider ? this.workRateProvider() : 1;
  }

  private skillRate(villager: Villager, job: Job): number {
    return this.skillRateProvider ? this.skillRateProvider(villager, job) : 1;
  }

  private productionScale(profile: SeasonalProfile): number {
    if (profile === 'none' || !this.productionScaleProvider) {
      return 1;
    }
    return this.productionScaleProvider(profile);
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
        if (job.targetEntityId !== null && this.world.fellTree(job.targetEntityId)) {
          this.onTreeFelled?.(job.target, job.playerOrdered === true);
        }
        break;
      case 'gather-stone':
        this.world.mineStone(job.target);
        break;
      case 'pave-road':
        this.world.paveRoad(job.target);
        break;
      case 'dig-ditch':
        this.world.digDitch(job.target);
        break;
      case 'demolish':
        if (job.targetEntityId !== null) {
          this.onDemolished?.(job.targetEntityId);
        }
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
    //
    // Three destinations can share one cell, and the order between them is the
    // whole of this: a **site that owes some of what is being carried** first,
    // then a **yard whose doorway is here**, then a **finished building's input
    // buffer**. Doorways get shared — a free cell beside one building is a free
    // cell beside its neighbour — and every wrong ordering of these three has
    // been shipped and measured.
    //
    // **A site takes only what it still owes.** A site's materials hold exactly
    // its cost, so a load tipped in whole could fill the space another material
    // needed: a Feller's Hut costing six logs and two stone was measured holding
    // *eight logs* and full, with its two stone lying on the doorstep and
    // re-fetched for ever.
    const site = job.deliverTo === null ? null : this.siteAwaiting(job.deliverTo, villager);
    if (site) {
      for (const { resource, amount } of [...villager.inventory.contents]) {
        const room = Math.min(amount, site.stillNeeds(resource));
        if (room > 0) {
          villager.inventory.transfer(site.materials, resource, room);
        }
      }
      this.world.buildings.markChanged();
    }

    if (!villager.inventory.isEmpty) {
      const destination = this.deliveryInventory(job.deliverTo);
      if (destination) {
        villager.inventory.transferAll(destination);
        this.storages.markChanged();
        this.world.buildings.markChanged();
      }
    }

    // **Anything nobody here will take goes on to a yard, in their hands.** Not
    // down on the doorstep: a heap of stone outside a half-built house is exactly
    // what a player reads as the works being stuck, and it is only there because
    // somebody else's load arrived first while this one was walking.
    //
    // Never back to the cell they are standing on, which was a live infinite
    // loop: a Tailor site sharing its doorway with a finished larder was handed
    // every passing load of food, could not take it, and sent the hauler to the
    // nearest yard — which was the larder, at the same cell. The villager span
    // there for the rest of the game, and a settlement of seventy-eight lost its
    // haulers one at a time until twelve sites had not moved in eighty days.
    if (!villager.inventory.isEmpty) {
      const carried = villager.inventory.contents[0];
      const yard = carried
        ? this.storages.findNearestAccepting(villager.cell, carried.resource)
        : null;
      if (
        yard &&
        job.deliverTo !== null &&
        (yard.cell.gx !== job.deliverTo.gx || yard.cell.gy !== job.deliverTo.gy)
      ) {
        job.deliverTo = yard.cell;
        return false;
      }
      // Nowhere at all will have it. Put it down rather than deleting it:
      // resources must never simply vanish.
      this.putDown(villager);
    }

    return true;
  }

  /**
   * Loads from a pile on the ground. Returns `false` when there was nothing.
   *
   * Which pile is usually the job's own target — an ordinary haul reserves the
   * pile it is emptying. A delivery to a building site reserves "this site's next
   * load of stone" instead, and records the pile separately; see `Job.haulPileId`.
   */
  private loadFromPile(villager: Villager, job: Job): boolean {
    const pileId = job.haulPileId ?? job.targetEntityId;
    const pile = pileId === null ? null : this.world.piles.getById(pileId);
    if (!pile || pile.isEmpty) {
      return false;
    }

    const carryLimit = resourceDefinition(pile.resource).carryLimit;
    let room = Math.min(carryLimit, villager.inventory.freeSpace);

    // A material delivery takes only what the site still owes, so a builder does
    // not shoulder twenty logs for a hut that needs three and then carry the rest
    // back. An ordinary haul into a yard has no such limit: the point of it is to
    // clear the ground.
    if (job.haulResource !== null && job.deliverTo !== null) {
      room = Math.min(room, this.amountNeededAt(job.deliverTo, job.haulResource));
    }
    if (room <= 0) {
      return false;
    }

    const before = villager.inventory.count(pile.resource);
    pile.inventory.transfer(villager.inventory, pile.resource, room);
    this.world.piles.removeIfEmpty(pile.id);

    // **What this trip picked up, not what the villager happens to hold.**
    // Reporting the latter told a job it had loaded when it had loaded nothing,
    // which is how a hauler with a full pack kept being handed errands.
    return villager.inventory.count(pile.resource) > before;
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
    const before = villager.inventory.count(job.haulResource);
    storage.inventory.transfer(villager.inventory, job.haulResource, room);
    this.storages.markChanged();

    // What this trip took, not what is in the pack. See `loadFromPile`.
    return villager.inventory.count(job.haulResource) > before;
  }

  /**
   * Where a delivery to this cell actually goes.
   *
   * A **yard whose doorway is this cell** before a building standing on it. A
   * finished larder shares its doorway with the storage it opened, and the
   * building must not answer for it: goods delivered to a Food Storage were
   * landing in the building's recipe-input buffer instead of on its shelves,
   * where nothing could ever eat them.
   *
   * A site that owes the load is settled before this is ever asked — see
   * `siteAwaiting` — so what is left here is a yard or a workshop's input.
   */
  private deliveryInventory(cell: GridPoint | null) {
    if (!cell) {
      return null;
    }

    const storage = this.storages.all.find(
      (candidate) => candidate.cell.gx === cell.gx && candidate.cell.gy === cell.gy,
    );
    if (storage) {
      return storage.inventory;
    }

    const building = this.buildingAtAccess(cell);
    if (!building || !building.isComplete) {
      // **Never a site's materials.** What a site owes is settled by
      // `siteAwaiting`; anything else tipped in there fills the room its own cost
      // needs and kills the building outright. Measured: a house owing eight logs
      // and four stone was found holding eight logs and *four firewood*, full, and
      // could never be finished.
      return null;
    }
    return building.input;
  }

  /**
   * The half-built building at this doorway that wants what is being carried.
   *
   * **Doorways get shared.** A free cell beside one building is a free cell
   * beside its neighbour too, and `buildingAtAccess` answers with whichever was
   * found first — so a house site sharing its doorway with a finished workshop
   * had every delivery handed to the workshop instead and stood unbuilt for
   * ever. Asking for the one that actually owes the load settles it.
   */
  private siteAwaiting(cell: GridPoint, villager: Villager): Building | null {
    for (const building of this.world.buildings.all) {
      if (building.isComplete) {
        continue;
      }
      if (building.accessCell.gx !== cell.gx || building.accessCell.gy !== cell.gy) {
        continue;
      }
      for (const { resource } of villager.inventory.contents) {
        if (building.stillNeeds(resource) > 0) {
          return building;
        }
      }
    }
    // **No fallback to "some site is here".** A site that owes nothing is not a
    // destination, and treating it as one handed every passing load of food to a
    // Tailor site that could not take it. See the note in `advanceHaul`.
    return null;
  }

  /**
   * How much of a resource somebody at this cell still wants.
   *
   * **Asked of everybody standing there, not the first one found.** Doorways get
   * shared, and resolving a shared cell arbitrarily is what froze a settlement of
   * seventy-eight: a house site whose doorway it shared with three finished
   * buildings was asked about through one of *them*, the answer was nought, the
   * hauler picked up nothing, the job completed empty, and the site re-posted it
   * — for eighty measured days. Thirteen sites never moved.
   *
   * The most anybody wants is the right answer: the load will find its taker at
   * the far end, where the order is site-then-yard-then-workshop.
   *
   * Bounded so a hauler takes only what is needed rather than stripping the
   * yard and carrying the surplus back again.
   */
  private amountNeededAt(cell: GridPoint, resource: ResourceId): number {
    let most = 0;
    for (const building of this.world.buildings.all) {
      if (building.accessCell.gx !== cell.gx || building.accessCell.gy !== cell.gy) {
        continue;
      }
      most = Math.max(most, this.wantedBy(building, resource));
    }
    return most;
  }

  /** How much of a resource one building would take right now. */
  private wantedBy(building: Building, resource: ResourceId): number {
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

  /**
   * The building whose work happens at this cell, preferring a finished one.
   *
   * A site that owes the load is settled before this is asked — see
   * `siteAwaiting` — so when a doorway is shared what is wanted here is the
   * building that is actually working, not the one still going up.
   */
  private buildingAtAccess(cell: GridPoint): Building | null {
    let site: Building | null = null;
    for (const building of this.world.buildings.all) {
      if (building.accessCell.gx !== cell.gx || building.accessCell.gy !== cell.gy) {
        continue;
      }
      if (building.isComplete) {
        return building;
      }
      site ??= building;
    }
    return site;
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
      this.putDown(villager);
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
   *
   * The budget is kept in **seconds** rather than in distance, because speed is
   * no longer constant: a step onto a road is walked faster. Pathfinding already
   * prefers roads through the cost model, but preferring them would be a lie if
   * taking one did not actually save time — so the same discount is applied
   * here, per step, against the cell being entered.
   */
  private advanceAlongPath(villager: Villager, tickSeconds: number): void {
    villager.activity = 'walking';
    let remaining = tickSeconds;

    while (remaining > 0 && villager.path.length > 0) {
      const waypoint = villager.path[0];
      if (!waypoint) {
        break;
      }

      const speed =
        VILLAGER_WALK_SPEED * (this.world.roads.hasAt(waypoint) ? ROAD_SPEED_MULTIPLIER : 1);
      const reach = speed * remaining;

      const target = gridToWorld(waypoint);
      const dx = target.wx - villager.position.wx;
      const dy = target.wy - villager.position.wy;
      const distance = Math.hypot(dx, dy);

      if (distance <= reach + WAYPOINT_TOLERANCE) {
        villager.position = target;
        villager.path.shift();
        remaining -= distance / speed;
        continue;
      }

      villager.position = {
        wx: villager.position.wx + (dx / distance) * reach,
        wy: villager.position.wy + (dy / distance) * reach,
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
    villager.idleTicks = this.randomSource.int(IDLE_TICKS_MIN, IDLE_TICKS_MAX);
  }

  /**
   * Whether this villager is allowed to take this job.
   *
   * The whole of professions, in one predicate. Work that belongs to a
   * *building* — producing at it, tending the wood around it — is its
   * employees' work and nobody else's. Everything else is the settlement's
   * work, and labourers do it.
   *
   * Without this, "worker slots" described nothing a player could act on: a
   * produce job went to whoever happened to be nearest, so somebody could walk
   * half the map to forage for four seconds and walk back.
   */
  private mayWork(villager: Villager, job: Job): boolean {
    // **Nothing they cannot walk to.** `claimBest` is deterministic: same
    // villager, same board, same answer. So one job the taker cannot reach is
    // not a job skipped — it is the only job they will ever be offered, handed
    // back and re-offered every tick for the rest of their life. Measured on a
    // two-year run, three of ten able adults were idle from day thirty-six with
    // a hundred and ninety haul jobs standing and six hundred logs on the
    // ground.
    //
    // A region comparison, not a path: it is an array lookup, it runs against
    // every job on the board for every idle villager, and it answers exactly
    // the question — the pathfinder is still what works out the route.
    if (!this.canGetTo(villager, job)) {
      return false;
    }

    // A job that belongs to a workshop belongs to *its* people. See
    // `Job.employerId`: this is what makes felling a trade somebody is posted
    // to rather than a chore that always loses to the day's hauling.
    if (job.employerId !== undefined) {
      return villager.employerId === job.employerId;
    }

    if (job.type !== 'produce') {
      // Employees are not idled by having a job: they help with felling,
      // hauling and building like anyone else. Their own workshop's work is
      // `urgent`, so it always wins when there is any — which means the
      // priority system already keeps them at their post without a rule
      // pinning them there.
      //
      // Keeping them *near* their workplace was tried and measured: capping how
      // far an employee will go to help changed nothing at 14 cells and made a
      // marginal settlement worse at 5. Their travel is not what a short-handed
      // village is losing to; committing four of ten people to workshops is,
      // and that is the cost the player is now able to decide about.
      return true;
    }
    return job.targetEntityId !== null && villager.employerId === job.targetEntityId;
  }

  /**
   * `true` when this villager could walk to every leg of this job.
   *
   * A haul has two: the pile and the yard. Checking only the pickup is what
   * produced the loop a player reported — carry the load to a yard on the far
   * side of a wall, fail to deliver, put it down where you stand, and the pile
   * that makes posts the same job straight back.
   */
  private canGetTo(villager: Villager, job: Job): boolean {
    const region = this.world.navigation.regionAt(villager.cell.gx, villager.cell.gy);
    if (region < 0) {
      // Standing inside a wall. `stepClear` deals with that; until it does,
      // nothing is reachable from here.
      return false;
    }
    if (!this.worksFrom(region, job.target)) {
      return false;
    }
    return job.deliverTo === null || this.worksFrom(region, job.deliverTo);
  }

  /**
   * `true` when somebody in `region` could stand where this work is done.
   *
   * The same candidate set {@link findWorkingPosition} walks — the cell itself
   * when it is walkable, and its neighbours when it is not, because a building
   * site and a tree are worked from beside them rather than from on them.
   */
  private worksFrom(region: number, destination: GridPoint): boolean {
    const nav = this.world.navigation;
    if (nav.regionAt(destination.gx, destination.gy) === region) {
      return true;
    }
    for (const [dx, dy] of ADJACENT) {
      if (nav.regionAt(destination.gx + dx, destination.gy + dy) === region) {
        return true;
      }
    }
    return false;
  }

  /**
   * Puts an ill villager to bed, handing back whatever they were doing.
   *
   * Releasing the job matters more than the resting does: a reserved job held
   * by somebody who will not move for eight days is a job nobody else can take,
   * and a settlement could lose its only hauler and its only haul at once.
   */
  private restUntilWell(villager: Villager): void {
    if (villager.currentJobId !== null) {
      this.jobs.release(villager.currentJobId);
      villager.currentJobId = null;
    }
    villager.path.length = 0;
    villager.destination = null;
    villager.activity = 'ill';
  }

  /**
   * Moves a villager off a cell that is no longer walkable.
   *
   * **This fixes the worst bug the project has had.** A building blocks its
   * footprint the moment it is finished, and nothing checked who was standing
   * inside it — so a villager who happened to be on the plot was walled in
   * permanently. Every path request starts from the villager's own cell, and
   * from inside a wall every single one fails, so they never worked again: they
   * could not fell, haul, build or take a post, and they still ate.
   *
   * It was invisible on the one seed the balance tests use and fatal on most
   * others. Measured across eight seeds, six lost their settlement, and up to
   * seven of ten villagers were entombed at the settlement centre by day six —
   * which reads, from outside, exactly like a game that is simply too hard.
   *
   * The rescue lives here rather than in the building code on purpose. Being
   * finished on top of somebody is only the cause found first; a save written
   * by an older version, a future terrain change, anything at all that closes a
   * cell would strand somebody the same way. Checking that you are standing
   * somewhere you can stand is the villager's own business, it costs one array
   * lookup a tick, and it makes the whole class of bug survivable instead of
   * fatal.
   *
   * **Only for villagers who are not walking.** A cell is derived by flooring a
   * continuous position, so somebody following a perfectly legal path along a
   * wall reads as being inside it for a tick or two. Rescuing them would
   * teleport a villager who was only passing and throw away the job they were
   * on the way to — a regression test caught exactly that. Anybody mid-path
   * already has a route out and needs no help; being stuck is the condition
   * worth acting on, and being stuck means standing still.
   */
  private stepClear(villager: Villager): void {
    const escape = this.world.navigation.nearestWalkable(villager.cell);
    if (!escape) {
      // Sealed in past the search radius. Nothing sensible to do, and leaving
      // them put is better than teleporting them across the map.
      return;
    }

    villager.position = gridToWorld(escape);
    // Moved rather than travelled: without this the renderer interpolates a
    // slide out of the wall, which looks like a bug of its own.
    villager.previousPosition = villager.position;
    villager.path.length = 0;
    villager.destination = null;

    // Whatever they were doing was planned from a cell they were never really
    // standing on, so it goes back on the board for somebody who can reach it.
    if (villager.currentJobId !== null) {
      this.jobs.release(villager.currentJobId);
      villager.currentJobId = null;
    }
    villager.activity = 'idle';
  }

  /**
   * Sets down whatever a villager is holding, where they stand.
   *
   * Used when they have no job to deliver it with. The heap posts its own haul
   * job on the next tick, exactly as a felled tree's logs do, so the goods are
   * back in circulation rather than riding around in somebody's arms.
   */
  private putDown(villager: Villager): void {
    for (const { resource, amount } of [...villager.inventory.contents]) {
      // `dropNear`, not `drop`: a heap holds one stack, and a villager carrying
      // two stacks onto a cell that already has one put down what fitted and
      // walked away with the rest — which is the full pack this exists to clear.
      const dropped = this.world.dropNear(villager.cell, resource, amount);
      villager.inventory.remove(resource, dropped);
    }
  }

  /**
   * Walks a villager out of a pocket the settlement has built around them.
   *
   * **The sibling of {@link stepClear}, and the worse of the two.** That one is
   * for standing *inside* a wall; this is for standing somewhere perfectly
   * legal that the settlement can no longer be reached from. Four houses put up
   * shoulder to shoulder leave a four-cell yard between them, and whoever
   * happens to be in it when the last one is finished never works again: every
   * path out fails, so they cannot fell, haul, build or take a post, and they
   * still eat.
   *
   * It was measured on a two-year run of an ordinary opening. From day
   * thirty-six, three of ten able adults stood in a four-cell yard and a
   * one-cell hole. The settlement's haul board grew from twelve jobs to a
   * hundred and ninety-one, six hundred and seventy-six logs lay on the ground,
   * and the banner said the works were stopped for want of timber — with the
   * timber in sight of the yard the whole time.
   *
   * The rescue is deliberately blunt: they step to the nearest cell the
   * settlement's stores can be reached from. A villager climbing a fence is a
   * better story than a villager starving beside one, and it makes the whole
   * class of bug survivable rather than fatal — a demolished bridge, a save from
   * an older version and any future terrain change strand somebody the same way.
   */
  private stepOutOfPocket(villager: Villager): void {
    const escape = this.wayOutOfPocket(villager.cell);
    if (!escape) {
      // Too deep in to help, or the settlement has no stores to measure
      // against. Leaving them put beats teleporting them across the map.
      return;
    }

    villager.position = gridToWorld(escape);
    // Moved rather than travelled: without this the renderer interpolates a
    // slide through the wall, which looks like a bug of its own.
    villager.previousPosition = villager.position;
    villager.path.length = 0;
    villager.destination = null;

    if (villager.currentJobId !== null) {
      this.jobs.release(villager.currentJobId);
      villager.currentJobId = null;
    }
    villager.activity = 'idle';
  }

  /**
   * The nearest cell outside the pocket, searched ring by ring.
   *
   * Deliberately not `World.nearestReachable`: that is measured from a set the
   * villager is a member of, so from inside a pocket every cell in the pocket
   * looks like part of the settlement. See `Simulation.isCutOff`.
   */
  private wayOutOfPocket(from: GridPoint): GridPoint | null {
    for (let ring = 1; ring <= POCKET_ESCAPE; ring += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
            continue;
          }
          const cell = { gx: from.gx + dx, gy: from.gy + dy };
          if (!this.world.isWalkable(cell)) {
            continue;
          }
          if (this.isCutOff?.(cell) === false) {
            return cell;
          }
        }
      }
    }
    return null;
  }

  /**
   * Picks a nearby reachable cell and routes to it.
   *
   * This is what everybody does when there is no work: the labourers between
   * jobs, the children, and the elders who have earned the walk. Three shades of
   * it, and the difference is only ever *where*:
   *
   * - a very small child stays within sight of the house;
   * - a school-age child heads for the school about half the time, when there is
   *   one to head for;
   * - everybody else has the run of the settlement.
   */
  private chooseWanderTarget(villager: Villager): void {
    const from = villager.cell;

    const school = this.schoolFor(villager);
    if (school && this.randomSource.next() < SCHOOL_CHANCE) {
      this.totalPathRequests += 1;
      const toSchool = findPath(this.world.navigation, from, school);
      if (toSchool.path && toSchool.path.length > 0) {
        villager.path = toSchool.path;
        villager.destination = school;
        villager.activity = 'walking';
        return;
      }
      this.totalPathFailures += 1;
    }

    // A toddler wanders on the same draws as anybody else, over a shorter reach:
    // changing how many numbers are taken from the stream would re-roll every
    // settlement ever seeded.
    const radius = villager.age < TODDLER_AGE ? TODDLER_RADIUS : WANDER_RADIUS;
    const home = villager.age < TODDLER_AGE ? this.homeCell(villager) : null;
    const origin = home ?? from;

    for (let attempt = 0; attempt < WANDER_ATTEMPTS; attempt += 1) {
      const target: GridPoint = {
        gx: origin.gx + this.randomSource.int(-radius, radius + 1),
        gy: origin.gy + this.randomSource.int(-radius, radius + 1),
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
    villager.idleTicks = this.randomSource.int(IDLE_TICKS_MIN, IDLE_TICKS_MAX);
  }

  /**
   * The school a child should be heading for, or `null`.
   *
   * `null` for everybody who is not a school-age child, and for every settlement
   * that has not built one — which matters beyond tidiness: the caller only
   * rolls a die once this returns a cell, so a settlement with no school draws
   * exactly the random numbers it always drew.
   */
  private schoolFor(villager: Villager): GridPoint | null {
    if (villager.age < TODDLER_AGE || villager.canWork || villager.age >= ADULT_AGE) {
      return null;
    }

    for (const building of this.world.buildings.all) {
      if (building.isComplete && building.definition.id === 'school') {
        return building.accessCell;
      }
    }
    return null;
  }

  /** The doorway of the house somebody sleeps in, when they have one. */
  private homeCell(villager: Villager): GridPoint | null {
    if (villager.homeId === null) {
      return null;
    }
    const home = this.world.buildings.getById(villager.homeId);
    return home ? home.accessCell : null;
  }

  private findSpawnCell(origin: GridPoint): GridPoint | null {
    // Try a scattered spot first so the founders do not stand in one stack.
    //
    // **Four cells, and on the settlement's own side of the water.** It was six
    // and unchecked, and both parts were wrong: the party arrived spread over a
    // thirteen-cell square with their stores in the middle of it, and — because
    // the river runs right past the camp — sometimes with two or three of them on
    // the far bank, cut off from the settlement and from everything in it on the
    // first frame of the game. They would stand there until somebody built a
    // bridge nobody knew was needed.
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate: GridPoint = {
        gx: origin.gx + this.randomSource.int(-4, 5),
        gy: origin.gy + this.randomSource.int(-4, 5),
      };
      if (this.world.isWalkable(candidate) && this.world.reaches(candidate)) {
        return candidate;
      }
    }

    // Fall back to a deterministic outward search so spawning cannot fail
    // merely because the random attempts were unlucky. Still on the settlement's
    // ground where there is any: only a world with nobody and nothing in it
    // — which is the world generator's own tests — falls through to any walkable
    // cell at all.
    return (
      this.world.nearestReachable(origin, SPAWN_SEARCH) ??
      this.world.navigation.nearestWalkable(origin)
    );
  }

  private makeName(sex: Sex): string {
    const family = this.randomSource.pick(FAMILY_NAMES) ?? 'del Valle';
    return `${this.givenName(sex)} ${family}`;
  }

  private givenName(sex: Sex): string {
    const pool = sex === 'f' ? FEMININE_NAMES : MASCULINE_NAMES;
    return this.randomSource.pick(pool) ?? 'Villager';
  }

  /**
   * An even coin, from the seeded stream.
   *
   * Used for children and for newcomers, where an unbalanced generation is a
   * real outcome the settlement lives with. **Not** used for the founders —
   * see {@link spawnNear} for why that party is dealt rather than rolled.
   */
  private rollSex(): Sex {
    return this.randomSource.next() < 0.5 ? 'f' : 'm';
  }
}
