/**
 * The authoritative game state.
 *
 * Status: SKELETON (Phase 1). It owns the seed, the RNG and the tick counter,
 * and nothing else yet — world, villagers, jobs and buildings arrive in
 * Phases 2-8. It exists now so that the layering is real from the first commit:
 * the renderer already reads its state instead of holding its own.
 *
 * Rules for everything added here later:
 * - no Phaser, no DOM, no `Math.random()` (all enforced by ESLint);
 * - all mutation happens inside `tick()`, driven by the SimulationClock;
 * - the renderer reads, never writes. Player intent arrives as commands.
 */

import { SeededRandom, deriveSeed, type RandomSource } from '@/shared/math/random';

/** A read-only view of the simulation, safe to hand to the renderer and HUD. */
export interface SimulationSnapshot {
  readonly seed: number;
  readonly tick: number;
  /** Population. Always 0 until Phase 3 introduces villagers. */
  readonly villagerCount: number;
}

export interface SimulationOptions {
  readonly seed: number;
}

export class Simulation {
  private readonly seed: number;
  /** Stream reserved for world generation, kept separate from other systems. */
  private readonly worldRandom: RandomSource;
  private currentTick = 0;

  constructor(options: SimulationOptions) {
    this.seed = options.seed >>> 0;
    this.worldRandom = new SeededRandom(deriveSeed(this.seed, 'world'));
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
    // Phase 2+ : world, villagers, jobs, logistics, production, seasons.
  }

  public snapshot(): SimulationSnapshot {
    return {
      seed: this.seed,
      tick: this.currentTick,
      villagerCount: 0,
    };
  }

  /**
   * Exposed for the systems added in later phases; also keeps the world stream
   * referenced so its determinism contract is visible from the outset.
   */
  public get random(): RandomSource {
    return this.worldRandom;
  }
}
