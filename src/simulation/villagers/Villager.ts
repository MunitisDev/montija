/**
 * A villager: an autonomous simulation entity.
 *
 * The authoritative one. A sprite elsewhere is a picture of this object, never
 * a second copy of it.
 *
 * Status: Phase 3. Identity, position and movement are live. `hunger`, `warmth`
 * and `health` exist because the brief's initial model calls for them, but
 * **nothing changes them until Phase 8** — they are inert fields, not a working
 * needs system. `homeId`, `profession` and `currentJobId` arrive with Phases 6,
 * 7 and 4 respectively.
 */

import type { GridPoint, WorldPoint } from '@/shared/types/geometry';

/** What a villager is doing, as far as the renderer needs to know. */
export type VillagerActivity = 'idle' | 'walking';

export interface VillagerNeeds {
  /** 0 = starving, 100 = full. Inert until Phase 8. */
  hunger: number;
  /** 0 = freezing, 100 = warm. Inert until Phase 8. */
  warmth: number;
  /** 0 = dead, 100 = healthy. Inert until Phase 8. */
  health: number;
}

export class Villager {
  public readonly id: number;
  public readonly name: string;
  public age: number;

  /** Continuous position, in world units (one unit = one cell). */
  public position: WorldPoint;
  /**
   * Position at the start of the current tick.
   *
   * The renderer interpolates between this and {@link position} using the
   * clock's tick alpha, so movement looks smooth at 60fps even though the
   * simulation only steps 10 times a second.
   */
  public previousPosition: WorldPoint;

  public activity: VillagerActivity = 'idle';
  public readonly needs: VillagerNeeds = { hunger: 100, warmth: 100, health: 100 };

  /** Remaining waypoints. Empty when standing still. */
  public path: GridPoint[] = [];
  /** Ticks to wait before looking for something else to do. */
  public idleTicks = 0;
  /** Set when a path was requested but has not been computed yet. */
  public awaitingPath = false;
  /** Where the villager is trying to get to, if anywhere. */
  public destination: GridPoint | null = null;

  constructor(options: { id: number; name: string; age: number; position: WorldPoint }) {
    this.id = options.id;
    this.name = options.name;
    this.age = options.age;
    this.position = options.position;
    this.previousPosition = options.position;
  }

  /** The cell the villager is currently standing in. */
  public get cell(): GridPoint {
    return { gx: Math.floor(this.position.wx), gy: Math.floor(this.position.wy) };
  }

  public get isMoving(): boolean {
    return this.path.length > 0;
  }

  /** Abandons the current route. */
  public clearPath(): void {
    this.path = [];
    this.destination = null;
    this.awaitingPath = false;
    this.activity = 'idle';
  }
}
