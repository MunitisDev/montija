/**
 * The authoritative game state.
 *
 * Status: Phase 2. Owns the seed, the RNG, the tick counter and the world.
 * Villagers, jobs, buildings and seasons join in Phases 3-8.
 *
 * Rules for everything added here later:
 * - no Phaser, no DOM, no `Math.random()` (all enforced by ESLint);
 * - all mutation happens inside `update()`, driven by the SimulationClock;
 * - the renderer reads, never writes. Player intent arrives as commands.
 */

import { SeededRandom, deriveSeed, type RandomSource } from '@/shared/math/random';
import { World } from './world/World';

/** A read-only view of the simulation, safe to hand to the renderer and HUD. */
export interface SimulationSnapshot {
  readonly seed: number;
  readonly tick: number;
  /** Population. Always 0 until Phase 3 introduces villagers. */
  readonly villagerCount: number;
  readonly treeCount: number;
}

export interface SimulationOptions {
  readonly seed: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
}

export class Simulation {
  public readonly world: World;

  private readonly seed: number;
  /** Stream reserved for systems that need randomness during ticks. */
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
  }

  public get worldSeed(): number {
    return this.seed;
  }

  public get tick(): number {
    return this.currentTick;
  }

  /** Advances the world by exactly one fixed tick. */
  public update(tick: number, _tickSeconds: number): void {
    this.currentTick = tick;
    // Phase 3+ : villagers, jobs, logistics, production, seasons.
  }

  public snapshot(): SimulationSnapshot {
    return {
      seed: this.seed,
      tick: this.currentTick,
      villagerCount: 0,
      treeCount: this.world.trees.length,
    };
  }

  /** Exposed for the systems added in later phases. */
  public get random(): RandomSource {
    return this.tickRandom;
  }
}
