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
  | 'food'
  | 'iron'
  | 'tools'
  | 'hides'
  | 'clothing'
  | 'herbs';

export type ResourceCategory = 'material' | 'fuel' | 'food' | 'tool' | 'clothing';

export interface ResourceDefinition {
  readonly id: ResourceId;
  readonly name: string;
  readonly category: ResourceCategory;
  /**
   * How many fit in a single pile on the ground, and the unit storage counts
   * in. Bulky things stack lower, so hauling logs takes more trips than food.
   */
  readonly maxStack: number;
  /** How many units a villager can carry at once. */
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
}

export const RESOURCES: Readonly<Record<ResourceId, ResourceDefinition>> = {
  logs: {
    id: 'logs',
    name: 'Logs',
    category: 'material',
    maxStack: 20,
    carryLimit: 5,
    spoilsPerDay: 0,
  },
  firewood: {
    id: 'firewood',
    name: 'Firewood',
    category: 'fuel',
    maxStack: 40,
    carryLimit: 10,
    spoilsPerDay: 0,
  },
  stone: {
    id: 'stone',
    name: 'Stone',
    category: 'material',
    maxStack: 20,
    carryLimit: 4,
    spoilsPerDay: 0,
  },
  iron: {
    id: 'iron',
    name: 'Iron',
    category: 'material',
    // Dense and heavy: a villager carries less of it than of anything else,
    // so a mine a long way from a yard is a real cost rather than a detail.
    maxStack: 15,
    carryLimit: 3,
    spoilsPerDay: 0,
  },
  tools: {
    id: 'tools',
    name: 'Tools',
    category: 'tool',
    maxStack: 20,
    carryLimit: 6,
    // Tools wear out through use, not through sitting in a yard. The wear is
    // charged daily against the people doing the work, which is a different
    // thing from spoilage and lives in the survival system.
    spoilsPerDay: 0,
  },
  hides: {
    id: 'hides',
    name: 'Hides',
    category: 'material',
    maxStack: 20,
    carryLimit: 6,
    spoilsPerDay: 0,
  },
  clothing: {
    id: 'clothing',
    name: 'Clothing',
    category: 'clothing',
    maxStack: 20,
    carryLimit: 5,
    // Wears out on people's backs through a cold winter, not in a yard. Like
    // tools, that wear is charged daily and lives in the survival system.
    spoilsPerDay: 0,
  },
  herbs: {
    id: 'herbs',
    name: 'Herbs',
    category: 'food',
    maxStack: 30,
    carryLimit: 10,
    // Dried and hung, not eaten fresh. They keep, which is the only reason a
    // settlement can gather them in summer against a winter of illness.
    spoilsPerDay: 0,
  },
  food: {
    id: 'food',
    name: 'Food',
    category: 'food',
    maxStack: 50,
    carryLimit: 15,
    // Roughly a tenth of an open stockpile turns each day: enough that a heap
    // of food in a general yard will not survive a winter, and not so much
    // that the settlement cannot live hand to mouth in summer without a larder.
    spoilsPerDay: 0.1,
  },
};

/** Every resource, in a stable order. Used by the HUD and by tests. */
export const RESOURCE_IDS: readonly ResourceId[] = [
  'food',
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
