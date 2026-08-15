/**
 * A villager: an autonomous simulation entity.
 *
 * The authoritative one. A sprite elsewhere is a picture of this object, never
 * a second copy of it.
 *
 * Status: Phase 12. Identity, position, movement, job assignment, a carried
 * inventory, needs, a home and an age that actually advances are all live.
 *
 * `profession` is still not modelled: villagers take whatever work the job
 * board offers rather than holding a trade.
 */

import { WORKING_AGE } from '@/data/population';
import type { GridPoint, WorldPoint } from '@/shared/types/geometry';
import { Inventory } from '@/simulation/resources/Inventory';

/** How many units a villager can carry at once, across all resources. */
const CARRY_CAPACITY = 10;

/** What a villager is doing, as far as the renderer needs to know. */
export type VillagerActivity = 'idle' | 'walking' | 'working' | 'hauling';

export interface VillagerNeeds {
  /** 0 = starving, 100 = full. */
  hunger: number;
  /** 0 = freezing, 100 = warm. */
  warmth: number;
  /** 0 = dead, 100 = healthy. */
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
  /** What the villager is physically carrying. */
  public readonly inventory = new Inventory(CARRY_CAPACITY);

  /** Remaining waypoints. Empty when standing still. */
  public path: GridPoint[] = [];
  /** Ticks to wait before looking for something else to do. */
  public idleTicks = 0;
  /** Set when a path was requested but has not been computed yet. */
  public awaitingPath = false;
  /** Where the villager is trying to get to, if anywhere. */
  public destination: GridPoint | null = null;
  /** The job this villager has claimed, or `null` when unemployed. */
  public currentJobId: number | null = null;

  /**
   * The house this villager lives in, or `null` when there is no room.
   *
   * Homelessness is survivable in the mild seasons and dangerous in winter: a
   * fire warms a house, and someone with no house to go back to gets very
   * little out of the settlement's firewood.
   */
  public homeId: number | null = null;

  /** The age this villager will not outlive. Drawn from the seeded stream. */
  public lifespan: number;

  /** Days lived since the last birthday, so ageing is not a yearly jump. */
  public daysSinceBirthday = 0;

  /** Days until this villager's household will consider another child. */
  public birthCooldownDays = 0;

  constructor(options: {
    id: number;
    name: string;
    age: number;
    position: WorldPoint;
    lifespan: number;
  }) {
    this.id = options.id;
    this.name = options.name;
    this.age = options.age;
    this.position = options.position;
    this.previousPosition = options.position;
    this.lifespan = options.lifespan;
  }

  /** Children do not work. They eat, and they grow up. */
  public get isAdult(): boolean {
    return this.age >= WORKING_AGE;
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
