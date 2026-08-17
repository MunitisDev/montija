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
import { WearLedger } from '@/simulation/resources/wear';
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
 * Coats worn out per villager per freezing day.
 *
 * Only in the cold: clothing is not consumed in July. A twentieth of a coat a
 * cold day means one coat lasts a villager most of a winter.
 */
export const CLOTHING_PER_VILLAGER_PER_COLD_DAY = 0.05;

/**
 * How much warmth a fully clothed settlement keeps regardless of its fire.
 *
 * **This is a second line of defence, not a second tax.** Warmth came from one
 * place — a house with firewood in it — so a settlement that ran short of
 * either had nothing at all to fall back on, and the loss curve was the same
 * whether they were a day short or a season short. A coat does not replace a
 * hearth; it means running out of firewood is survivable for a while instead of
 * immediately fatal, and it is the only thing that helps somebody with no roof.
 *
 * Deliberately below the fire's share, so houses and woodcutters stay the first
 * answer and clothing stays the insurance.
 */
export const CLOTHING_WARMTH_SHARE = 0.45;

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

/**
 * The spirit a settlement sits at with nowhere to bury its dead.
 *
 * **Neutral, not empty.** Everything about the fourth need hangs off this
 * number: at or below it the settlement plays exactly the game it always did,
 * and only above it is there a reward. A settlement that never builds a Temple
 * or a Cemetery is not being punished — it is simply not collecting, which is
 * the same bargain tools make.
 */
export const SPIRIT_NEUTRAL = 50;

/**
 * How fast spirit moves towards where the settlement's solace would hold it.
 *
 * Slow on purpose. A Temple finished today should lift the settlement over the
 * following weeks rather than the following morning: it is the one need that
 * is about how long people have been living somewhere.
 */
export const SPIRIT_MOVE_PER_DAY = 2.5;

/**
 * Spirit lost by everybody for each villager buried that day.
 *
 * A death is the only thing that pushes spirit down. It can push it below
 * neutral, where it costs nothing — what it costs is the *climb back*, which a
 * settlement with a Temple makes and one without does not.
 */
export const SPIRIT_LOST_PER_DEATH = 6;

/**
 * How much faster a settlement at peace works, at full spirit.
 *
 * Scaled from {@link SPIRIT_NEUTRAL} upwards, so 50 is +0% and 100 is +25%.
 * Composes with the tool bonus rather than replacing it: a well-equipped,
 * settled village is meaningfully quicker than a miserable ill-equipped one,
 * and neither state is a penalty against the other.
 */
export const SPIRIT_WORK_BONUS = 0.25;

/** The work multiplier a given spirit is worth. Never below 1. */
export function spiritWorkBonus(spirit: number): number {
  const above = Math.max(0, spirit - SPIRIT_NEUTRAL) / (100 - SPIRIT_NEUTRAL);
  return 1 + SPIRIT_WORK_BONUS * above;
}

