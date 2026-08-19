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
import { treeStage, type TreeStage } from './TreeGrowth';
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
  /**
   * The settlement day, so a tree can be asked how big it is.
   *
   * Held here rather than passed in at every call because a tree's size is asked
   * for by the renderer, the job board and the panel, and threading a day through
   * all three would put the same argument in twenty signatures. Set once a day by
   * the simulation — see {@link setDay}.
   */
  private today = 0;

  constructor(width: number, trees: readonly TreeInstance[]) {
    this.width = width;
    for (const tree of trees) {
      this.byId.set(tree.id, tree);
      this.byCell.set(this.cellIndex(tree.gx, tree.gy), tree.id);
      this.nextId = Math.max(this.nextId, tree.id + 1);
    }
  }

  /** The day the registry is answering questions about. */
  public get day(): number {
    return this.today;
  }

  /**
   * Moves the calendar on, and reports whether any tree changed size.
   *
   * **The version is bumped only when a tree actually crosses a threshold**, which
   * on most days is never: the renderer watches that integer instead of rescaling
   * two thousand sprites, so a day where nothing grew has to cost nothing. A tree
   * crosses at most twice in its life, so the two comparisons per tree per day are
   * the whole price of visible growth.
   */
  public setDay(day: number): void {
    if (day === this.today) {
      return;
    }
    const before = this.today;
    this.today = day;
    for (const tree of this.byId.values()) {
      if (treeStage(tree.planted, before) !== treeStage(tree.planted, day)) {
        this.changeVersion += 1;
        return;
      }
    }
  }

  /** How far along a tree is today. */
  public stage(tree: TreeInstance): TreeStage {
    return treeStage(tree.planted, this.today);
  }

  /** `true` when this tree would give timber. Nothing else may be felled for logs. */
  public isMature(tree: TreeInstance): boolean {
    return this.stage(tree) === 'mature';
  }

  /**
   * Puts a new tree on a cell.
   *
   * The caller decides whether the ground will take one — the registry only
   * refuses to stack two trees on one cell, which is the invariant it owns.
   */
  public plant(
    gx: number,
    gy: number,
    variant: number,
    scale: number,
    /** The day it took root. Defaults to today, which is what planting means. */
    planted: number = this.today,
  ): TreeInstance | null {
    const index = this.cellIndex(gx, gy);
    if (this.byCell.has(index)) {
      return null;
    }

    const tree: TreeInstance = { id: this.nextId, gx, gy, variant, scale, planted };
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
