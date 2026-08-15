/**
 * Roads: the one thing a player can lay that makes the settlement itself work
 * better.
 *
 * Every economic problem this game has turned out to be a hauling problem. The
 * balance work found the settlement starving with food piled beside the hut
 * because nobody would carry it in; the fix was priorities, and priorities only
 * decide *what* gets carried, never how long the carrying takes. A road is the
 * player's answer to the second half — the first decision in the game that is
 * about the *shape* of the settlement rather than its contents.
 *
 * Deliberately a layer over the terrain rather than a terrain type. A road is
 * something laid on ground that still has its own character: felling the trees
 * under a road must not un-road it, and lifting a road must give back the
 * meadow rather than a generic patch of dirt.
 *
 * A bit per cell, in a `Uint8Array`. On a 96×96 map that is nine kilobytes,
 * which is cheaper than any object-per-road bookkeeping and makes the
 * pathfinding lookup a single array read.
 */

import type { GridPoint } from '@/shared/types/geometry';

/**
 * How much of a step's cost a road removes.
 *
 * Roughly half. Enough that a long haul along one is visibly quicker and worth
 * planning around, and not so much that a settlement without roads feels
 * broken — the game has to remain winnable by someone who never lays one.
 */
export const ROAD_COST_MULTIPLIER = 0.55;

/** How much faster a villager walks on a road. The inverse of the cost. */
export const ROAD_SPEED_MULTIPLIER = 1 / ROAD_COST_MULTIPLIER;

export class RoadGrid {
  public readonly width: number;
  public readonly height: number;
  private readonly cells: Uint8Array;
  private roadCount = 0;
  private changeVersion = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height);
  }

  /** Bumped whenever a road is laid or lifted, so renderers can skip diffing. */
  public get version(): number {
    return this.changeVersion;
  }

  public get count(): number {
    return this.roadCount;
  }

  public has(gx: number, gy: number): boolean {
    if (!this.contains(gx, gy)) {
      return false;
    }
    return this.cells[gy * this.width + gx] === 1;
  }

  public hasAt(cell: GridPoint): boolean {
    return this.has(cell.gx, cell.gy);
  }

  /** Lays a road. Returns `false` when there was already one, or off the map. */
  public lay(gx: number, gy: number): boolean {
    if (!this.contains(gx, gy) || this.has(gx, gy)) {
      return false;
    }
    this.cells[gy * this.width + gx] = 1;
    this.roadCount += 1;
    this.changeVersion += 1;
    return true;
  }

  /** Lifts a road. Returns `false` when there was none. */
  public lift(gx: number, gy: number): boolean {
    if (!this.has(gx, gy)) {
      return false;
    }
    this.cells[gy * this.width + gx] = 0;
    this.roadCount -= 1;
    this.changeVersion += 1;
    return true;
  }

  public contains(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
  }

  /** Every road cell, for saving and for drawing. */
  public all(): GridPoint[] {
    const cells: GridPoint[] = [];
    for (let index = 0; index < this.cells.length; index += 1) {
      if (this.cells[index] === 1) {
        cells.push({ gx: index % this.width, gy: Math.floor(index / this.width) });
      }
    }
    return cells;
  }

  /** Replaces every road from a save. */
  public restore(cells: readonly GridPoint[]): void {
    this.cells.fill(0);
    this.roadCount = 0;
    for (const cell of cells) {
      this.lay(cell.gx, cell.gy);
    }
    this.changeVersion += 1;
  }
}
