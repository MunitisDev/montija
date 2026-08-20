/**
 * How much of a good the settlement wants to keep, as the player sees it.
 *
 * **The one thing a player could not say to this game was "enough".** Every
 * workshop worked as long as it had people and a season, so a quarry with two
 * masons cut stone for ever — into a yard already holding five hundred of it,
 * while the hauling that stone generated competed with the harvest. The only way
 * to stop it was to take the masons off the building by hand, remember why, and
 * remember to put them back.
 *
 * A limit is a standing instruction instead: *stop at two hundred stone, and go
 * and do something else until it falls*. What it changes is deliberately narrow:
 *
 * - a workshop whose every output is at its limit **posts no work**, so its
 *   staff are handed back to the settlement exactly as they are when a crop is
 *   out of season;
 * - carrying more of that good in drops to the bottom of the job board, the same
 *   way it does above the settlement's own appetite for it;
 * - a Feller's Hut cropping its own timber stops at the lower of its own target
 *   and the player's.
 *
 * What it does **not** do is touch anything the player asked for by hand. A tree
 * marked for felling is an order, not a suggestion, and a limit that quietly
 * cancelled orders would be the game arguing with the player rather than
 * carrying out a standing instruction.
 *
 * Counted against what is **on the shelves**, not what exists: the number the
 * player set the limit while looking at is the stored total, and a limit that
 * included four hundred logs lying in the wood would stop the sawmill for goods
 * nobody has carried in yet.
 */

import type { ResourceId } from '@/data/resources';

/** The player's ceilings, by resource. Absent means no ceiling. */
export class StockLimits {
  private readonly limits = new Map<ResourceId, number>();
  private changeVersion = 0;

  /** Bumped on every change, so the UI can skip redrawing. */
  public get version(): number {
    return this.changeVersion;
  }

  /** The ceiling on a good, or `null` when the player has not set one. */
  public get(resource: ResourceId): number | null {
    return this.limits.get(resource) ?? null;
  }

  /**
   * Sets or lifts a ceiling.
   *
   * `null` lifts it. Zero is a real limit and a useful one — *make no more of
   * this at all* — so it is kept rather than folded into "no limit".
   *
   * @returns `true` when something actually changed
   */
  public set(resource: ResourceId, limit: number | null): boolean {
    if (limit === null) {
      const had = this.limits.delete(resource);
      if (had) {
        this.changeVersion += 1;
      }
      return had;
    }

    const whole = Math.max(0, Math.round(limit));
    if (this.limits.get(resource) === whole) {
      return false;
    }
    this.limits.set(resource, whole);
    this.changeVersion += 1;
    return true;
  }

  /** `true` when this good is at or over its ceiling. */
  public reached(resource: ResourceId, stored: number): boolean {
    const limit = this.limits.get(resource);
    return limit !== undefined && stored >= limit;
  }

  /** Every ceiling set, in a stable order. For saving, and for tests. */
  public get all(): readonly (readonly [ResourceId, number])[] {
    return [...this.limits.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  /** Lifts every ceiling. Used before restoring a save. */
  public clear(): void {
    this.limits.clear();
    this.changeVersion += 1;
  }
}
