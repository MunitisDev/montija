/**
 * Hunger, warmth, health and death.
 *
 * Runs once a day rather than every tick: a settlement's survival is a daily
 * accounting, and per-tick nibbling would make the numbers unreadable and the
 * arithmetic noisy.
 *
 * The consequences chain deliberately:
 *
 * ```text
 * no food  ─▶ hunger falls ─┐
 *                           ├─▶ health falls ─▶ death
 * no fire, or no house ─▶ warmth falls ─┘
 * ```
 *
 * Firewood warms a *house*. Someone with nowhere to sleep gets very little out
 * of the settlement's woodpile, which is what makes a House a building worth
 * raising rather than the decoration it used to be.
 *
 * Poor planning must have consequences, and the consequence is people dying.
 */

import type { ResourceId } from '@/data/resources';
import type { StorageRegistry } from '@/simulation/logistics/Storage';
import type { Villager } from '@/simulation/villagers/Villager';
import type { YearState } from './SeasonClock';

/** Food eaten per villager per day. */
export const FOOD_PER_VILLAGER_PER_DAY = 1;

/** Firewood burned per housed villager per freezing day. */
export const FIREWOOD_PER_VILLAGER_PER_COLD_DAY = 1;

/**
 * Tools worn out per working villager per day.
 *
 * A twentieth: a villager gets through one tool every twenty days. Slow enough
 * that a settlement is never *forced* to forge, fast enough that keeping a
 * hundred people equipped is a real demand on a mine.
 */
export const TOOLS_PER_WORKER_PER_DAY = 0.05;

/**
 * How much faster a fully equipped settlement works.
 *
 * **This is the whole reason iron exists.** Without a consumer, iron would be a
 * number in the HUD that goes up — and a resource with nothing to spend it on
 * is clutter dressed as content. Tools are the consumer, and speed is what they
 * buy: half again as much work out of the same people.
 *
 * Deliberately a bonus rather than a penalty. A settlement with no blacksmith
 * works at exactly the rate it always did, so tools are something to reach for
 * rather than a tax that arrives with an update.
 */
export const TOOL_WORK_BONUS = 0.5;

/**
 * How much of a fire's warmth reaches somebody with no house.
 *
 * Not zero: there is a communal fire, and standing beside it is better than
 * nothing. Not much, either — a quarter — because the House exists to be worth
 * building, and the settlement that skips housing should feel winter properly.
 */
export const SHELTERLESS_WARMTH_SHARE = 0.25;

/**
 * Need lost per day on full rations' worth of shortfall.
 *
 * Deliberately steeper than the recovery below. When recovery outpaced decline
 * — as it did at 34 restored against 12 lost — one fed day cancelled nearly
 * three starving ones, so a settlement could live on half rations indefinitely
 * and winter killed nobody. Poor planning has to cost something.
 *
 * At these rates an unfed settlement empties its hunger in four days and buries
 * its first villager about ten days later: roughly one winter, which is the
 * span the player is being asked to plan for.
 */
const HUNGER_LOST_PER_DAY = 25;
const WARMTH_LOST_PER_DAY = 25;

/** Need restored per day when the settlement can supply it in full. */
const HUNGER_RESTORED_PER_DAY = 20;
const WARMTH_RESTORED_PER_DAY = 25;

/** Health lost per day for each need that is exhausted. */
const HEALTH_LOST_PER_DAY = 10;
/** Health recovered per day when neither need is exhausted. */
const HEALTH_RESTORED_PER_DAY = 4;

export interface DailyReport {
  readonly foodEaten: number;
  readonly firewoodBurned: number;
  readonly foodShortfall: number;
  readonly firewoodShortfall: number;
  readonly deaths: number;
  /** Villagers who spent a freezing night with no house. */
  readonly sleepingRough: number;
  readonly toolsWorn: number;
  /**
   * How well equipped the settlement is today, in `0..1`.
   *
   * Multiplies into the work rate. Zero is not a penalty — it is the speed the
   * game has always run at.
   */
  readonly toolFraction: number;
}

export const EMPTY_REPORT: DailyReport = {
  foodEaten: 0,
  firewoodBurned: 0,
  foodShortfall: 0,
  firewoodShortfall: 0,
  deaths: 0,
  sleepingRough: 0,
  toolsWorn: 0,
  toolFraction: 0,
};

