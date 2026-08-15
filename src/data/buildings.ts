/**
 * Building definitions.
 *
 * Data-driven, so the build menu, the placement rules, the construction costs
 * and the production behaviour all read from here. Adding a building should
 * mean adding a row, never writing a new menu button or a new placement branch.
 */

import type { ResourceId } from './resources';

export type BuildingId = 'house' | 'storage-yard' | 'food-storage' | 'gatherer-hut' | 'woodcutter';

export interface ResourceAmount {
  readonly resource: ResourceId;
  readonly amount: number;
}

export interface BuildingDefinition {
  readonly id: BuildingId;
  readonly name: string;
  /** One-line explanation, shown in the build menu. */
  readonly description: string;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly constructionCost: readonly ResourceAmount[];
  /** Ticks of labour needed once every material is on site. */
  readonly buildTicks: number;
  readonly workerSlots: number;

  /** Set when the building stores resources. */
  readonly storage?: {
    readonly capacity: number;
    readonly accepts?: readonly ResourceId[];
    /** Multiplier on spoilage here; 1 is an open yard, lower keeps food better. */
    readonly preservation?: number;
  };
  /** How many villagers can live here. */
  readonly housing?: number;
  /** The recipe produced here, from `data/recipes.ts`. Phase 7. */
  readonly recipeId?: string;
}

/**
 * The five buildings the brief calls for, and no more.
 *
 * Costs are placeholders — the brief is explicit that exact balance comes
 * later, and that these values belong in data rather than in code.
 */
export const BUILDINGS: Readonly<Record<BuildingId, BuildingDefinition>> = {
  house: {
    id: 'house',
    name: 'House',
    description: 'Shelter for a family. Keeps its residents warm in winter.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 8 },
      { resource: 'stone', amount: 4 },
    ],
    buildTicks: 120,
    workerSlots: 0,
    housing: 4,
  },
  'storage-yard': {
    id: 'storage-yard',
    name: 'Storage Yard',
    description: 'Holds logs, stone and firewood.',
    footprint: { width: 3, height: 3 },
    constructionCost: [{ resource: 'logs', amount: 6 }],
    buildTicks: 80,
    workerSlots: 0,
    storage: { capacity: 1000, accepts: ['logs', 'stone', 'firewood'] },
  },
  'food-storage': {
    id: 'food-storage',
    name: 'Food Storage',
    description: 'Keeps food from spoiling. Food left in an open yard rots.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 6 },
      { resource: 'stone', amount: 2 },
    ],
    buildTicks: 90,
    workerSlots: 0,
    // A tenth of the spoilage of an open yard. This is the whole reason the
    // building exists: food will sit anywhere, but only keeps through a winter
    // in here.
    storage: { capacity: 800, accepts: ['food'], preservation: 0.1 },
  },
  'gatherer-hut': {
    id: 'gatherer-hut',
    name: 'Gatherer Hut',
    description: 'Workers forage the surrounding woods for food.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 10 },
      { resource: 'stone', amount: 2 },
    ],
    buildTicks: 110,
    workerSlots: 2,
    recipeId: 'forage-food',
  },
  woodcutter: {
    id: 'woodcutter',
    name: 'Woodcutter',
    description: 'Splits logs into firewood.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 8 },
      { resource: 'stone', amount: 4 },
    ],
    buildTicks: 100,
    workerSlots: 2,
    recipeId: 'split-firewood',
  },
};

/** Menu order. Storage first, because nothing else works without somewhere to put things. */
export const BUILDING_IDS: readonly BuildingId[] = [
  'house',
  'storage-yard',
  'food-storage',
  'gatherer-hut',
  'woodcutter',
];

export function buildingDefinition(id: BuildingId): BuildingDefinition {
  return BUILDINGS[id];
}
