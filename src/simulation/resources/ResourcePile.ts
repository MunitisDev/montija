/**
 * Resources lying on the ground.
 *
 * This is the class that makes the project's core resource principle real:
 * felling a tree does not increment a counter, it drops a pile here that
 * somebody has to physically walk to and carry away. Until they do, those logs
 * are not part of the settlement's stock.
 *
 * Piles are reserved while a hauler is on the way, so two villagers never set
 * off for the same one.
 */

import { resourceDefinition, type ResourceId } from '@/data/resources';
import type { GridPoint } from '@/shared/types/geometry';
import { Inventory } from './Inventory';

export class ResourcePile {
  public readonly id: number;
  public readonly cell: GridPoint;
  public readonly resource: ResourceId;
  public readonly inventory: Inventory;

  constructor(id: number, cell: GridPoint, resource: ResourceId) {
    this.id = id;
    this.cell = cell;
    this.resource = resource;
    this.inventory = new Inventory(resourceDefinition(resource).maxStack);
  }

  public get amount(): number {
    return this.inventory.count(this.resource);
  }

  public get isEmpty(): boolean {
    return this.amount === 0;
  }
}

/**
 * Every pile on the map.
 *
 * Indexed by cell as well as id, because "is there already a pile of logs
 * here?" is asked every time a tree falls, and dropping a second pile on the
 * same tile would leave one of them unreachable.
 */
export class ResourcePileRegistry {
  private readonly byId = new Map<number, ResourcePile>();
  /** `${gx},${gy}:${resource}` to pile id. */
  private readonly byCell = new Map<string, number>();
  private nextId = 1;
  private changeVersion = 0;

  public get count(): number {
    return this.byId.size;
  }

  /** Bumped on every add, removal and amount change, so renderers can skip work. */
  public get version(): number {
    return this.changeVersion;
  }

  public get all(): Iterable<ResourcePile> {
    return this.byId.values();
  }

  public getById(id: number): ResourcePile | null {
    return this.byId.get(id) ?? null;
  }

  public getAt(cell: GridPoint, resource: ResourceId): ResourcePile | null {
    const id = this.byCell.get(key(cell, resource));
    return id === undefined ? null : (this.byId.get(id) ?? null);
  }

  /** Any pile standing on a cell, whatever it holds. */
  public anyAt(cell: GridPoint): ResourcePile | null {
    for (const pile of this.byId.values()) {
      if (pile.cell.gx === cell.gx && pile.cell.gy === cell.gy) {
        return pile;
      }
    }
    return null;
  }

  /**
   * Drops resources on the ground, merging into an existing pile where one
   * already holds the same thing.
   *
   * @returns how much was actually dropped. A full pile refuses the excess
   *   rather than swallowing it — the caller must decide what to do with it.
   */
  public drop(cell: GridPoint, resource: ResourceId, amount: number): number {
    const existing = this.getAt(cell, resource);
    if (existing) {
      const added = existing.inventory.add(resource, amount);
      if (added > 0) {
        this.changeVersion += 1;
      }
      return added;
    }

    const pile = new ResourcePile(this.nextId, cell, resource);
    const added = pile.inventory.add(resource, amount);
    if (added <= 0) {
      return 0;
    }

    this.nextId += 1;
    this.byId.set(pile.id, pile);
    this.byCell.set(key(cell, resource), pile.id);
    this.changeVersion += 1;
    return added;
  }

  /** Removes a pile entirely. */
  public remove(id: number): ResourcePile | null {
    const pile = this.byId.get(id);
    if (!pile) {
      return null;
    }
    this.byId.delete(id);
    this.byCell.delete(key(pile.cell, pile.resource));
    this.changeVersion += 1;
    return pile;
  }

  /** Drops any pile that has been emptied. Called after a hauler loads up. */
  public removeIfEmpty(id: number): void {
    const pile = this.byId.get(id);
    if (pile && pile.isEmpty) {
      this.remove(id);
    } else if (pile) {
      // The amount changed even though the pile survives; redraw it.
      this.changeVersion += 1;
    }
  }

  /** Total of one resource lying on the ground, not yet stored. */
  public totalOf(resource: ResourceId): number {
    let total = 0;
    for (const pile of this.byId.values()) {
      total += pile.inventory.count(resource);
    }
    return total;
  }
}

function key(cell: GridPoint, resource: ResourceId): string {
  return `${cell.gx},${cell.gy}:${resource}`;
}
