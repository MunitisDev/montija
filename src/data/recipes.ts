/**
 * Production recipes.
 *
 * Data-driven, so the production system never names a specific good. Adding
 * "smelt iron" later means adding a row here and pointing a building at it.
 *
 * Exact balance comes later, as the brief says. These numbers exist to make the
 * loop work, not to be fair.
 */

import type { ResourceId } from './resources';

export interface RecipeIngredient {
  readonly resource: ResourceId;
  readonly amount: number;
}

export interface Recipe {
  readonly id: string;
  readonly name: string;
  /** Consumed each time the recipe runs. Empty for gathering. */
  readonly inputs: readonly RecipeIngredient[];
  readonly outputs: readonly RecipeIngredient[];
  /** Simulation ticks of labour per run. */
  readonly workTicks: number;
  /**
   * Which season multiplies output, for Phase 8.
   * Foraging is bountiful in summer and barren under snow.
   */
  readonly seasonal: boolean;
}

export const RECIPES: Readonly<Record<string, Recipe>> = {
  'forage-food': {
    id: 'forage-food',
    name: 'Forage',
    inputs: [],
    outputs: [{ resource: 'food', amount: 6 }],
    workTicks: 40,
    seasonal: true,
  },
  'split-firewood': {
    id: 'split-firewood',
    name: 'Split firewood',
    inputs: [{ resource: 'logs', amount: 1 }],
    outputs: [{ resource: 'firewood', amount: 4 }],
    workTicks: 30,
    seasonal: false,
  },
};

export function recipe(id: string): Recipe | null {
  return RECIPES[id] ?? null;
}
