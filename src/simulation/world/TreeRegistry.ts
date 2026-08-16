/**
 * The trees standing on the map.
 *
 * Separated from world generation because trees stop being static the moment
 * villagers can fell them. Two lookups matter and both are kept O(1): by id
 * (for jobs, which reference the tree they target) and by cell (for tapping,
 * and for checking whether ground is clear).
 *
 * `version` increments on every change. The renderer watches it instead of
 * diffing ~2,000 sprites every frame — trees change rarely, so polling a single
 * integer is the right trade.
 */

import type { GridPoint } from '@/shared/types/geometry';
import type { TreeInstance } from './WorldGenerator';

export class TreeRegistry {
  private readonly byId = new Map<number, TreeInstance>();
  /** Cell index (`gy * width + gx`) to tree id. */
  private readonly byCell = new Map<number, number>();
  private readonly width: number;
  private changeVersion = 0;
  /**
   * The next id to hand out.
   *
   * Trees stopped being a fixed set the day forests learned to grow back, so
   * the registry now mints ids rather than only holding the ones generation
   * handed it. Always above every id it has ever seen, including after a
   * restore, or a new sapling would take the id of a tree somebody's job is
   * still pointing at.
   */
  private nextId = 1;

  constructor(width: number, trees: readonly TreeInstance[]) {
    this.width = width;
    for (const tree of trees) {
      this.byId.set(tree.id, tree);
      this.byCell.set(this.cellIndex(tree.gx, tree.gy), tree.id);
      this.nextId = Math.max(this.nextId, tree.id + 1);
    }
  }

  /**
   * Puts a new tree on a cell.
   *
   * The caller decides whether the ground will take one — the registry only
   * refuses to stack two trees on one cell, which is the invariant it owns.
   */
  public plant(gx: number, gy: number, variant: number, scale: number): TreeInstance | null {
    const index = this.cellIndex(gx, gy);
    if (this.byCell.has(index)) {
      return null;
    }

    const tree: TreeInstance = { id: this.nextId, gx, gy, variant, scale };
    this.nextId += 1;
    this.byId.set(tree.id, tree);
    this.byCell.set(index, tree.id);
    this.changeVersion += 1;
    return tree;
  }

  public get count(): number {
    return this.byId.size;
  }

  /** Bumped whenever a tree is added or removed. */
  public get version(): number {
    return this.changeVersion;
  }

  public get all(): Iterable<TreeInstance> {
    return this.byId.values();
  }

  public getById(id: number): TreeInstance | null {
    return this.byId.get(id) ?? null;
  }

  public getAt(cell: GridPoint): TreeInstance | null {
    const id = this.byCell.get(this.cellIndex(cell.gx, cell.gy));
    return id === undefined ? null : (this.byId.get(id) ?? null);
  }

  public has(cell: GridPoint): boolean {
    return this.byCell.has(this.cellIndex(cell.gx, cell.gy));
  }

  /** Fells a tree. Returns it, or `null` when it was already gone. */
  public remove(id: number): TreeInstance | null {
    const tree = this.byId.get(id);
    if (!tree) {
      return null;
    }
    this.byId.delete(id);
    this.byCell.delete(this.cellIndex(tree.gx, tree.gy));
    this.changeVersion += 1;
    return tree;
  }

  /** Repopulates from a save. Replaces whatever is standing. */
  public restore(trees: readonly TreeInstance[]): void {
    this.byId.clear();
    this.byCell.clear();
    this.nextId = 1;
    for (const tree of trees) {
      this.byId.set(tree.id, tree);
      this.byCell.set(this.cellIndex(tree.gx, tree.gy), tree.id);
      this.nextId = Math.max(this.nextId, tree.id + 1);
    }
    this.changeVersion += 1;
  }

  private cellIndex(gx: number, gy: number): number {
    return gy * this.width + gx;
  }
}
