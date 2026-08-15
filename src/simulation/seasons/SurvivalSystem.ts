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
 * no firewood in the cold ─▶ warmth falls ─┘
 * ```
 *
 * Poor planning must have consequences, and the consequence is people dying.
 */

import type { ResourceId } from '@/data/resources';
import type { StorageRegistry } from '@/simulation/logistics/Storage';
import type { Villager } from '@/simulation/villagers/Villager';
import type { YearState } from './SeasonClock';

/** Food eaten per villager per day. */
export const FOOD_PER_VILLAGER_PER_DAY = 1;

/** Firewood burned per villager per freezing day. */
export const FIREWOOD_PER_VILLAGER_PER_COLD_DAY = 1;

/** Need lost per day when the settlement cannot supply it. */
const HUNGER_LOST_PER_DAY = 12;
const WARMTH_LOST_PER_DAY = 14;

/** Need restored per day when it can. */
const HUNGER_RESTORED_PER_DAY = 34;
const WARMTH_RESTORED_PER_DAY = 40;

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
}

export const EMPTY_REPORT: DailyReport = {
  foodEaten: 0,
  firewoodBurned: 0,
  foodShortfall: 0,
  firewoodShortfall: 0,
  deaths: 0,
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
  const firewoodWanted = needsFire ? villagers.length * FIREWOOD_PER_VILLAGER_PER_COLD_DAY : 0;
  const firewoodTaken = takeFromStorages(storages, 'firewood', firewoodWanted);

  // Rations are shared evenly rather than first-come: a settlement that is
  // half-fed should weaken together, not have some starve while others eat.
  const fedFraction = foodWanted === 0 ? 1 : foodTaken / foodWanted;
  const warmFraction = firewoodWanted === 0 ? 1 : firewoodTaken / firewoodWanted;

  const dead: Villager[] = [];

  for (const villager of villagers) {
    applyNeed(villager.needs, 'hunger', fedFraction, HUNGER_RESTORED_PER_DAY, HUNGER_LOST_PER_DAY);

    if (needsFire) {
      applyNeed(
        villager.needs,
        'warmth',
        warmFraction,
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
