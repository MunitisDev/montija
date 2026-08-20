/**
 * Resource definitions.
 *
 * Data-driven, so no system hard-codes what a resource is or how much of it
 * fits somewhere. Adding iron, tools or clothing later should mean adding rows
 * here, not editing hauling or storage code.
 */

export type ResourceId =
  | 'logs'
  | 'firewood'
  | 'stone'
  | 'vegetables'
  | 'fruit'
  | 'fish'
  | 'meat'
  | 'spices'
  | 'iron'
  | 'tools'
  | 'hides'
  | 'clothing'
  | 'herbs';

export type ResourceCategory = 'material' | 'fuel' | 'food' | 'medicine' | 'tool' | 'clothing';

export interface ResourceDefinition {
  readonly id: ResourceId;
  readonly name: string;
  readonly category: ResourceCategory;
  /**
   * How many fit in a single pile on the ground, and the unit storage counts
   * in. Bulky things stack lower, so hauling logs takes more trips than food.
   */
  readonly maxStack: number;
  /**
   * How many units a villager can carry at once.
   *
   * **Doubled once, on the evidence.** A player sent a screenshot of a working
   * settlement of twenty-eight people with the ground carpeted in goods — nine
   * hundred logs, five hundred stone, four hundred food in three hundred and
   * thirty-eight heaps. Every one of those needed a trip, and a pile of twenty
   * logs at five a trip is four of them. Doubling every limit halves the number
   * of journeys the settlement owes without changing anything about what it can
   * hold or how fast it works.
   */
  readonly carryLimit: number;
  /**
   * Fraction of a stock lost per day in ordinary storage, or 0 for goods that
   * keep indefinitely.
   *
   * Only food spoils. Timber and stone sitting in a yard are the same timber
   * and stone a year later, and pretending otherwise would be busywork rather
   * than a decision.
   */
  readonly spoilsPerDay: number;
  /**
   * How much of this the settlement wants on its shelves, per villager.
   *
   * **Not a cap and not a target the player is shown — a price on labour.** A
   * settlement with a hundred and seventy logs in the yard and no food in the
   * larder was measured spending a third of its waking hours carrying more logs
   * in, because every haul on the board was worth exactly as much as every other
   * one. Above this figure a haul of this good drops to the bottom of the board,
   * which frees the hands that were doing worthless work.
   *
   * Read per person so it grows with the settlement: eight logs each is a modest
   * timber reserve for ten and a modest one for eighty.
   */
  readonly wantedPerVillager: number;
}

