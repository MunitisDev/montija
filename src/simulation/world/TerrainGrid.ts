/**
 * The logical terrain grid — the authoritative map.
 *
 * Stored as a flat typed array of indices into {@link TERRAIN_TYPES} rather
 * than an array of strings or objects. At 128x128 that is one 16KB buffer
 * instead of ~16k heap objects, it serialises to a save trivially, and it
 * keeps per-tile lookups out of the garbage collector during simulation ticks.
 *
 * Rendering reads this. It never owns a second copy of the truth.
 */

import { TERRAIN_TYPES, type TerrainType } from '@/data/terrain';
import type { GridPoint } from '@/shared/types/geometry';

export class TerrainGrid {
  public readonly width: number;
  public readonly height: number;
  private readonly cells: Uint8Array;

  constructor(width: number, height: number, fill: TerrainType = 'grass') {
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height);
    const fillIndex = TERRAIN_TYPES.indexOf(fill);
    if (fillIndex > 0) {
      this.cells.fill(fillIndex);
    }
  }

  /** `true` when the cell lies inside the grid. */
  public contains(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
  }

  /**
   * The terrain at a cell.
   *
   * Out-of-bounds reads return `water`, which makes the map behave as though
   * it were surrounded by an impassable sea instead of throwing. Callers that
   * care about the difference should test {@link contains} first.
   */
  public get(gx: number, gy: number): TerrainType {
    if (!this.contains(gx, gy)) {
      return 'water';
    }
    const index = this.cells[gy * this.width + gx] ?? 0;
    return TERRAIN_TYPES[index] ?? 'grass';
  }

  public getAt(cell: GridPoint): TerrainType {
    return this.get(cell.gx, cell.gy);
  }

  public set(gx: number, gy: number, type: TerrainType): void {
    if (!this.contains(gx, gy)) {
      return;
    }
    const index = TERRAIN_TYPES.indexOf(type);
    if (index >= 0) {
      this.cells[gy * this.width + gx] = index;
    }
  }

  /** Visits every cell in row-major order. */
  public forEach(visit: (gx: number, gy: number, type: TerrainType) => void): void {
    for (let gy = 0; gy < this.height; gy += 1) {
      for (let gx = 0; gx < this.width; gx += 1) {
        visit(gx, gy, this.get(gx, gy));
      }
    }
  }

  /** How many cells hold the given terrain. Used by tests and the debug overlay. */
  public count(type: TerrainType): number {
    const index = TERRAIN_TYPES.indexOf(type);
    if (index < 0) {
      return 0;
    }
    let total = 0;
    for (let i = 0; i < this.cells.length; i += 1) {
      if (this.cells[i] === index) {
        total += 1;
      }
    }
    return total;
  }

  /** The raw buffer, for saving. Returns a copy; the grid keeps its own. */
  public toBuffer(): Uint8Array {
    return this.cells.slice();
  }

  /** Restores from a buffer produced by {@link toBuffer}. */
  public loadBuffer(buffer: Uint8Array): void {
    if (buffer.length !== this.cells.length) {
      throw new Error(`Terrain buffer is ${buffer.length} cells, expected ${this.cells.length}.`);
    }
    this.cells.set(buffer);
  }
}
