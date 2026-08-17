/**
 * What the settlement did to the ground it felled, and what the ground does next.
 *
 * Until now every felled tree was the same felled tree: the cell became grass and
 * the wild spread might, over years, creep back into it. That made the two things
 * a player fells for indistinguishable — **clearing a site** and **cutting
 * timber** — and it made the Forester's Lodge a convenience rather than a
 * decision.
 *
 * The rule this file implements has three parts:
 *
 * - **A tree cut for timber leaves a stump, and the stump comes back in five
 *   years.** That is felling done by a workshop under its own orders: the
 *   Woodcutter working its round, the lodge thinning its coppice. Wood tended
 *   this way lasts for ever without anybody watching it.
 * - **A tree the player marks is gone for good.** Marking a tree is how you clear
 *   ground to build on, and ground you cleared should stay cleared — a sapling
 *   appearing where you meant to put a house is the game undoing your work.
 * - **Unless a forester's lodge stands within reach**, in which case even a
 *   player's felling leaves a stump. That is what the lodge is *for*: the woods
 *   around it recover from anything.
 *
 * Barren ground refuses the wild spread and refuses its own stump. It does not
 * refuse a **forester planting deliberately** — a lodge put up later reclaims
 * what was cleared, which is the same asymmetry the rest of the forestry has:
 * the wilderness gives back only so much, and anything more is something you did
 * on purpose.
 *
 * All of it is saved. A settlement that forgot which of its clearings were
 * permanent would grow trees back through the middle of the village.
 */

import type { GridPoint } from '@/shared/types/geometry';
import { DAYS_PER_YEAR } from '@/simulation/seasons/SeasonClock';

/** Years before a stump is a tree again. */
export const REGROWTH_YEARS = 5;

/** The same, in days, which is what the clock actually counts. */
export const REGROWTH_DAYS = REGROWTH_YEARS * DAYS_PER_YEAR;

/** A felled tree that is coming back, and the day it does. */
export interface Stump {
  readonly gx: number;
  readonly gy: number;
  /** Settlement day the sapling appears on. */
  readonly day: number;
}

/**
 * Cells are packed into one number so both collections can be plain Sets and
 * Maps. The map is at most a few hundred cells square, so a multiplier of 4096
 * has room to spare and keeps the arithmetic obvious.
 */
const STRIDE = 4096;

function key(cell: GridPoint): number {
  return cell.gy * STRIDE + cell.gx;
}

export class Woodland {
  private readonly stumps = new Map<number, Stump>();
  private readonly barren = new Set<number>();

  /**
   * Records a felled tree that will grow back.
   *
   * @param today the settlement day it was felled on
   */
  public stump(cell: GridPoint, today: number): void {
    const at = key(cell);
    // A stump on ground somebody had cleared for good un-clears it: the last
    // thing done to a cell is what it remembers.
    this.barren.delete(at);
    this.stumps.set(at, { gx: cell.gx, gy: cell.gy, day: today + REGROWTH_DAYS });
  }

  /** Records ground cleared for good. Nothing grows here on its own again. */
  public clear(cell: GridPoint): void {
    const at = key(cell);
    this.stumps.delete(at);
    this.barren.add(at);
  }

  /** `true` when this cell was cleared on purpose and refuses to grow back. */
  public isBarren(cell: GridPoint): boolean {
    return this.barren.has(key(cell));
  }

  /**
   * A forester planted here: the cell forgets whatever was decided about it.
   *
   * Both collections, because a lodge planting on a stump has made its own
   * arrangement and the pending regrowth is no longer owed.
   */
  public planted(cell: GridPoint): void {
    const at = key(cell);
    this.stumps.delete(at);
    this.barren.delete(at);
  }

  /**
   * The stumps whose five years are up, removed from the ledger as they are
   * handed over. The caller plants them, or does not — either way the stump has
   * had its turn.
   */
  public due(today: number): Stump[] {
    const ready: Stump[] = [];
    for (const [at, stump] of this.stumps) {
      if (stump.day <= today) {
        ready.push(stump);
        this.stumps.delete(at);
      }
    }
    return ready;
  }

  public get stumpCount(): number {
    return this.stumps.size;
  }

  public get barrenCount(): number {
    return this.barren.size;
  }

  /** Everything worth saving: the pending stumps and the cleared ground. */
  public state(): {
    readonly stumps: readonly Stump[];
    readonly barren: readonly (readonly [number, number])[];
  } {
    return {
      stumps: [...this.stumps.values()],
      barren: [...this.barren].map((at) => [at % STRIDE, Math.floor(at / STRIDE)] as const),
    };
  }

  public restore(state: {
    readonly stumps?: readonly Stump[];
    readonly barren?: readonly (readonly [number, number])[];
  }): void {
    this.stumps.clear();
    this.barren.clear();
    for (const stump of state.stumps ?? []) {
      this.stumps.set(key(stump), stump);
    }
    for (const [gx, gy] of state.barren ?? []) {
      this.barren.add(key({ gx, gy }));
    }
  }

  public clearAll(): void {
    this.stumps.clear();
    this.barren.clear();
  }
}
