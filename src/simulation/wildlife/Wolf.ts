/**
 * One wolf, on the map, where the player can see it.
 *
 * **This is the entity the old rule did without.** A raid used to be a
 * calculation at the day boundary: a pack "came down", a heap of turnips lost
 * fifteen, and on a bad night somebody was gone — none of it visible, none of it
 * happening anywhere. The rules were right and the drama was missing, and a
 * hardship the player cannot watch is a hardship they cannot answer.
 *
 * So a wolf is a thing with a position, a target and a wound, updated on the
 * simulation's own tick like a villager. What it is *not* is a villager: it takes
 * no jobs, holds no reservations, needs no housing and never appears in a
 * population count. The two share the map and nothing else.
 *
 * **Plain data with almost no behaviour**, deliberately: the pack's decisions live
 * in `WolfSystem` and the fighting in `Combat.ts`, because a wolf that decided
 * things for itself would be a second AI to keep deterministic.
 */

import type { GridPoint, WorldPoint } from '@/shared/types/geometry';

/** What a wolf is doing, which is the whole of its mind. */
export type WolfState =
  /** Coming out of the trees toward whatever it came for. */
  | 'closing'
  /** At the wall it cannot cross, and working at it. */
  | 'gnawing'
  /** Beside a villager, and biting. */
  | 'fighting'
  /** Beaten, or full, and going back to the wood. */
  | 'leaving';

export class Wolf {
  public readonly id: number;
  public position: WorldPoint;
  /**
   * Position at the start of the tick, for the renderer to interpolate from.
   *
   * The same contract villagers have, so the two move with the same smoothness
   * at 60fps over a simulation that steps ten times a second.
   */
  public previousPosition: WorldPoint;
  public state: WolfState = 'closing';
  /**
   * How much fight is left in it, from {@link WOLF_VIGOUR} down to nothing.
   *
   * A wolf is worth a villager and this is the number that says so: see
   * `Combat.ts`, where both sides spend the same currency at the same rate.
   */
  public vigour: number;
  /** The villager it is biting, or `null`. */
  public quarryId: number | null = null;
  /** Where it is heading when it has nobody to bite. */
  public destination: GridPoint | null = null;
  /** The cell of wall it is working at, or `null`. */
  public gnawingAt: GridPoint | null = null;
  /** How much it has carried off, so a fed pack goes home. */
  public eaten = 0;

  constructor(id: number, at: GridPoint, vigour: number) {
    this.id = id;
    this.position = { wx: at.gx + 0.5, wy: at.gy + 0.5 };
    this.previousPosition = this.position;
    this.vigour = vigour;
  }

  public get cell(): GridPoint {
    return { gx: Math.floor(this.position.wx), gy: Math.floor(this.position.wy) };
  }

  public get isDead(): boolean {
    return this.vigour <= 0;
  }
}
