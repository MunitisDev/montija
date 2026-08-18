/**
 * Food going bad.
 *
 * Runs once a day, with the rest of the settlement's accounting, and only ever
 * touches goods whose definition says they perish — which today means food.
 *
 * The point is to give the Food Storage a reason to exist. Making an ordinary
 * yard *refuse* food would have done it too, but that is a wall the player
 * cannot see: a settlement whose food had nowhere to go would starve beside
 * full piles with nothing on screen explaining why. Spoilage says the same
 * thing gradually and legibly — food keeps wherever there is room for it, but
 * only keeps *well* somewhere built for it — and a player who ignores it loses
 * a stockpile rather than a settlement, which is a lesson rather than an
 * ambush.
 *
 * Where food sits decides how fast it turns:
 *
 * ```text
 * on the ground   ─▶ ordinary spoilage
 * an open yard    ─▶ ordinary spoilage
 * a Food Storage  ─▶ a tenth of it, which is what carries a winter
 * ```
 *
 * **A store looks after what is inside it and nothing else.** A version of this
 * where a larder also preserved whatever happened to be lying within six cells of
 * its door was built and taken out again: goods belong to the building that holds
 * them, and a rule that quietly cares for a pile in a field because a shed is
 * within some radius is a rule the player cannot see, cannot point at, and would
 * have to be told about. What a larder near an orchard actually buys is a shorter
 * walk, which is visible on the map and needs no explaining.
 */

import { RESOURCES, type ResourceId } from '@/data/resources';
import type { ResourcePileRegistry } from '@/simulation/resources/ResourcePile';
import type { StorageRegistry } from '@/simulation/logistics/Storage';

/**
 * How fast food turns lying in the open, relative to an ordinary yard.
 *
 * The same, deliberately. A pile is where goods sit for the hour it takes
 * somebody to come and fetch them — it is the hauling system working, not a
 * player decision — and making the ground the worst place to be simply taxed
 * the settlement for the distance between its hut and its yard. The choice
 * this mechanic exists to pose is "did you build a larder?", so that is the
 * only choice it charges for.
 */
export const GROUND_SPOILAGE_MULTIPLIER = 1;

export interface SpoilageReport {
  /** Units lost per resource, for the day just ended. */
  readonly lost: Readonly<Partial<Record<ResourceId, number>>>;
  readonly total: number;
}

export const NO_SPOILAGE: SpoilageReport = { lost: {}, total: 0 };

/**
 * Spoils a day's worth of perishable goods.
 *
 * Deliberately has no randomness. A settlement losing a random amount of food
 * each night would be unplannable, and the brief is clear that the simulation
 * should be reproducible.
 */
export function runSpoilage(
  storages: StorageRegistry,
  piles: ResourcePileRegistry,
): SpoilageReport {
  const lost: Partial<Record<ResourceId, number>> = {};
  let total = 0;

  const spoil = (resource: ResourceId, held: number, rate: number, take: (n: number) => void) => {
    if (held <= 0 || rate <= 0) {
      return;
    }
    // Rounded, so a handful of food does not evaporate a fraction at a time.
    // The consequence — that a very small stock never quite rots away — is the
    // right way round: it reads as the last scraps being eaten before they turn,
    // rather than as the settlement's final meal vanishing overnight.
    const amount = Math.round(held * rate);
    if (amount <= 0) {
      return;
    }
    take(amount);
    lost[resource] = (lost[resource] ?? 0) + amount;
    total += amount;
  };

  for (const storage of storages.all) {
    for (const { resource, amount } of storage.inventory.contents) {
      const rate = RESOURCES[resource].spoilsPerDay * storage.preservation;
      spoil(resource, amount, rate, (n) => storage.inventory.remove(resource, n));
    }
  }

  for (const pile of [...piles.all]) {
    const rate = RESOURCES[pile.resource].spoilsPerDay * GROUND_SPOILAGE_MULTIPLIER;
    spoil(pile.resource, pile.amount, rate, (n) => pile.inventory.remove(pile.resource, n));
    piles.removeIfEmpty(pile.id);
  }

  if (total > 0) {
    storages.markChanged();
  }

  return { lost, total };
}
