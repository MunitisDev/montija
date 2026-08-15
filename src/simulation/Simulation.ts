/**
 * The authoritative game state.
 *
 * Status: Phase 8. Owns the seed, the RNG, the tick counter, the world, the
 * villagers, the job board, the storage yards, the calendar and survival.
 *
 * Rules for everything added here later:
 * - no Phaser, no DOM, no `Math.random()` (all enforced by ESLint);
 * - all mutation happens inside `update()`, driven by the SimulationClock;
 * - the renderer reads, never writes. Player intent arrives as commands.
 */

import type { GridPoint } from '@/shared/types/geometry';
import { SeededRandom, deriveSeed, type RandomSource } from '@/shared/math/random';
import type { BuildingId } from '@/data/buildings';
import { recipe as findRecipe } from '@/data/recipes';
import { RESOURCE_IDS, type ResourceId } from '@/data/resources';
import type { Building } from './buildings/Building';
import type { PlacementCheck } from './buildings/BuildingRegistry';
import { JobPriority } from './jobs/Job';
import { JobManager } from './jobs/JobManager';
import { StorageRegistry } from './logistics/Storage';
import {
  SEASON_FORAGE_SCALE,
  isDayBoundary,
  yearStateAt,
  type Season,
  type YearState,
} from './seasons/SeasonClock';
import { EMPTY_REPORT, runDay, type DailyReport } from './seasons/SurvivalSystem';
import { VillagerSystem } from './villagers/VillagerSystem';
import { World } from './world/World';

/** A read-only view of the simulation, safe to hand to the renderer and HUD. */
export interface SimulationSnapshot {
  readonly seed: number;
  readonly tick: number;
  readonly villagerCount: number;
  readonly treeCount: number;
  readonly walkingCount: number;
  readonly workingCount: number;
  readonly pathRequests: number;
  readonly pathFailures: number;
  readonly jobsAvailable: number;
  readonly jobsAssigned: number;
  readonly jobsCompleted: number;
  readonly pileCount: number;
  readonly buildingCount: number;
  readonly sitesUnderConstruction: number;
  readonly housingCapacity: number;
  readonly season: Season;
  readonly year: number;
  readonly dayOfSeason: number;
  readonly temperature: number;
  /** What the settlement ate and burned on the last day that passed. */
  readonly lastDay: DailyReport;
  readonly deaths: number;
  /** Lowest health among the living, so the HUD can warn before people die. */
  readonly lowestHealth: number;
  /**
   * Stored totals per resource.
   *
   * A **cached summary** of what the storage yards physically hold. Resources
   * lying on the ground are deliberately excluded, so felling a tree does not
   * move the counter until someone has carried the logs in.
   */
  readonly stored: Readonly<Record<ResourceId, number>>;
  /** Units lying on the ground, waiting to be hauled. */
  readonly loose: Readonly<Record<ResourceId, number>>;
}

export interface SimulationOptions {
  readonly seed: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** Founding population. The MVP starts with roughly ten. */
  readonly startingVillagers: number;
}

export class Simulation {
  public readonly world: World;
  public readonly villagers: VillagerSystem;
  public readonly jobs: JobManager;
  public readonly storages = new StorageRegistry();

  private readonly seed: number;
  private readonly tickRandom: RandomSource;
  private currentTick = 0;
  private lastDayReport: DailyReport = EMPTY_REPORT;
  private totalDeaths = 0;

  constructor(options: SimulationOptions) {
    this.seed = options.seed >>> 0;
    this.tickRandom = new SeededRandom(deriveSeed(this.seed, 'tick'));

    this.world = new World({
      width: options.worldWidth,
      height: options.worldHeight,
      seed: this.seed,
    });

    this.jobs = new JobManager();

    // Villagers get their own RNG stream, so adding a call here cannot shift
    // the terrain or the tree layout.
    this.villagers = new VillagerSystem(
      this.world,
      this.jobs,
      this.storages,
      new SeededRandom(deriveSeed(this.seed, 'villagers')),
    );

    this.foundStorageYard();
    this.villagers.spawnNear(this.world.centreCell, options.startingVillagers);

    // Foraging follows the calendar; winter yields nothing at all.
    this.villagers.productionScaleProvider = () => SEASON_FORAGE_SCALE[this.year.season];
  }

