/**
 * A small fact about every cell of the map.
 *
 * Roads and palisades are the same shape of thing and nothing else about them is
 * alike: a road is a cost multiplier the settlement walks on, a palisade is a
 * barrier the settlement hides behind. What they share is the bookkeeping — a bit
 * per cell, a count, and a version renderers can poll instead of diffing
 * thousands of sprites — and that is what lives here.
 *
 * A byte per cell in a `Uint8Array`. On a 96×96 map that is nine kilobytes, which
 * is cheaper than any object-per-cell alternative and makes the pathfinding
 * lookup a single array read. Roads only ever need yes or no; a wall stores
 * *which kind* of wall in the same byte, which is why this holds a value rather
 * than a flag.
 *
 * Deliberately a layer over the terrain rather than a terrain type. Both of these
 * are things *laid on* ground that still has its own character: felling the trees
 * under a road must not un-road it, and taking a fence down must give back the
 * meadow rather than a generic patch of dirt.
 */

import type { GridPoint } from '@/shared/types/geometry';

export class CellFlagGrid {
  public readonly width: number;
  public readonly height: number;
  protected readonly cells: Uint8Array;
  private setCount = 0;
  private changeVersion = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height);
  }

  /** Bumped whenever a cell changes, so renderers can skip diffing. */
  public get version(): number {
    return this.changeVersion;
  }

  public get count(): number {
    return this.setCount;
  }

  public has(gx: number, gy: number): boolean {
    if (!this.contains(gx, gy)) {
      return false;
    }
    return (this.cells[gy * this.width + gx] ?? 0) !== 0;
  }

  public hasAt(cell: GridPoint): boolean {
    return this.has(cell.gx, cell.gy);
  }

  /** What is on a cell, or `0` for nothing. */
  public valueAt(gx: number, gy: number): number {
    if (!this.contains(gx, gy)) {
      return 0;
    }
    return this.cells[gy * this.width + gx] ?? 0;
  }

  /**
   * Sets a cell. Returns `false` off the map, or when the value is already there.
   *
   * Setting a cell that holds a *different* value succeeds and replaces it: that
   * is a palisade being built up in stone, which is one cell changing rather than
   * one cell going and another arriving.
   */
  public lay(gx: number, gy: number, value = 1): boolean {
    if (!this.contains(gx, gy) || value <= 0) {
      return false;
    }
    const index = gy * this.width + gx;
    const was = this.cells[index] ?? 0;
    if (was === value) {
      return false;
    }
    this.cells[index] = value;
    if (was === 0) {
      this.setCount += 1;
    }
    this.changeVersion += 1;
    return true;
  }

  /** Clears a cell. Returns `false` when there was nothing there. */
  public lift(gx: number, gy: number): boolean {
    if (!this.has(gx, gy)) {
      return false;
    }
    this.cells[gy * this.width + gx] = 0;
    this.setCount -= 1;
    this.changeVersion += 1;
    return true;
  }

  public contains(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
  }

  /** Every set cell, for saving and for drawing. */
  public all(): GridPoint[] {
    const cells: GridPoint[] = [];
    for (let index = 0; index < this.cells.length; index += 1) {
      if ((this.cells[index] ?? 0) !== 0) {
        cells.push({ gx: index % this.width, gy: Math.floor(index / this.width) });
      }
    }
    return cells;
  }

  /** Replaces every cell from a save. */
  public restore(cells: readonly GridPoint[]): void {
    this.cells.fill(0);
    this.setCount = 0;
    for (const cell of cells) {
      this.lay(cell.gx, cell.gy);
    }
    this.changeVersion += 1;
  }
}
