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
    // **Halved, on the evidence.** At four a cut, eight measured settlements
    // finished their third year with five hundred and twenty stone apiece on
    // the shelves — a quarry and two masons out-supplying everything the
    // settlement could think of to build, so stone stopped being a thing anyone
    // had to plan for. Two a cut keeps it a decision.
    outputs: [{ resource: 'stone', amount: 2 }],
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
  'hunt-game': {
    id: 'hunt-game',
    name: 'Hunt',
    inputs: [],
    // Two goods from one hunt. Meat is the reason to build it; the hides are
    // what make winter survivable in a way firewood alone cannot, and getting
    // both from one building is what stops clothing being a chore bolted on to
    // an economy that had no room for it.
    outputs: [
      { resource: 'food', amount: 5 },
      { resource: 'hides', amount: 2 },
    ],
    workTicks: 55,
    // Game is thin in spring and fat before the cold, which is the opposite
    // shape to a field and gives a settlement a second, differently-timed way
    // to eat.
    seasonal: 'game',
  },
  'sew-clothing': {
    id: 'sew-clothing',
    name: 'Sew clothing',
    inputs: [{ resource: 'hides', amount: 3 }],
    outputs: [{ resource: 'clothing', amount: 2 }],
    workTicks: 55,
    seasonal: 'none',
  },
  'gather-herbs': {
    id: 'gather-herbs',
    name: 'Gather herbs',
    inputs: [],
    outputs: [{ resource: 'herbs', amount: 4 }],
    workTicks: 45,
    // The same curve as foraging: what grows, grows when it grows. Herbs keep,
    // so a settlement gathers them against a winter it cannot gather in.
    seasonal: 'forage',
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