  public get worldSeed(): number {
    return this.seed;
  }

  public get tick(): number {
    return this.currentTick;
  }

  /** Advances the world by exactly one fixed tick. */
  public update(tick: number, tickSeconds: number): void {
    this.currentTick = tick;

    // A day's supplies are consumed at the day boundary, before work is done,
    // so a settlement that ran out overnight feels it immediately.
    if (isDayBoundary(tick)) {
      this.runDailyUpkeep();
    }

    this.createConstructionJobs();
    this.createProductionJobs();
    this.createHaulJobs();
    this.villagers.update(tickSeconds);
    // Phase 7+ : production, seasons.
  }

  /**
   * Marks a tree for felling, creating the job that does it.
   *
   * A command, not a mutation: the player expresses intent and the simulation
   * decides what happens. Returns `false` when the tree is gone or already
   * designated, so the UI can tell the difference between "done" and "no".
   */
  public designateTreeForFelling(cell: GridPoint): boolean {
    const tree = this.world.trees.getAt(cell);
    if (!tree) {
      return false;
    }

    const job = this.jobs.create({
      type: 'chop-tree',
      target: { gx: tree.gx, gy: tree.gy },
      priority: JobPriority.normal,
      targetEntityId: tree.id,
    });

    return job !== null;
  }

  /** Cancels a felling designation, if the tree has one. */
  public cancelTreeDesignation(cell: GridPoint): boolean {
    const tree = this.world.trees.getAt(cell);
    if (!tree) {
      return false;
    }

    const job = this.jobs.findByTarget('chop-tree', tree.id);
    if (!job) {
      return false;
    }

    this.jobs.cancel(job.id);
    this.releaseVillagersFrom(job.id);
    return true;
  }

  /** `true` when this cell's tree is already marked for felling. */
  public isTreeDesignated(cell: GridPoint): boolean {
    const tree = this.world.trees.getAt(cell);
    return tree !== null && this.jobs.isTargetReserved('chop-tree', tree.id);
  }

  public snapshot(): SimulationSnapshot {
    const villagerStats = this.villagers.stats();
    const jobStats = this.jobs.stats();
    const year = this.year;
    return {
      seed: this.seed,
      tick: this.currentTick,
      villagerCount: this.villagers.count,
      treeCount: this.world.trees.count,
      walkingCount: villagerStats.walking,
      workingCount: villagerStats.working,
      pathRequests: villagerStats.pathRequests,
      pathFailures: villagerStats.pathFailures,
      jobsAvailable: jobStats.available,
      jobsAssigned: jobStats.assigned,
      jobsCompleted: jobStats.completed,
      pileCount: this.world.piles.count,
      buildingCount: this.world.buildings.count,
      sitesUnderConstruction: this.world.buildings.underConstruction().length,
      housingCapacity: this.world.buildings.housingCapacity,
      season: year.season,
      year: year.year,
      dayOfSeason: year.dayOfSeason,
      temperature: year.temperature,
      lastDay: this.lastDayReport,
      deaths: this.totalDeaths,
      lowestHealth: this.villagers.all.reduce(
        (lowest, villager) => Math.min(lowest, villager.needs.health),
        this.villagers.count === 0 ? 0 : 100,
      ),
      stored: this.totalsFrom((resource) => this.storages.totalOf(resource)),
      loose: this.totalsFrom((resource) => this.world.piles.totalOf(resource)),
    };
  }

  private totalsFrom(read: (resource: ResourceId) => number): Record<ResourceId, number> {
    const totals = {} as Record<ResourceId, number>;
    for (const resource of RESOURCE_IDS) {
      totals[resource] = read(resource);
    }
    return totals;
  }

