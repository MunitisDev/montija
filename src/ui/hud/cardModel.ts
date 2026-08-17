/**
 * The people a building's panel is about, as cards.
 *
 * **A workshop was a number.** Tapping one said "Workers 2/2", which answers how
 * many and nothing else — not who, not whether the settlement had just put its
 * only master forager on a woodpile, not that one of the two was fourteen. The
 * people are the whole point of the building, and the panel could not name them.
 *
 * So a card each: who they are, how old, which of the two, and what they are
 * worth at this trade. For a **house** the same cards list the family that sleeps
 * there, because "Residents 3/4" has exactly the same problem.
 *
 * Pure, like `productionModel`: simulation and a building in, plain rows out. The
 * portrait is named rather than drawn — this file decides *which* face, and the
 * HUD decides what a face looks like.
 */

import { buildingDefinition, type BuildingId } from '@/data/buildings';
import { ADULT_AGE, RETIREMENT_AGE } from '@/data/population';
import { skillLevelOf, skillYears, type SkillLevel } from '@/data/skills';
import type { Simulation } from '@/simulation/Simulation';
import type { Sex, Villager } from '@/simulation/villagers/Villager';

/**
 * Which face to draw.
 *
 * Four rather than two, because age reads at a glance where a number does not: a
 * settlement of children and elders looks like one, and that is the thing a
 * player needs to notice about a population that has stopped working.
 */
export type PortraitKind = 'child' | 'woman' | 'man' | 'elder';

/**
 * The colours villagers are told apart by.
 *
 * Muted and earthy on purpose — dyed wool, not highlighter pens. Assigned by id
 * so somebody keeps the same colour for their whole life, which is what makes it
 * worth having at all.
 */
export const CARD_COLOURS: readonly string[] = [
  '#8a7a5c',
  '#6f7f6a',
  '#8c6a5a',
  '#6c7484',
  '#8a7f96',
  '#7f8a6a',
];

export interface PersonCard {
  readonly id: number;
  readonly name: string;
  readonly age: number;
  readonly sex: Sex;
  readonly portrait: PortraitKind;
  /** Their colour, the same one for life. */
  readonly colour: string;
  readonly isIll: boolean;
  /**
   * What they have reached at the trade this card is shown under.
   *
   * `'none'` for somebody who has not put a year in yet — most of a young
   * settlement, and calling them apprentices would make the ladder meaningless.
   */
  readonly level: SkillLevel;
  /** Whole years at that trade. */
  readonly years: number;
  /** The trade the level is about, or `null` when they have no trade at all. */
  readonly trade: BuildingId | null;
}

/**
 * The people to show under a building.
 *
 * Its workers for a workplace, its residents for a house, nobody for a yard.
 * Empty while a building is still going up: the site has no posts and no beds.
 */
export function cardsFor(simulation: Simulation, buildingId: number): readonly PersonCard[] {
  const building = simulation.world.buildings.getById(buildingId);
  if (!building || !building.isComplete) {
    return [];
  }

  const definition = building.definition;
  if (definition.workerSlots > 0) {
    const trade = definition.id;
    const people = building.workers
      .map((id) => simulation.villagers.all.find((villager) => villager.id === id))
      .filter((villager): villager is Villager => villager !== undefined);
    // The best of them first: on a three-slot workshop the master is what the
    // player is looking at the panel to find.
    return people
      .map((villager) => cardFor(villager, trade))
      .sort((a, b) => b.years - a.years || a.name.localeCompare(b.name));
  }

  if ((definition.housing ?? 0) > 0) {
    // Oldest first, so a household reads as parents then children.
    return simulation.villagers.all
      .filter((villager) => villager.homeId === building.id)
      .sort((a, b) => b.age - a.age || a.id - b.id)
      .map((villager) => cardFor(villager, villager.bestTrade));
  }

  return [];
}

/** The same card, for one person at one trade. Exported for the roster's use. */
export function cardFor(villager: Villager, trade: BuildingId | null): PersonCard {
  const days = trade === null ? 0 : villager.experienceAt(trade);
  const level = skillLevelOf(days);
  return {
    id: villager.id,
    name: villager.name,
    age: villager.age,
    sex: villager.sex,
    portrait: portraitFor(villager),
    colour: CARD_COLOURS[villager.id % CARD_COLOURS.length] ?? CARD_COLOURS[0]!,
    isIll: villager.isIll,
    level,
    years: skillYears(days),
    // Set only when there is a level to name it with: a forager three days in
    // has a trade in the sense that she is standing in a hut, and in no other.
    trade: level === 'none' ? null : trade,
  };
}

function portraitFor(villager: Villager): PortraitKind {
  if (villager.age < ADULT_AGE) {
    return 'child';
  }
  if (villager.age >= RETIREMENT_AGE) {
    return 'elder';
  }
  return villager.sex === 'f' ? 'woman' : 'man';
}

/** Whether a building has people worth drawing cards for at all. */
export function hasCards(buildingId: BuildingId): boolean {
  const definition = buildingDefinition(buildingId);
  return definition.workerSlots > 0 || (definition.housing ?? 0) > 0;
}