export const RESOURCES: Readonly<Record<ResourceId, ResourceDefinition>> = {
  logs: {
    id: 'logs',
    name: 'Logs',
    category: 'material',
    maxStack: 20,
    carryLimit: 10,
    spoilsPerDay: 0,
    wantedPerVillager: 8,
  },
  firewood: {
    id: 'firewood',
    name: 'Firewood',
    category: 'fuel',
    maxStack: 40,
    carryLimit: 20,
    spoilsPerDay: 0,
    wantedPerVillager: 15,
  },
  stone: {
    id: 'stone',
    name: 'Stone',
    category: 'material',
    maxStack: 20,
    carryLimit: 8,
    spoilsPerDay: 0,
    wantedPerVillager: 5,
  },
  iron: {
    id: 'iron',
    name: 'Iron',
    category: 'material',
    // Dense and heavy: a villager carries less of it than of anything else,
    // so a mine a long way from a yard is a real cost rather than a detail.
    maxStack: 15,
    carryLimit: 6,
    spoilsPerDay: 0,
    wantedPerVillager: 3,
  },
  tools: {
    id: 'tools',
    name: 'Tools',
    category: 'tool',
    maxStack: 20,
    carryLimit: 12,
    // Tools wear out through use, not through sitting in a yard. The wear is
    // charged daily against the people doing the work, which is a different
    // thing from spoilage and lives in the survival system.
    spoilsPerDay: 0,
    wantedPerVillager: 2,
  },
  hides: {
    id: 'hides',
    name: 'Hides',
    category: 'material',
    maxStack: 20,
    carryLimit: 12,
    spoilsPerDay: 0,
    wantedPerVillager: 3,
  },
  clothing: {
    id: 'clothing',
    name: 'Clothing',
    category: 'clothing',
    maxStack: 20,
    carryLimit: 10,
    // Wears out on people's backs through a cold winter, not in a yard. Like
    // tools, that wear is charged daily and lives in the survival system.
    spoilsPerDay: 0,
    wantedPerVillager: 2,
  },
  herbs: {
    id: 'herbs',
    name: 'Herbs',
    // **Medicine, not a meal**, and it is a category of its own for a concrete
    // reason: everything in the `food` category is eaten, and a settlement that
    // could live on dried yarrow — or that counted it towards a varied diet —
    // would be able to answer a famine with a herbalist.
    category: 'medicine',
    maxStack: 30,
    carryLimit: 20,
    // Dried and hung, not eaten fresh. They keep, which is the only reason a
    // settlement can gather them in summer against a winter of illness.
    spoilsPerDay: 0,
    wantedPerVillager: 2,
  },
  /**
   * The five foods.
   *
   * **One good called "food" was the last place in the economy where the player
   * had no decisions to make.** Every building that fed the settlement made the
   * same interchangeable number, so a village with four gatherer huts ate exactly
   * as well as one with a field, an orchard, a boat and a hunter — and the second
   * had gone to far more trouble for it.
   *
   * Each building now brings in its own kind, and what the settlement gets for
   * keeping several of them is in `seasons/SurvivalSystem.ts`: a varied larder
   * lifts spirit and keeps people out of their sickbeds, and people who are never
   * ill live longer. The calories are identical — a fish feeds somebody exactly
   * as well as a cabbage — so variety is a comfort to collect rather than a tax
   * for playing simply.
   *
   * They differ in what they *are*, which is the part that makes the choice real:
   * how fast they turn, and which season brings them in. Fish keeps worst and is
   * the one thing that comes in under snow; spices keep almost indefinitely and
   * are the smallest harvest. The four bulk foods hold and carry alike, because a
   * basket is a basket and inventing five carrying weights would be detail
   * nobody could act on.
   *
   * The per-villager appetites add to the twenty-five one food used to want, so a
   * settlement that keeps a spread of everything wants no more carrying done than
   * it ever did.
   */
  vegetables: {
    id: 'vegetables',
    name: 'Vegetables',
    category: 'food',
    maxStack: 50,
    carryLimit: 30,
    // Roughly a tenth of an open stockpile turns each day: enough that a heap
    // of food in a general yard will not survive a winter, and not so much
    // that the settlement cannot live hand to mouth in summer without a larder.
    spoilsPerDay: 0.09,
    wantedPerVillager: 8,
  },
  fruit: {
    id: 'fruit',
    name: 'Fruit',
    category: 'food',
    maxStack: 50,
    carryLimit: 30,
    spoilsPerDay: 0.11,
    wantedPerVillager: 6,
  },
  fish: {
    id: 'fish',
    name: 'Fish',
    category: 'food',
    maxStack: 50,
    carryLimit: 30,
    // The worst keeper in the settlement, which is the price of the one harvest
    // that still comes in through January: a winter of fish has to be eaten as
    // it is caught.
    spoilsPerDay: 0.14,
    wantedPerVillager: 4,
  },
  meat: {
    id: 'meat',
    name: 'Meat',
    category: 'food',
    maxStack: 50,
    carryLimit: 30,
    spoilsPerDay: 0.1,
    wantedPerVillager: 5,
  },
  spices: {
    id: 'spices',
    name: 'Spices',
    category: 'food',
    // **The same basket as the rest, and that was measured.** A smaller stack
    // and a lighter load looked like the right flavour for the smallest harvest
    // and cost twenty lives across twenty-four worlds: this is what a settlement
    // forages in its first year, so carrying it at twenty a trip instead of
    // thirty is a fifty per cent hauling tax on the food the whole opening runs
    // on. Foods differ by their season, not by their weight.
    maxStack: 50,
    carryLimit: 30,
    // **They rot like everything else, and that was measured.** Dried roots and
    // hung berries keeping almost indefinitely is the truthful thing to say
    // about them and it broke the opening: what a settlement forages is the food
    // it lives on in its first year, so a forage that did not spoil made the
    // larder optional, let a one-hut village grow, and took winter's teeth out —
    // four of the balance claims failed at once. The five foods differ by the
    // *season* that brings them in, which is the axis worth having.
    spoilsPerDay: 0.1,
    wantedPerVillager: 2,
  },
};

/**
 * Everything the settlement eats, in a stable order.
 *
 * The order the drawer lists them in and the order a meal is drawn from, so a
 * player reading their stores and a settlement eating them agree about what is
 * "first". Derived nowhere: a food is a food because it is in this list.
 */
export const FOOD_IDS: readonly ResourceId[] = ['vegetables', 'fruit', 'fish', 'meat', 'spices'];

/** `true` when this is something people eat. */
export function isFood(resource: ResourceId): boolean {
  return RESOURCES[resource].category === 'food';
}

/** Every resource, in a stable order. Used by the HUD and by tests. */
export const RESOURCE_IDS: readonly ResourceId[] = [
  'vegetables',
  'fruit',
  'fish',
  'meat',
  'spices',
  'logs',
  'firewood',
  'stone',
  'iron',
  'tools',
  'hides',
  'clothing',
  'herbs',
];

export function resourceDefinition(id: ResourceId): ResourceDefinition {
  return RESOURCES[id];
}

/** How many logs a felled tree drops. Balance comes later. */
export const LOGS_PER_TREE = 4;

/** How much stone one surface deposit yields. */
export const STONE_PER_DEPOSIT = 6;