  /** Marks a stone deposit for mining. */
  public designateStoneForMining(cell: GridPoint): boolean {
    if (this.world.terrainAt(cell) !== 'stone') {
      return false;
    }
    // Deposits have no entity id, so the cell itself is the exclusive target.
    const cellId = cell.gy * this.world.width + cell.gx;
    const job = this.jobs.create({
      type: 'gather-stone',
      target: cell,
      priority: JobPriority.normal,
      targetEntityId: cellId,
    });
    return job !== null;
  }

  public cancelStoneDesignation(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    const job = this.jobs.findByTarget('gather-stone', cellId);
    if (!job) {
      return false;
    }
    this.jobs.cancel(job.id);
    this.releaseVillagersFrom(job.id);
    return true;
  }

  public isStoneDesignated(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    return this.jobs.isTargetReserved('gather-stone', cellId);
  }

  /** The calendar at the current tick. */
  public get year(): YearState {
    return yearStateAt(this.currentTick);
  }

  /** `true` when everyone has died. The settlement has failed. */
  public get hasFailed(): boolean {
    return this.villagers.count === 0;
  }

  /**
   * Eats, burns firewood, and buries whoever did not make it.
   *
   * Deaths remove the villager outright. There is no illness model — the brief
   * asks for consequences, not a medical simulation.
   */
  private runDailyUpkeep(): void {
    const { report, dead } = runDay(this.villagers.all, this.storages, this.year);
    this.lastDayReport = report;

    for (const villager of dead) {
      this.villagers.remove(villager.id);
      this.totalDeaths += 1;
    }
  }

  /** Whether a building may be placed here. Used by the ghost and the command. */
  public canPlaceBuilding(buildingId: BuildingId, origin: GridPoint): PlacementCheck {
    return this.world.buildings.canPlace(this.world, buildingId, origin);
  }

  /**
   * Places a construction site.
   *
   * A command: the player states intent and the simulation decides. Nothing is
   * built here — the site starts empty and needs materials carried to it.
   */
  public placeBuilding(buildingId: BuildingId, origin: GridPoint): Building | null {
    return this.world.buildings.place(this.world, buildingId, origin);
  }

  /**
   * Keeps construction sites supplied and staffed.
   *
   * Materials first: a site that still needs logs gets haul jobs pointed at it,
   * sourced from the storage yards rather than from thin air. Only once
   * everything has physically arrived is a build job posted.
   */
  private createConstructionJobs(): void {
    for (const site of this.world.buildings.underConstruction()) {
      if (!site.hasAllMaterials) {
        this.requestMaterialsFor(site);
        continue;
      }

      if (!this.jobs.isTargetReserved('build', site.id)) {
        this.jobs.create({
          type: 'build',
          target: site.accessCell,
          priority: JobPriority.high,
          targetEntityId: site.id,
          workTicks: site.definition.buildTicks,
        });
      }
    }
  }

  /**
   * Posts haul jobs that move stored materials to a site.
   *
   * Sourced from a yard that actually holds the material: a site cannot be
   * built out of resources the settlement does not have, which is what makes
   * gathering matter.
   */
  private requestMaterialsFor(site: Building): void {
    for (const cost of site.definition.constructionCost) {
      if (site.stillNeeds(cost.resource) <= 0) {
        continue;
      }
      // One delivery run per material at a time; the next is posted after this
      // one lands, which keeps the board short and the reservation simple.
      const reservationId = site.id * 100 + RESOURCE_IDS.indexOf(cost.resource);
      if (this.jobs.isTargetReserved('haul', reservationId)) {
        continue;
      }

      const source = this.storages.all.find(
        (storage) => storage.inventory.count(cost.resource) > 0,
      );
      if (!source) {
        continue;
      }

      this.jobs.create({
        type: 'haul',
        target: source.cell,
        deliverTo: site.accessCell,
        priority: JobPriority.high,
        targetEntityId: reservationId,
        haulSource: 'storage',
        haulResource: cost.resource,
      });
    }
  }