export interface DailyReport {
  readonly foodEaten: number;
  readonly firewoodBurned: number;
  readonly foodShortfall: number;
  readonly firewoodShortfall: number;
  readonly deaths: number;
  /** Villagers who spent a freezing night with no house. */
  readonly sleepingRough: number;
  readonly toolsWorn: number;
  readonly clothingWorn: number;
  /** How well clothed the settlement is today, in `0..1`. */
  readonly clothingFraction: number;
  /**
   * How well equipped the settlement is today, in `0..1`.
   *
   * Multiplies into the work rate. Zero is not a penalty — it is the speed the
   * game has always run at.
   */
  readonly toolFraction: number;
  /** The settlement's average spirit after the day, in `0..100`. */
  readonly spirit: number;
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
  clothingWorn: 0,
  clothingFraction: 0,
  spirit: SPIRIT_NEUTRAL,
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
  /**
   * How much of the settlement's need for solace its buildings answer, `0..1`.
   *
   * Passed in rather than worked out here, for the same reason the healer's
   * capacity is: how a building is staffed is not this system's business.
   */
  solace = 0,
  /**
   * The settlement's running tab of fractional wear.
   *
   * Tools and coats wear out at a twentieth a day, and a yard holds whole
   * things — so the fraction is owed up and paid in whole units. Passed in
   * rather than kept here because it has to survive a save; see
   * `resources/wear.ts`.
   */
  wear: WearLedger = new WearLedger(),
): { report: DailyReport; dead: Villager[] } {
  if (villagers.length === 0) {
    return { report: EMPTY_REPORT, dead: [] };
  }

  const spend = (resource: ResourceId, demand: number): number =>
    wear.spend(resource, demand, (which, whole) => takeFromStorages(storages, which, whole));

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

  // Tools are worn out by the people doing the work, so neither children nor
  // retired villagers count. Nothing is taken when the settlement has none, and
  // nothing is lost by that — an unequipped settlement simply works at the rate
  // it always did.
  //
  // **Coverage is read off the stock, not off today's withdrawal**, and that is
  // not a detail. A twentieth of a tool per worker means a village of ten owes
  // half a tool a day and hands one over every second day — so a fraction based
  // on what was taken would read 0 on one day and 2 on the next, and the work
  // bonus it drives would flicker between nothing and double. What the number is
  // supposed to mean is "is this settlement equipped today", and the honest
  // answer to that is whether the yard could cover the day's wear.
  const workers = villagers.filter((villager) => villager.canWork).length;
  const toolsWanted = workers * TOOLS_PER_WORKER_PER_DAY;
  const toolFraction = coverage(storages, 'tools', toolsWanted);
  const toolsWorn = spend('tools', toolsWanted);

  // Coats wear out on people's backs, and only in the cold. Nothing is taken
  // from a settlement that has none, and nothing is lost by that: an unclothed
  // settlement is exactly as warm as it always was.
  const clothingWanted = needsFire ? villagers.length * CLOTHING_PER_VILLAGER_PER_COLD_DAY : 0;
  const clothingFraction = coverage(storages, 'clothing', clothingWanted);
  const clothingWorn = spend('clothing', clothingWanted);

  const dead: Villager[] = [];
  let sleepingRough = 0;

  for (const villager of villagers) {
    applyNeed(villager.needs, 'hunger', fedFraction, HUNGER_RESTORED_PER_DAY, HUNGER_LOST_PER_DAY);

    if (needsFire) {
      const sheltered = villager.homeId !== null;
      if (!sheltered) {
        sleepingRough += 1;
      }
      // A coat and a hearth add up rather than compete, and neither can carry
      // the day alone: the sum is capped at 1, so being fully clothed *and*
      // fully warmed is no better than being fully warmed, and being one of
      // the two is much better than being neither.
      const fromFire = sheltered ? warmFraction : warmFraction * SHELTERLESS_WARMTH_SHARE;
      const fromCoat = clothingFraction * CLOTHING_WARMTH_SHARE;
      applyNeed(
        villager.needs,
        'warmth',
        Math.min(1, fromFire + fromCoat),
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

  // Spirit last, so the day's deaths are already known and the settlement
  // grieves on the day it buries somebody rather than the day after.
  //
  // Everybody moves together: this is not a private mood, it is what it is
  // like to live here. A shared number is also the only honest one, because
  // what raises it — ground to bury the dead in, somewhere to sit with them —
  // belongs to the settlement rather than to any villager.
  const target = SPIRIT_NEUTRAL + (100 - SPIRIT_NEUTRAL) * Math.max(0, Math.min(1, solace));
  const grief = dead.length * SPIRIT_LOST_PER_DEATH;
  let spiritTotal = 0;
  for (const villager of villagers) {
    const towards = Math.sign(target - villager.needs.spirit) * SPIRIT_MOVE_PER_DAY;
    const moved =
      Math.abs(target - villager.needs.spirit) < SPIRIT_MOVE_PER_DAY
        ? target
        : villager.needs.spirit + towards;
    villager.needs.spirit = clamp(moved - grief);
    spiritTotal += villager.needs.spirit;
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
      clothingWorn,
      clothingFraction,
      spirit: villagers.length === 0 ? SPIRIT_NEUTRAL : spiritTotal / villagers.length,
    },
    dead,
  };
}

function applyNeed(
  needs: { hunger: number; warmth: number },
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

/**
 * How much of a day's wear the settlement could actually cover, in `0..1`.
 *
 * Read off the stock rather than off what was withdrawn, so a rate that only
 * hands over a whole unit every other day does not make this flicker. `0` when
 * nothing is wanted, which is what "not equipped" has always meant here.
 */
function coverage(storages: StorageRegistry, resource: ResourceId, wanted: number): number {
  if (wanted <= 0) {
    return 0;
  }
  return Math.min(1, storages.totalOf(resource) / wanted);
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
