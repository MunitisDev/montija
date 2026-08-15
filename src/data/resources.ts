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
}

export const RESOURCES: Readonly<Record<ResourceId, ResourceDefinition>> = {
  logs: { id: 'logs', name: 'Logs', category: 'material', maxStack: 20, carryLimit: 5 },
  firewood: { id: 'firewood', name: 'Firewood', category: 'fuel', maxStack: 40, carryLimit: 10 },
  stone: { id: 'stone', name: 'Stone', category: 'material', maxStack: 20, carryLimit: 4 },
  food: { id: 'food', name: 'Food', category: 'food', maxStack: 50, carryLimit: 15 },
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