  /**
   * Keeps production buildings supplied and working.
   *
   * A workshop that needs logs gets them hauled in from storage first; only
   * then is a production job posted. Nothing is produced from an empty store.
   */
  private createProductionJobs(): void {
    for (const building of this.world.buildings.all) {
      if (!building.isComplete || !building.definition.recipeId) {
        continue;
      }

      const recipe = findRecipe(building.definition.recipeId);
      if (!recipe) {
        continue;
      }

      const missing = recipe.inputs.filter(
        (input) => building.input.count(input.resource) < input.amount,
      );
      if (missing.length > 0) {
        this.requestInputsFor(
          building.id,
          building.accessCell,
          missing.map((m) => m.resource),
        );
        continue;
      }

      // One batch in flight per building, so a workshop does not queue up more
      // work than its inputs can support.
      if (!this.jobs.isTargetReserved('produce', building.id)) {
        this.jobs.create({
          type: 'produce',
          target: building.accessCell,
          priority: JobPriority.normal,
          targetEntityId: building.id,
          workTicks: recipe.workTicks,
        });
      }
    }
  }

  /** Hauls recipe inputs from storage to a workshop. */
  private requestInputsFor(
    buildingId: number,
    destination: GridPoint,
    resources: ResourceId[],
  ): void {
    for (const resource of resources) {
      // Offset the reservation id away from construction's, which uses the
      // same haul type against the same buildings.
      const reservationId = 500_000 + buildingId * 100 + RESOURCE_IDS.indexOf(resource);
      if (this.jobs.isTargetReserved('haul', reservationId)) {
        continue;
      }

      const source = this.storages.all.find((storage) => storage.inventory.count(resource) > 0);
      if (!source) {
        continue;
      }

      this.jobs.create({
        type: 'haul',
        target: source.cell,
        deliverTo: destination,
        priority: JobPriority.normal,
        targetEntityId: reservationId,
        haulSource: 'storage',
        haulResource: resource,
      });
    }
  }

  /**
   * Posts a hauling job for every unclaimed pile.
   *
   * Runs each tick, but is cheap: the job board refuses a second job against a
   * pile that already has one, so this is a scan of a short list rather than
   * repeated work. Generating jobs here rather than at the moment a pile
   * appears means piles left over from a cancelled haul get picked up again.
   */
  private createHaulJobs(): void {
    for (const pile of this.world.piles.all) {
      if (pile.isEmpty || this.jobs.isTargetReserved('haul', pile.id)) {
        continue;
      }

      const storage = this.storages.findNearestAccepting(pile.cell, pile.resource);
      if (!storage) {
        // Nowhere to put it. Leave the pile be; a new yard may appear later.
        continue;
      }

      this.jobs.create({
        type: 'haul',
        target: pile.cell,
        deliverTo: storage.cell,
        priority: JobPriority.normal,
        targetEntityId: pile.id,
      });
    }
  }

  /**
   * Places the settlement's founding storage yard.
   *
   * Phase 5 needs somewhere to haul to, and construction does not exist until
   * Phase 6. Rather than pretending resources teleport into an abstract stock,
   * the settlement simply starts with one yard already standing — which is also
   * what "a founding settlement" means.
   */
  private foundStorageYard(): void {
    const centre =
      this.world.navigation.nearestWalkable(this.world.centreCell) ?? this.world.centreCell;
    this.storages.add({ cell: centre, capacity: 2000 });
  }

  /** Frees any villager still holding a job that no longer exists. */
  private releaseVillagersFrom(jobId: number): void {
    for (const villager of this.villagers.all) {
      if (villager.currentJobId === jobId) {
        villager.currentJobId = null;
        villager.clearPath();
      }
    }
  }

  /** Exposed for the systems added in later phases. */
  public get random(): RandomSource {
    return this.tickRandom;
  }
}
