/**
 * What a building can make, at full staff.
 *
 * **The numbers existed and were unknowable.** A Quarry cuts four stone every
 * seventy ticks in three posts; a Woodcutter turns one log into four firewood
 * every thirty in two. Both facts live in a recipe table, neither was on screen,
 * and a player deciding between them was choosing between two buildings whose
 * whole purpose is a rate they could not see. Comparing them meant reading the
 * source.
 *
 * Pure, and derived rather than written down a second time: the figure is
 * computed from the same recipe and worker count the simulation runs on, so a
 * balance change moves the panel with it. A number typed into a description
 * would start lying the first time somebody retuned a recipe.
 *
 * It is a *ceiling*, and deliberately labelled as one. Real output falls short
 * of it for reasons the panel cannot summarise — walking to the work, hauling
 * the output away, hands lost to illness — and rises above it with tools and a
 * settled village. What the player needs is the comparison, not a forecast.
 */

import { buildingDefinition, type BuildingId } from '@/data/buildings';
import type { ResourceId } from '@/data/resources';
import { recipe as findRecipe } from '@/data/recipes';
import { SEASONAL_YIELD, TICKS_PER_DAY, type Season } from '@/simulation/seasons/SeasonClock';

export interface ProductionRate {
  readonly resource: ResourceId;
  /**
   * Units a day with every post filled, in this building's best season.
   *
   * Unrounded, and usually not a whole number — a Quarry's three cutters make
   * 10.285… stone a day. Rounding belongs to whoever prints it, and the panel
   * prints a season's worth; see `@/ui/format/rates`.
   */
  readonly perDay: number;
}

export interface ProductionSummary {
  /** What comes out. Empty for a building that produces nothing. */
  readonly outputs: readonly ProductionRate[];
  /** What it eats to do it, at that same rate. Empty for gathering. */
  readonly inputs: readonly ProductionRate[];
  /**
   * The season the peak belongs to, or `null` when the year makes no difference.
   *
   * A workshop's rate is its rate. A Gatherer Hut's best day is in summer and
   * its worst is nothing at all, and quoting the summer figure without saying
   * so would be the panel overpromising by forty per cent.
   */
  readonly peakSeason: Season | null;
}

export const NO_PRODUCTION: ProductionSummary = { outputs: [], inputs: [], peakSeason: null };

/**
 * The most a building can turn out in a day.
 *
 * @param siteBonus what this building's surroundings multiply its output by; 1
 *   for a building with nothing helpful nearby, and for the build menu, where
 *   there is no building yet to have neighbours. See
 *   `simulation/production/siteYield`.
 * @returns {@link NO_PRODUCTION} for anything without a recipe — a house, a
 *   yard, a cemetery. Those are not slower producers, they are not producers.
 */
export function productionSummary(buildingId: BuildingId, siteBonus = 1): ProductionSummary {
  const definition = buildingDefinition(buildingId);
  const recipe = definition.recipeId ? findRecipe(definition.recipeId) : null;
  if (!recipe || definition.workerSlots <= 0) {
    return NO_PRODUCTION;
  }

  // Each worker runs the recipe themselves — a two-slot hut forages twice over,
  // it does not forage once faster.
  const runsPerDay = (TICKS_PER_DAY / recipe.workTicks) * definition.workerSlots;

  const curve = SEASONAL_YIELD[recipe.seasonal];
  const peakSeason = recipe.seasonal === 'none' ? null : bestSeason(curve);
  // The season, times whatever the building's neighbours are worth to it. An
  // orchard beside a larder really does bring in twice the fruit, and a panel
  // that quoted the lone figure would be telling the player the larder they can
  // see standing next to it does nothing.
  const scale = (peakSeason === null ? 1 : curve[peakSeason]) * siteBonus;

  return {
    // Rounded per run, exactly as the simulation rounds it, so the panel cannot
    // promise a fraction of a log that never appears. The runs themselves are
    // left fractional: a workshop mid-run at nightfall finishes it the next
    // morning, so over a season the fraction is real output.
    outputs: recipe.outputs.map((output) => ({
      resource: output.resource,
      perDay: Math.round(output.amount * scale) * runsPerDay,
    })),
    // Inputs are not scaled by the season: a woodcutter splits the same log in
    // January. Only what comes *out* of the ground rides the year.
    inputs: recipe.inputs.map((input) => ({
      resource: input.resource,
      perDay: input.amount * runsPerDay,
    })),
    peakSeason,
  };
}

/** The season a yield curve is highest in. Ties go to the earlier season. */
function bestSeason(curve: Readonly<Record<Season, number>>): Season {
  const seasons: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
  let best: Season = 'spring';
  for (const season of seasons) {
    if (curve[season] > curve[best]) {
      best = season;
    }
  }
  return best;
}