/**
 * Consumes a day's supplies and applies the consequences.
 *
 * @returns the villagers who died, so the caller can remove them
 */
export function runDay(
  villagers: readonly Villager[],
  storages: StorageRegistry,
  year: YearState,
): { report: DailyReport; dead: Villager[] } {
  if (villagers.length === 0) {
    return { report: EMPTY_REPORT, dead: [] };
  }

  const foodWanted = villagers.length * FOOD_PER_VILLAGER_PER_DAY;
  const foodTaken = takeFromStorages(storages, 'food', foodWanted);

  const needsFire = year.isFreezing;
  // Only houses are heated. Wood is not burned for people who have nowhere to
  // burn it, so a settlement with no houses saves the firewood and pays for it
  // in warmth.
  const housed = villagers.filter((villager) => villager.homeId !== null).length;
  const firewoodWanted = needsFire ? housed * FIREWOOD_PER_VILLAGER_PER_COLD_DAY : 0;
  const firewoodTaken = takeFromStorages(storages, 'firewood', firewoodWanted);

  // Rations are shared evenly rather than first-come: a settlement that is
  // half-fed should weaken together, not have some starve while others eat.
  const fedFraction = foodWanted === 0 ? 1 : foodTaken / foodWanted;
  // No houses means no hearths, so the fire fraction is zero rather than the
  // "nothing was needed" 1. Otherwise a settlement with no houses at all scored
  // a full fire, and having a home with no firewood came out *worse* than
  // having no home — which is nonsense in both directions.
  const warmFraction = firewoodWanted === 0 ? 0 : firewoodTaken / firewoodWanted;

  // Tools are worn out by the people doing the work, so children do not count.
  // Nothing is taken when the settlement has none, and nothing is lost by that
  // — an unequipped settlement simply works at the rate it always did.
  const workers = villagers.filter((villager) => villager.isAdult).length;
  const toolsWanted = workers * TOOLS_PER_WORKER_PER_DAY;
  const toolsWorn = takeFromStorages(storages, 'tools', toolsWanted);
  const toolFraction = toolsWanted === 0 ? 0 : Math.min(1, toolsWorn / toolsWanted);

  const dead: Villager[] = [];
  let sleepingRough = 0;

  for (const villager of villagers) {
    applyNeed(villager.needs, 'hunger', fedFraction, HUNGER_RESTORED_PER_DAY, HUNGER_LOST_PER_DAY);

    if (needsFire) {
      const sheltered = villager.homeId !== null;
      if (!sheltered) {
        sleepingRough += 1;
      }
      applyNeed(
        villager.needs,
        'warmth',
        sheltered ? warmFraction : warmFraction * SHELTERLESS_WARMTH_SHARE,
        WARMTH_RESTORED_PER_DAY,
        WARMTH_LOST_PER_DAY,
      );
    } else {
      // Mild weather warms people back up without burning anything.
      villager.needs.warmth = clamp(villager.needs.warmth + WARMTH_RESTORED_PER_DAY);
    }

    const exhausted = (villager.needs.hunger <= 0 ? 1 : 0) + (villager.needs.warmth <= 0 ? 1 : 0);
    villager.needs.health = clamp(
      exhausted > 0
        ? villager.needs.health - HEALTH_LOST_PER_DAY * exhausted
        : villager.needs.health + HEALTH_RESTORED_PER_DAY,
    );

    if (villager.needs.health <= 0) {
      dead.push(villager);
    }
  }

  return {
    report: {
      foodEaten: foodTaken,
      firewoodBurned: firewoodTaken,
      foodShortfall: foodWanted - foodTaken,
      firewoodShortfall: firewoodWanted - firewoodTaken,
      deaths: dead.length,
      sleepingRough,
      toolsWorn,
      toolFraction,
    },
    dead,
  };
}

function applyNeed(
  needs: { hunger: number; warmth: number; health: number },
  key: 'hunger' | 'warmth',
  suppliedFraction: number,
  restored: number,
  lost: number,
): void {
  const change = suppliedFraction >= 1 ? restored : -lost * (1 - suppliedFraction);
  needs[key] = clamp(needs[key] + change);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Draws from every yard until the amount is met. */
function takeFromStorages(storages: StorageRegistry, resource: ResourceId, amount: number): number {
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
