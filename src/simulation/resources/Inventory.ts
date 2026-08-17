/**
 * A container of resources.
 *
 * One class serves villagers, ground piles and storage yards, because they
 * differ only in capacity. Every transfer in the game goes through
 * {@link Inventory.transfer}, which is what makes "resources move, they are not
 * conjured" enforceable rather than merely intended.
 *
 * Capacity is a single unit budget rather than per-resource slots. That keeps a
 * storage yard from holding unlimited amounts of everything, and keeps the
 * arithmetic simple enough to reason about in tests.
 *
 * **Everything in here is a whole number of things.** A resource in this game is
 * a physical object somebody carried, and there is no such thing as 0.35 of a
 * tool. The rule is enforced here rather than trusted to callers because it was
 * not: tools wear out at a twentieth per worker per day, that fraction was taken
 * straight out of the yard, and a player quite reasonably reported seeing
 * decimals in their stores. Anything that consumes a fraction of something a day
 * now owes it up — see `resources/wear.ts` — and this class simply refuses to
 * hold a part of anything.
 */

import { type ResourceId } from '@/data/resources';

export class Inventory {
  /** Total units this container holds across all resources. */
  public readonly capacity: number;
  private readonly amounts = new Map<ResourceId, number>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  public count(resource: ResourceId): number {
    return this.amounts.get(resource) ?? 0;
  }

  public get total(): number {
    let total = 0;
    for (const amount of this.amounts.values()) {
      total += amount;
    }
    return total;
  }

  public get freeSpace(): number {
    return Math.max(0, this.capacity - this.total);
  }

  public get isEmpty(): boolean {
    return this.total === 0;
  }

  public get isFull(): boolean {
    return this.freeSpace === 0;
  }

  /** The resources actually present, in insertion order. */
  public get contents(): readonly { resource: ResourceId; amount: number }[] {
    const entries: { resource: ResourceId; amount: number }[] = [];
    for (const [resource, amount] of this.amounts) {
      if (amount > 0) {
        entries.push({ resource, amount });
      }
    }
    return entries;
  }

  /**
   * Adds what fits.
   *
   * @returns how much was actually added, which may be less than asked. Callers
   *   must use this rather than assume success — silently dropping the excess
   *   is how resources disappear.
   */
  public add(resource: ResourceId, amount: number): number {
    // Floored, not rounded: adding half a log must never round up into a whole
    // one. A caller with a fraction to place is a caller with a bug, and the
    // return value tells them nothing was taken.
    const whole = Math.floor(amount);
    if (whole <= 0) {
      return 0;
    }
    const accepted = Math.min(whole, this.freeSpace);
    if (accepted > 0) {
      this.amounts.set(resource, this.count(resource) + accepted);
    }
    return accepted;
  }

  /**
   * Removes what is there.
   *
   * @returns how much was actually removed.
   */
  public remove(resource: ResourceId, amount: number): number {
    // Floored for the same reason `add` is: taking 0.35 of a tool would leave
    // 0.65 of one behind, which is not a thing that can be in a yard.
    const whole = Math.floor(amount);
    if (whole <= 0) {
      return 0;
    }
    const held = this.count(resource);
    const removed = Math.min(whole, held);
    if (removed > 0) {
      const left = held - removed;
      if (left === 0) {
        this.amounts.delete(resource);
      } else {
        this.amounts.set(resource, left);
      }
    }
    return removed;
  }

  public clear(): void {
    this.amounts.clear();
  }

  /**
   * Moves resources from this container into another.
   *
   * Conserving: it removes exactly what the destination accepts, so nothing is
   * created and nothing vanishes in transit. **Every resource movement in the
   * game goes through here.**
   *
   * @returns how much actually moved
   */
  public transfer(destination: Inventory, resource: ResourceId, amount: number): number {
    const available = Math.min(amount, this.count(resource));
    if (available <= 0) {
      return 0;
    }

    // Ask the destination first, then remove only what it took.
    const accepted = destination.add(resource, available);
    this.remove(resource, accepted);
    return accepted;
  }

  /** Moves everything this container holds into another. */
  public transferAll(destination: Inventory): number {
    let moved = 0;
    for (const { resource, amount } of this.contents) {
      moved += this.transfer(destination, resource, amount);
    }
    return moved;
  }

  /** A plain snapshot, for saves and for the HUD. */
  public toRecord(): Partial<Record<ResourceId, number>> {
    const record: Partial<Record<ResourceId, number>> = {};
    for (const { resource, amount } of this.contents) {
      record[resource] = amount;
    }
    return record;
  }
}
