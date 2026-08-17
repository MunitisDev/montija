/**
 * Learning a trade by doing it.
 *
 * Runs once a day, with the rest of the settlement's accounting, and does one
 * thing: **everybody who held a post today is a day better at it.**
 *
 * Counted in days at a post rather than in jobs completed, and that is a
 * deliberate simplification with a real consequence — a woodcutter who spent the
 * day walking to a distant stack still learned something about being a
 * woodcutter. Counting finished jobs would have made experience a second measure
 * of how well the settlement is laid out, which it already measures elsewhere.
 *
 * ```text
 * posted to a workshop ─▶ a day at that trade ─▶ apprentice ─▶ expert ─▶ master
 *                                                        └─▶ works faster at it
 * ```
 *
 * Nothing here decays. A master who is moved to a quarry keeps her woodcutting
 * for the day somebody builds another woodcutter — forgetting a trade would be a
 * second thing for the player to watch, and the cost of moving a specialist is
 * already the five years it took to make one.
 */

import type { BuildingId } from '@/data/buildings';
import { INHERITED_EXPERIENCE_DAYS, skillLevelOf } from '@/data/skills';
import type { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import type { Villager } from '@/simulation/villagers/Villager';

export interface SkillReport {
  /** Villagers who reached a new level today, for the HUD to call out. */
  readonly promoted: readonly {
    readonly villagerId: number;
    readonly name: string;
    readonly trade: BuildingId;
    readonly level: 'apprentice' | 'expert' | 'master';
  }[];
}

export const NO_SKILL_CHANGE: SkillReport = { promoted: [] };

/**
 * Credits a day's work to everybody holding a post.
 *
 * Retired villagers are excluded for the obvious reason: `reconcileEmployment`
 * has already taken their post away, so they hold none to be credited for.
 */
export function runSkillDay(
  villagers: readonly Villager[],
  buildings: BuildingRegistry,
): SkillReport {
  const promoted: {
    villagerId: number;
    name: string;
    trade: BuildingId;
    level: 'apprentice' | 'expert' | 'master';
  }[] = [];

  for (const villager of villagers) {
    if (villager.employerId === null || !villager.canWork) {
      continue;
    }
    const building = buildings.getById(villager.employerId);
    // Only a workshop teaches a trade. A yard has no craft to it, and crediting
    // one would make "storage-yard" a profession somebody could master.
    if (!building || !building.isComplete || building.definition.workerSlots === 0) {
      continue;
    }

    const trade = building.definition.id;
    const before = skillLevelOf(villager.experienceAt(trade));
    const days = villager.experienceAt(trade) + 1;
    villager.experience.set(trade, days);
    const after = skillLevelOf(days);

    if (after !== before && after !== 'none') {
      promoted.push({ villagerId: villager.id, name: villager.name, trade, level: after });
    }
  }

  return { promoted };
}

/**
 * Gives a child what their parents' mastery is worth, on the day they can work.
 *
 * **Only from a master, and only once.** They grew up in the workshop, so at
 * fourteen they start where a year's work would have put them rather than at
 * nothing. An expert's children start where everybody else does, which is what
 * keeps five years a milestone rather than a formality.
 *
 * Applied at working age rather than at birth so it cannot be read off a newborn
 * — and so a parent who becomes a master while the child is growing up still
 * passes it on, which is the more generous and more plausible reading.
 *
 * Idempotent: a child who already has experience at the trade is left alone, so
 * running this every day credits the inheritance exactly once.
 */
export function inheritTrades(villagers: readonly Villager[]): void {
  const byId = new Map(villagers.map((villager) => [villager.id, villager]));

  for (const child of villagers) {
    // At working age, and not before: a nine year old with a trade on record
    // would be a number the player cannot act on for five years.
    if (child.parentIds === null || !child.canWork) {
      continue;
    }

    for (const parentId of child.parentIds) {
      const parent = byId.get(parentId);
      if (!parent) {
        continue;
      }
      for (const [trade, days] of parent.experience) {
        if (skillLevelOf(days) !== 'master') {
          continue;
        }
        if (child.experienceAt(trade) > 0) {
          continue;
        }
        child.experience.set(trade, INHERITED_EXPERIENCE_DAYS);
      }
    }
  }
}
