/**
 * Building definitions.
 *
 * Data-driven, so the build menu, the placement rules, the construction costs
 * and the production behaviour all read from here. Adding a building should
 * mean adding a row, never writing a new menu button or a new placement branch.
 */

import type { ResourceId } from './resources';
import type { TerrainType } from './terrain';

export type BuildingId =
  | 'house'
  | 'storage-yard'
  | 'food-storage'
  | 'gatherer-hut'
  | 'woodcutter'
  | 'forester'
  | 'quarry'
  | 'mine'
  | 'blacksmith'
  | 'crop-field'
  | 'orchard'
  | 'hunter'
  | 'tailor';

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

  /**
   * Set for a building that manages the woodland around it.
   *
   * Not a recipe, because forestry is not a transformation — it is work done on
   * the map itself, at cells rather than at a workbench. Its workers plant when
   * the wood is thin and fell when it is thick, which is what turns timber from
   * a finite deposit into something the player tends.
   */
  readonly forestry?: {
    /** How far from the lodge its workers range, in cells. */
    readonly radius: number;
    /** Trees the lodge tries to keep standing inside that range. */
    readonly targetTrees: number;
  };

  /**
   * Terrain this building must be dug into, if any.
   *
   * A quarry has to bite into a rock face; it cannot sit in a meadow. Checked
   * as *adjacency* rather than as the footprint itself, because the footprint
   * has to be buildable ground for anyone to work on it — what the rule really
   * says is that the working face must be within reach.
   */
  readonly adjacentTo?: TerrainType;
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
    description: 'Shelter for four. Firewood only warms people who have a house.',
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
    storage: {
      capacity: 1000,
      accepts: ['logs', 'stone', 'firewood', 'iron', 'tools', 'hides', 'clothing'],
    },
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
  quarry: {
    id: 'quarry',
    name: 'Quarry',
    description: 'Cuts stone out of a rock face for as long as it stands.',
    // Deliberately the largest thing in the game. A quarry is a permanent
    // decision about a piece of land: there is no demolition, so wherever it
    // goes it stays, and the price of never running out of stone is a hole in
    // the settlement you have to build around forever.
    footprint: { width: 3, height: 3 },
    constructionCost: [
      { resource: 'logs', amount: 24 },
      { resource: 'stone', amount: 12 },
    ],
    buildTicks: 220,
    workerSlots: 3,
    recipeId: 'cut-stone',
    adjacentTo: 'stone',
  },
  mine: {
    id: 'mine',
    name: 'Mine',
    description: 'Digs iron out of the hillside. Slow, and permanent.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 20 },
      { resource: 'stone', amount: 16 },
    ],
    buildTicks: 240,
    workerSlots: 2,
    recipeId: 'dig-iron',
    adjacentTo: 'stone',
  },
  'crop-field': {
    id: 'crop-field',
    name: 'Field',
    description: 'Sown in spring, worth having in autumn. Nothing at all in winter.',
    footprint: { width: 3, height: 3 },
    // Cheap and quick: a field is broken ground and a fence, not a building.
    // It has to be affordable in the first spring, because a settlement that
    // cannot farm until year two lives its first year on foraging alone.
    constructionCost: [{ resource: 'logs', amount: 6 }],
    buildTicks: 70,
    workerSlots: 2,
    recipeId: 'grow-crops',
  },
  orchard: {
    id: 'orchard',
    name: 'Orchard',
    description: 'Fruit trees. Years to establish, and the best harvest there is.',
    footprint: { width: 3, height: 3 },
    constructionCost: [
      { resource: 'logs', amount: 10 },
      { resource: 'stone', amount: 2 },
    ],
    // Far the longest build in the game, and that *is* the mechanic: an orchard
    // is a bet on a later autumn. Planting one in a hungry spring is a mistake;
    // planting one in a comfortable summer is how a settlement stops being
    // hungry for good.
    buildTicks: 400,
    workerSlots: 2,
    recipeId: 'tend-orchard',
  },
  hunter: {
    id: 'hunter',
    name: "Hunter's Cabin",
    description: 'Brings in meat and hides, and is the only work that pays in winter.',
    footprint: { width: 2, height: 2 },
    constructionCost: [{ resource: 'logs', amount: 10 }],
    buildTicks: 90,
    workerSlots: 2,
    recipeId: 'hunt-game',
  },
  tailor: {
    id: 'tailor',
    name: 'Tailor',
    description: 'Sews hides into clothing, which keeps people warm when the fire cannot.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 10 },
      { resource: 'stone', amount: 4 },
    ],
    buildTicks: 120,
    workerSlots: 2,
    recipeId: 'sew-clothing',
  },
  blacksmith: {
    id: 'blacksmith',
    name: 'Blacksmith',
    description: 'Forges iron into tools. Tools make every other job quicker.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 14 },
      { resource: 'stone', amount: 10 },
    ],
    buildTicks: 150,
    workerSlots: 2,
    recipeId: 'forge-tools',
  },
  forester: {
    id: 'forester',
    name: "Forester's Lodge",
    description: 'Workers plant and fell nearby, so the wood never runs out.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 12 },
      { resource: 'stone', amount: 2 },
    ],
    buildTicks: 110,
    workerSlots: 2,
    // A wide range and a density well under a natural wood's. The lodge is
    // meant to keep a working coppice, not to reforest the map: a player who
    // wants dense woodland leaves it alone, and one who wants a steady supply
    // builds this.
    forestry: { radius: 10, targetTrees: 110 },
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
  'forester',
  'quarry',
  'mine',
  'blacksmith',
  'crop-field',
  'orchard',
  'hunter',
  'tailor',
];

export function buildingDefinition(id: BuildingId): BuildingDefinition {
  return BUILDINGS[id];
}
