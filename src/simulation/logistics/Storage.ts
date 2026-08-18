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
  /** How far this store's care reaches beyond its walls, in cells. */
  readonly shelters?: number;
  /**
   * The building that opened this yard, or `null` for the founding one.
   *
   * Recorded so the renderer knows not to draw a yard on top of a building that
   * is already drawing itself — two sprites for one storage read as buildings
   * overlapping each other.
   */
  readonly ownerBuildingId?: number | null;
}

export class Storage {
  public readonly id: number;
  /** The cell haulers walk to. */
  public readonly cell: GridPoint;
  public readonly inventory: Inventory;
  /** Multiplier on how fast perishable goods spoil here. */
  public readonly preservation: number;
  /**
   * How far its care reaches beyond its walls, in cells.
   *
   * A larder keeps what is lying beside it almost as well as what is inside it:
   * the shade of the store, its awning, the shelf by its door. `0` for a store
   * that has no such reach, which is every open yard.
   */
  public readonly shelters: number;
  /** The building this yard belongs to, or `null` for the founding one. */
  public readonly ownerBuildingId: number | null;
  private readonly accepted: ReadonlySet<ResourceId> | null;

  constructor(options: StorageOptions) {
    this.id = options.id;
    this.cell = options.cell;
    this.inventory = new Inventory(options.capacity);
    this.preservation = options.preservation ?? 1;
    this.shelters = options.shelters ?? 0;
    this.ownerBuildingId = options.ownerBuildingId ?? null;
    this.accepted = options.accepts && options.accepts.length > 0 ? new Set(options.accepts) : null;
  }

  /** The resources this yard is restricted to, or `null` when it takes any. */
  public get acceptedResources(): readonly ResourceId[] | null {
    return this.accepted ? [...this.accepted] : null;
  }

  /**
   * `true` when a hauler could put this down here *right now*.
   *
   * Two questions in one, deliberately, because that is what a hauler needs to
   * ask: is this the kind of thing this yard takes, and is there room. Anything
   * asking only the first — how full the food stores are, say — wants
   * {@link isFor} instead, or it will quietly skip the full ones.
   */
  public accepts(resource: ResourceId): boolean {
    return this.isFor(resource) && this.inventory.freeSpace > 0;
  }

  /**
   * `true` when this yard is *for* a resource, whether or not it has room.
   *
   * Split out after a full yard vanished from the settlement's own count of how
   * full its yards were — the one store the figure most needed to include.
   */
  public isFor(resource: ResourceId): boolean {
    return !this.accepted || this.accepted.has(resource);
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

  /**
   * How fast a perishable good lying on a cell will turn, as a multiplier.
   *
   * **The answer to "what happens to a harvest before anybody carries it in".**
   * On open ground it is 1, the same as an ordinary yard: a pile is where goods
   * sit for the hour it takes somebody to fetch them, and taxing the settlement
   * for the distance between its hut and its shed was never the point. Within a
   * larder's reach it is the larder's own figure — the shade of the store, its
   * awning, the shelf by its door — which is what lets an orchard beside one
   * deliver its whole crop instead of most of it.
   *
   * Only stores that could actually take the good count, room included: a full
   * larder is not keeping anything for anybody.
   */
  public shelterAt(cell: GridPoint, resource: ResourceId): number {
    let best = 1;
    for (const storage of this.storages) {
      if (storage.shelters <= 0 || storage.preservation >= best || !storage.accepts(resource)) {
        continue;
      }
      const distance = Math.max(
        Math.abs(storage.cell.gx - cell.gx),
        Math.abs(storage.cell.gy - cell.gy),
      );
      if (distance <= storage.shelters) {
        best = storage.preservation;
      }
    }
    return best;
  }

  /** `true` once a purpose-built food store stands, as against the open yard. */
  public get hasLarder(): boolean {
    return this.storages.some((storage) => storage.preservation < 1 && storage.isFor('food'));
  }

  /**
   * How full the buildings that take a given resource are.
   *
   * **Asked by resource rather than by kind of building**, because that is the
   * question with an answer: a Storage Yard takes eight goods and a Food Storage
   * takes one, and what a player wants to know is "have I room for more food",
   * not "how full is that shed". Summed across every store that would accept it.
   *
   * `capacity` is 0 when the settlement has nowhere at all to put the stuff —
   * which is not the same as full, and is the state that quietly kills a
   * settlement: gathered food with nowhere to go simply rots where it lies.
   */
  public fill(resource: ResourceId): { readonly used: number; readonly capacity: number } {
    let used = 0;
    let capacity = 0;
    for (const storage of this.storages) {
      // `isFor`, not `accepts`: a full yard is exactly the one this figure is
      // about, and `accepts` would drop it for having no room left.
      if (!storage.isFor(resource)) {
        continue;
      }
      used += storage.inventory.total;
      capacity += storage.inventory.capacity;
    }
    return { used, capacity };
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

  /** Closes one yard. Its contents are the caller's problem, not this one's. */
  public remove(id: number): boolean {
    const index = this.storages.findIndex((storage) => storage.id === id);
    if (index < 0) {
      return false;
    }
    this.storages.splice(index, 1);
    this.changeVersion += 1;
    return true;
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
