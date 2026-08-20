/**
 * What the settlement eats, and what it gets for eating well.
 *
 * **Five foods rather than one, because one was a number and not a decision.**
 * Every building that fed the settlement used to make the same interchangeable
 * good, so a village with four gatherer huts ate exactly as well as one with a
 * field, an orchard, a boat and a hunter — and the second had gone to a great
 * deal more trouble for it.
 *
 * The calories are identical. A fish feeds somebody exactly as well as a
 * cabbage, and a settlement living on one thing does not starve for it. What a
 * varied larder buys is **spirit and health**:
 *
 * - people who eat a spread of things are more content, which is worked into the
 *   settlement's solace beside its water and its temple;
 * - and they fall ill less often — which, because illness is what takes days off
 *   the end of a life, is how variety becomes life expectancy without a single
 *   number in the population system knowing anything about food.
 *
 * Both are **collected rather than owed**, like every other comfort in this
 * game: a settlement eating nothing but foraged roots plays exactly the game it
 * always played. It is simply not collecting.
 */

import { FOOD_IDS, RESOURCES, type ResourceId } from '@/data/resources';
import type { StorageRegistry } from '@/simulation/logistics/Storage';

/** How many kinds of food there are to keep. */
export const FOOD_KINDS = FOOD_IDS.length;

/**
 * How much of a kind counts as *keeping* it, per villager.
 *
 * Half a day's ration each. A settlement with three fish in the larder is not
 * eating fish, it has three fish — and letting a single unit of something count
 * would make the whole rule a matter of remembering to leave one of each on the
 * shelf, which is bookkeeping rather than planning.
 */
export const VARIETY_MIN_PER_VILLAGER = 0.5;

/** Every kind of food on the shelves, added up. */
export function foodStored(storages: StorageRegistry): number {
  let total = 0;
  for (const id of FOOD_IDS) {
    total += storages.totalOf(id);
  }
  return total;
}

/** What the settlement wants in its larder, per villager, across every kind. */
export function foodWantedPerVillager(): number {
  let total = 0;
  for (const id of FOOD_IDS) {
    total += RESOURCES[id].wantedPerVillager;
  }
  return total;
}

/**
 * How many kinds of food the settlement is actually keeping.
 *
 * Read off the larder rather than off today's meal, and deliberately. A meal is
 * whole units drawn from what there is, so a village of three eating a ration of
 * three could never have five kinds on its plate however well it was stocked —
 * the question worth answering is "does this settlement keep a varied table",
 * and that is a question about the shelves.
 */
export function foodKinds(storages: StorageRegistry, villagers: number): number {
  const enough = Math.max(1, Math.ceil(villagers * VARIETY_MIN_PER_VILLAGER));
  let kinds = 0;
  for (const id of FOOD_IDS) {
    if (storages.totalOf(id) >= enough) {
      kinds += 1;
    }
  }
  return kinds;
}

/**
 * What that variety is worth, in `0..1`.
 *
 * One kind is nothing — a settlement has to eat something, and eating it is not
 * an achievement. Every kind after the first is worth the same again, so the
 * fifth is as welcome as the second: the whole point is the *spread*, and a
 * curve that paid less for the last one would quietly tell the player to stop at
 * three.
 */
export function varietyShare(kinds: number): number {
  if (kinds <= 1) {
    return 0;
  }
  return Math.min(1, (kinds - 1) / (FOOD_KINDS - 1));
}

/**
 * Takes a day's rations out of the stores, spread across what there is.
 *
 * Two rules, and the first one matters more than it looks:
 *
 * **The exposed stock is eaten first.** Stores are walked worst-keeping first —
 * the open yard before the larder — because food in a yard is food that is about
 * to rot. A settlement that ate its way through the larder while the harvest
 * spoiled in the open would be wasting the very building the player raised to
 * stop that happening, and it *was measured*: drawing the meal by kind rather
 * than by store cost a settlement that built its larder early twenty-two lives
 * across twenty-four worlds, because its protected stock was the stock it ate.
 *
 * **Within a store, proportional to what is held.** A settlement eats mostly
 * what it has most of, which is both what people do and what keeps a larder
 * even: draining the smallest kind first would destroy the settlement's own
 * variety on its behalf, which is the opposite of what the player asked for by
 * building four different things.
 *
 * @returns how much was actually eaten, which is less than `wanted` in a famine
 */
export function drawMeal(storages: StorageRegistry, wanted: number): number {
  if (wanted <= 0) {
    return 0;
  }

  // Ties broken by id, so a settlement replayed from its seed eats the same
  // food out of the same shed twice.
  const stores = [...storages.all].sort((a, b) => b.preservation - a.preservation || a.id - b.id);

  let taken = 0;
  for (const store of stores) {
    if (taken >= wanted) {
      break;
    }

    const held = FOOD_IDS.map((id) => ({ id, amount: store.inventory.count(id) })).filter(
      (kind) => kind.amount > 0,
    );
    const total = held.reduce((sum, kind) => sum + kind.amount, 0);
    if (total === 0) {
      continue;
    }

    const owed = wanted - taken;
    for (const kind of held) {
      const share = Math.floor((owed * kind.amount) / total);
      taken += store.inventory.remove(kind.id, Math.min(share, wanted - taken));
    }

    // Whole units mean the shares round down, so the last mouthful or two comes
    // off the biggest kind. Without this a well-stocked settlement would go very
    // slightly hungry every day for the sake of arithmetic.
    for (const kind of [...held].sort((a, b) => b.amount - a.amount)) {
      if (taken >= wanted) {
        break;
      }
      taken += store.inventory.remove(kind.id, wanted - taken);
    }
  }

  if (taken > 0) {
    storages.markChanged();
  }
  return taken;
}

/** Draws from every yard until the amount is met. */
export function takeFromStorages(
  storages: StorageRegistry,
  resource: ResourceId,
  amount: number,
): number {
  if (amount <= 0) {
    return 0;
  }

  let taken = 0;
  for (const storage of storages.all) {
    if (taken >= amount) {
      break;
    }
    taken += storage.inventory.remove(resource, amount - taken);
  }
  if (taken > 0) {
    storages.markChanged();
  }
  return taken;
}
