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

import { RESOURCES, type ResourceId } from '@/data/resources';
import type { GridPoint } from '@/shared/types/geometry';
import { Inventory } from '@/simulation/resources/Inventory';

export interface StorageOptions {
  readonly id: number;
  readonly cell: GridPoint;
  readonly capacity: number;
  /** Which resources this yard will take. Empty means anything. */
  readonly accepts?: readonly ResourceId[];
  /**
   * How much of a perishable good's ordinary spoilage this building prevents.
   *
   * `1` is an open yard, which does nothing to keep food; a purpose-built
   * larder is far lower. This is the reason to build one: food keeps wherever
   * there is room for it, but only keeps *well* somewhere built for it.
   */
  readonly preservation?: number;
}

export class Storage {
  public readonly id: number;
  /** The cell haulers walk to. */
  public readonly cell: GridPoint;
  public readonly inventory: Inventory;
  /** Multiplier on how fast perishable goods spoil here. */
  public readonly preservation: number;
  private readonly accepted: ReadonlySet<ResourceId> | null;

  constructor(options: StorageOptions) {
    this.id = options.id;
    this.cell = options.cell;
    this.inventory = new Inventory(options.capacity);
    this.preservation = options.preservation ?? 1;
    this.accepted = options.accepts && options.accepts.length > 0 ? new Set(options.accepts) : null;
  }

  /** The resources this yard is restricted to, or `null` when it takes any. */
  public get acceptedResources(): readonly ResourceId[] | null {
    return this.accepted ? [...this.accepted] : null;
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

  /** Removes every yard. Used before restoring a save. */
  public clear(): void {
    this.storages.length = 0;
    this.nextId = 1;
    this.changeVersion += 1;
  }

  public getById(id: number): Storage | null {
    return this.storages.find((storage) => storage.id === id) ?? null;
  }

  /**
   * The best yard to take a resource to.
   *
   * For anything that keeps — timber, stone — this is simply the nearest.
   * For something that spoils it is the yard that will *keep* it, even if that
   * means walking further: carrying food past the larder to the nearer open
   * yard, and watching it rot there, is not what a person would do, and the
   * player who built the larder would rightly read it as the game ignoring
   * them.
   *
   * Ties break on distance and then on id, so hauling stays reproducible.
   */
  public findNearestAccepting(from: GridPoint, resource: ResourceId): Storage | null {
    const perishable = RESOURCES[resource].spoilsPerDay > 0;

    let best: Storage | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPreservation = Number.POSITIVE_INFINITY;

    for (const storage of this.storages) {
      if (!storage.accepts(resource)) {
        continue;
      }

      const distance = Math.hypot(storage.cell.gx - from.gx, storage.cell.gy - from.gy);
      // Only perishables care where they end up; everything else is indifferent,
      // so its "preservation" is held equal and distance decides as before.
      const preservation = perishable ? storage.preservation : 0;

      if (best === null) {
        best = storage;
        bestDistance = distance;
        bestPreservation = preservation;
        continue;
      }

      if (preservation !== bestPreservation) {
        if (preservation < bestPreservation) {
          best = storage;
          bestDistance = distance;
          bestPreservation = preservation;
        }
        continue;
      }

      if (distance < bestDistance || (distance === bestDistance && storage.id < best.id)) {
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
