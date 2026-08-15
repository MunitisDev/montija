/**
 * The authoritative game state.
 *
 * Status: Phase 3. Owns the seed, the RNG, the tick counter, the world and the
 * villagers. Jobs, buildings and seasons join in Phases 4-8.
 *
 * Rules for everything added here later:
 * - no Phaser, no DOM, no `Math.random()` (all enforced by ESLint);
 * - all mutation happens inside `update()`, driven by the SimulationClock;
 * - the renderer reads, never writes. Player intent arrives as commands.
 */

import { SeededRandom, deriveSeed, type RandomSource } from '@/shared/math/random';
import { VillagerSystem } from './villagers/VillagerSystem';
import { World } from './world/World';

/** A read-only view of the simulation, safe to hand to the renderer and HUD. */
export interface SimulationSnapshot {
  readonly seed: number;
  readonly tick: number;
  readonly villagerCount: number;
  readonly treeCount: number;
  readonly walkingCount: number;
  readonly pathRequests: number;
  readonly pathFailures: number;
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

    // Villagers get their own RNG stream, so adding a call here cannot shift
    // the terrain or the tree layout.
    this.villagers = new VillagerSystem(
      this.world.navigation,
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
    // Phase 4+ : jobs, logistics, production, seasons.
  }

  public snapshot(): SimulationSnapshot {
    const villagerStats = this.villagers.stats();
    return {
      seed: this.seed,
      tick: this.currentTick,
      villagerCount: this.villagers.count,
      treeCount: this.world.trees.length,
      walkingCount: villagerStats.walking,
      pathRequests: villagerStats.pathRequests,
      pathFailures: villagerStats.pathFailures,
    };
  }

  /** Exposed for the systems added in later phases. */
  public get random(): RandomSource {
    return this.tickRandom;
  }
}
