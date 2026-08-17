/**
 * Spending a fraction of a thing a day, out of stores that hold whole things.
 *
 * Three things in this game wear out slowly: a tool lasts a worker twenty days, a
 * coat most of a winter, and a healer gets through half a bundle of herbs per
 * patient. All three are honest rates and none of them is a whole number, and
 * until now the fraction was taken straight out of the yard — so a settlement of
 * ten workers held **99.5 tools**, then 99, then 98.5, and a player reported
 * seeing decimals in their stores. Quite right too: a resource here is a physical
 * object somebody carried, and there is no such thing as 0.5 of a tool.
 *
 * The fix is a tab rather than a rounding. Each day's fraction is added to what
 * the settlement owes, and whole units are taken out of the yard when the tab
 * reaches one:
 *
 * ```text
 * day 1   owes 0.5   takes 0   stock 100
 * day 2   owes 1.0   takes 1   stock  99
 * day 3   owes 0.5   takes 0   stock  99
 * ```
 *
 * The **average rate is exactly preserved** — that is the whole point of keeping
 * the remainder rather than rounding it away. Rounding each day to the nearest
 * whole unit would have made a settlement of ten workers spend either nothing or
 * twenty times too much, depending on which way it went.
 *
 * The tab is part of the settlement's state and goes in the save. Dropping it on
 * load would quietly forgive whatever was owed, which over a long game is free
 * tools.
 */

import type { ResourceId } from '@/data/resources';

/** What the settlement owes, in fractions of a unit, per resource. */
export class WearLedger {
  private readonly owed = new Map<ResourceId, number>();

  /**
   * Adds a day's fractional demand and takes out whatever whole units it owes.
   *
   * @param demand today's wear, which may be a fraction
   * @param take asked for a whole number of units; returns how many it could
   *   actually give. A callback rather than the storage registry so the herbalist
   *   and the survival system can each use their own way of drawing stock.
   * @returns the whole units actually taken, which is 0 on most days
   */
  public spend(
    resource: ResourceId,
    demand: number,
    take: (resource: ResourceId, whole: number) => number,
  ): number {
    if (demand <= 0) {
      return 0;
    }

    const owedNow = (this.owed.get(resource) ?? 0) + demand;
    const wholeUnits = Math.floor(owedNow);
    if (wholeUnits <= 0) {
      this.owed.set(resource, owedNow);
      return 0;
    }

    const taken = take(resource, wholeUnits);
    // Only what was actually paid comes off the tab. A settlement with no tools
    // left goes on owing, and pays the moment it forges some — which is right:
    // the work still happened and the tools still took the punishment.
    this.owed.set(resource, owedNow - taken);
    return taken;
  }

  /** What is owed on a resource, for tests and for the save. */
  public debt(resource: ResourceId): number {
    return this.owed.get(resource) ?? 0;
  }

  /** The whole tab as pairs, for the save. */
  public state(): readonly (readonly [ResourceId, number])[] {
    return [...this.owed].filter(([, amount]) => amount > 0);
  }

  public restore(pairs: readonly (readonly [ResourceId, number])[]): void {
    this.owed.clear();
    for (const [resource, amount] of pairs) {
      this.owed.set(resource, amount);
    }
  }

  public clear(): void {
    this.owed.clear();
  }
}
