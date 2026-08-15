/**
 * Storage: where hauled resources end up.
 *
 * Status: Phase 5. The settlement begins with one yard already standing, so
 * hauling can be built and tested before construction exists. Phase 6 lets the
 * player place more, at which point this stops being a founding gift.
 *
 * **The HUD's totals are a cached summary of these inventories, never the
 * authority.** That is the project's core resource rule: a number on screen is
 * a report about resources that physically exist somewhere, not the place they
 * live.
 */

import type { ResourceId } from '@/data/resources';
import type { GridPoint } from '@/shared/types/geometry';
import { Inventory } from '@/simulation/resources/Inventory';

export interface StorageOptions {
  readonly id: number;
  readonly cell: GridPoint;
  readonly capacity: number;
  /** Which resources this yard will take. Empty means anything. */
  readonly accepts?: readonly ResourceId[];
}

export class Storage {
  public readonly id: number;
  /** The cell haulers walk to. */
  public readonly cell: GridPoint;
  public readonly inventory: Inventory;
  private readonly accepted: ReadonlySet<ResourceId> | null;

  constructor(options: StorageOptions) {
    this.id = options.id;
    this.cell = options.cell;
    this.inventory = new Inventory(options.capacity);
    this.accepted = options.accepts && options.accepts.length > 0 ? new Set(options.accepts) : null;
  }

  public accepts(resource: ResourceId): boolean {
    if (this.accepted && !this.accepted.has(resource)) {
      return false;
    }
    return this.inventory.freeSpace > 0;
  }
}

/** Every storage yard in the settlement. */
export class StorageRegistry {
  private readonly storages: Storage[] = [];
  private nextId = 1;
  private changeVersion = 0;

  public get all(): readonly Storage[] {
    return this.storages;
  }

  public get count(): number {
    return this.storages.length;
  }

  /** Bumped whenever stock changes, so the HUD can skip recomputing totals. */
  public get version(): number {
    return this.changeVersion;
  }

  public markChanged(): void {
    this.changeVersion += 1;
  }

  public add(options: Omit<StorageOptions, 'id'>): Storage {
    const storage = new Storage({ ...options, id: this.nextId });
    this.nextId += 1;
    this.storages.push(storage);
    this.changeVersion += 1;
    return storage;
  }

  public getById(id: number): Storage | null {
    return this.storages.find((storage) => storage.id === id) ?? null;
  }

  /**
   * The nearest yard that will take a resource.
   *
   * Ties break on id so hauling destinations stay reproducible.
   */
  public findNearestAccepting(from: GridPoint, resource: ResourceId): Storage | null {
    let best: Storage | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const storage of this.storages) {
      if (!storage.accepts(resource)) {
        continue;
      }
      const distance = Math.hypot(storage.cell.gx - from.gx, storage.cell.gy - from.gy);
      if (
        distance < bestDistance ||
        (distance === bestDistance && best !== null && storage.id < best.id)
      ) {
        best = storage;
        bestDistance = distance;
      }
    }

    return best;
  }

  /**
   * Total of a resource across every yard.
   *
   * This is what the HUD shows. Resources lying on the ground are deliberately
   * excluded: felling a tree must not move the counter until someone has
   * actually carried the logs in.
   */
  public totalOf(resource: ResourceId): number {
    let total = 0;
    for (const storage of this.storages) {
      total += storage.inventory.count(resource);
    }
    return total;
  }
}
