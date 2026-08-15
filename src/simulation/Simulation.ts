/**
 * The authoritative game state.
 *
 * Status: Phase 4. Owns the seed, the RNG, the tick counter, the world, the
 * villagers and the job board. Buildings, production and seasons join in
 * Phases 6-8.
 *
 * Rules for everything added here later:
 * - no Phaser, no DOM, no `Math.random()` (all enforced by ESLint);
 * - all mutation happens inside `update()`, driven by the SimulationClock;
 * - the renderer reads, never writes. Player intent arrives as commands.
 */

import type { GridPoint } from '@/shared/types/geometry';
import { SeededRandom, deriveSeed, type RandomSource } from '@/shared/math/random';
import { JobPriority } from './jobs/Job';
import { JobManager } from './jobs/JobManager';
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

  private readonly seed: number;
  private readonly tickRandom: RandomSource;
  private currentTick = 0;

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
      new SeededRandom(deriveSeed(this.seed, 'villagers')),
    );
    this.villagers.spawnNear(this.world.centreCell, options.startingVillagers);
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
    this.villagers.update(tickSeconds);
    // Phase 5+ : logistics, production, seasons.
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
    };
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
