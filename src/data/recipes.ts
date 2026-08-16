/**
 * Production recipes.
 *
 * Data-driven, so the production system never names a specific good. Adding
 * "smelt iron" later means adding a row here and pointing a building at it.
 *
 * Exact balance comes later, as the brief says. These numbers exist to make the
 * loop work, not to be fair.
 */

import type { SeasonalProfile } from '@/simulation/seasons/SeasonClock';
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
   * How this recipe's yield rides the year.
   *
   * `'none'` for a workshop, which does not care what month it is. Everything
   * that comes out of the ground has a curve, and the curves differ: that
   * difference is the entire reason a field is worth sowing when foraging
   * already exists.
   */
  readonly seasonal: SeasonalProfile;
}

export const RECIPES: Readonly<Record<string, Recipe>> = {
  'forage-food': {
    id: 'forage-food',
    name: 'Forage',
    inputs: [],
    outputs: [{ resource: 'food', amount: 6 }],
    workTicks: 40,
    seasonal: 'forage',
  },
  'cut-stone': {
    id: 'cut-stone',
    name: 'Cut stone',
    inputs: [],
    outputs: [{ resource: 'stone', amount: 4 }],
    // Slow. A quarry is not meant to beat picking up a surface deposit — it is
    // meant to still be there in ten years, when every deposit is gone.
    workTicks: 70,
    seasonal: 'none',
  },
  'dig-iron': {
    id: 'dig-iron',
    name: 'Dig iron',
    inputs: [],
    outputs: [{ resource: 'iron', amount: 2 }],
    workTicks: 90,
    seasonal: 'none',
  },
  'forge-tools': {
    id: 'forge-tools',
    name: 'Forge tools',
    inputs: [
      { resource: 'iron', amount: 2 },
      { resource: 'logs', amount: 1 },
    ],
    outputs: [{ resource: 'tools', amount: 3 }],
    workTicks: 60,
    seasonal: 'none',
  },
  'grow-crops': {
    id: 'grow-crops',
    name: 'Work the field',
    inputs: [],
    outputs: [{ resource: 'food', amount: 7 }],
    workTicks: 45,
    seasonal: 'crop',
  },
  'tend-orchard': {
    id: 'tend-orchard',
    name: 'Tend the orchard',
    inputs: [],
    outputs: [{ resource: 'food', amount: 9 }],
    workTicks: 50,
    seasonal: 'orchard',
  },
  'split-firewood': {
    id: 'split-firewood',
    name: 'Split firewood',
    inputs: [{ resource: 'logs', amount: 1 }],
    outputs: [{ resource: 'firewood', amount: 4 }],
    workTicks: 30,
    seasonal: 'none',
  },
};

export function recipe(id: string): Recipe | null {
  return RECIPES[id] ?? null;
}
