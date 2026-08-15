/**
 * Resource definitions.
 *
 * Data-driven, so no system hard-codes what a resource is or how much of it
 * fits somewhere. Adding iron, tools or clothing later should mean adding rows
 * here, not editing hauling or storage code.
 */

export type ResourceId = 'logs' | 'firewood' | 'stone' | 'food';

export type ResourceCategory = 'material' | 'fuel' | 'food';

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
export const RESOURCE_IDS: readonly ResourceId[] = ['food', 'logs', 'firewood', 'stone'];

export function resourceDefinition(id: ResourceId): ResourceDefinition {
  return RESOURCES[id];
}

/** How many logs a felled tree drops. Balance comes later. */
export const LOGS_PER_TREE = 4;

/** How much stone one surface deposit yields. */
export const STONE_PER_DEPOSIT = 6;
