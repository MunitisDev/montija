/**
 * Which of the settlement's clearings are permanent.
 *
 * Every felled tree used to be the same felled tree: the cell became grass and
 * the wild spread might, over years, creep back into it. That made the two things
 * a player fells for indistinguishable — **clearing a site** and **cutting
 * timber**.
 *
 * The rule is two lines long now, and the other half of it lives in
 * `TreeGrowth.ts`:
 *
 * - **A tree cut by a workshop leaves a sapling on the cell, the same
 *   afternoon.** That is the Feller's Hut working its round, and wood tended that
 *   way lasts for ever without anybody watching it. The waiting is done in the
 *   open, by a tree the player can see growing.
 * - **A tree the player marks is gone for good.** Marking a tree is how you clear
 *   ground to build on, and ground you cleared has to stay cleared — a sapling
 *   appearing where you meant to put a house is the game undoing your work.
 *
 * So all this file holds is the barren ground: the cells the player cleared, which
 * the wild spread may not creep back into. It is saved, because a settlement that
 * forgot which of its clearings were permanent would grow trees back through the
 * middle of the village.
 *
 * The ledger of stumps this class used to keep is gone with the Forester's Lodge.
 * A felled cell that owes a tree in five years is a fact only the save file knew;
 * a sapling standing on it is a fact the player can act on.
 */

import type { GridPoint } from '@/shared/types/geometry';

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
  private readonly barren = new Set<number>();

  /** Records ground cleared for good. Nothing grows here on its own again. */
  public clear(cell: GridPoint): void {
    this.barren.add(key(cell));
  }

  /**
   * Ground that is woodland again, whatever was decided about it before.
   *
   * A workshop cutting timber here, or a tree taking root: either way the last
   * thing done to a cell is what it remembers, so a clearing somebody has since
   * grown a wood back over stops being a clearing.
   */
  public reclaim(cell: GridPoint): void {
    this.barren.delete(key(cell));
  }

  /** `true` when this cell was cleared on purpose and refuses to grow back. */
  public isBarren(cell: GridPoint): boolean {
    return this.barren.has(key(cell));
  }

  public get barrenCount(): number {
    return this.barren.size;
  }

  /** Everything worth saving: the ground the player cleared for good. */
  public state(): { readonly barren: readonly (readonly [number, number])[] } {
    return {
      barren: [...this.barren].map((at) => [at % STRIDE, Math.floor(at / STRIDE)] as const),
    };
  }

  /**
   * Puts the clearings back.
   *
   * A save written while the Forester's Lodge existed carries a ledger of stumps
   * as well; it is ignored rather than translated. Those cells are standing wood
   * or open ground either way, and the trees on the map are what the save actually
   * recorded.
   */
  public restore(state: { readonly barren?: readonly (readonly [number, number])[] }): void {
    this.barren.clear();
    for (const [gx, gy] of state.barren ?? []) {
      this.barren.add(key({ gx, gy }));
    }
  }

  public clearAll(): void {
    this.barren.clear();
  }
}
