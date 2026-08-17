/**
 * What a building says it can make.
 *
 * The numbers were all in the recipe table and none of them were on screen, so
 * choosing between a Quarry and a Woodcutter meant comparing two rates the game
 * never told you. These tests are mostly about the figure being *derived* rather
 * than written down: a rate typed into a description starts lying the first time
 * somebody retunes a recipe, and the point of the model is that it cannot.
 */

import { describe, expect, it } from 'vitest';

import { BUILDING_IDS, buildingDefinition } from '@/data/buildings';
import { recipe as findRecipe } from '@/data/recipes';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { NO_PRODUCTION, productionSummary } from '@/ui/hud/productionModel';

describe('a building that produces something', () => {
  it('counts every post, because every worker runs the recipe', () => {
    // A two-slot hut forages twice over; it does not forage once faster. This
    // was worth pinning: reading `workerSlots` as a speed multiplier on one
    // shared job would halve every figure in the game.
    const hut = productionSummary('gatherer-hut');
    const definition = buildingDefinition('gatherer-hut');
    const recipe = findRecipe(definition.recipeId!)!;
    const runsPerWorker = TICKS_PER_DAY / recipe.workTicks;

    expect(definition.workerSlots).toBe(2);
    expect(hut.outputs[0]!.perDay).toBeCloseTo(
      Math.round(recipe.outputs[0]!.amount * 1.4) * runsPerWorker * 2,
      1,
    );
  });

  it('quotes the season a foraged peak belongs to', () => {
    // Summer is forty per cent better than autumn and winter is nothing at all,
    // so a bare "24 food a day" would be the panel overpromising.
    expect(productionSummary('gatherer-hut').peakSeason).toBe('summer');
    expect(productionSummary('orchard').peakSeason).toBe('autumn');
  });

  it('names no season for a workshop, which does not care', () => {
    expect(productionSummary('quarry').peakSeason).toBeNull();
    expect(productionSummary('woodcutter').peakSeason).toBeNull();
    expect(productionSummary('blacksmith').peakSeason).toBeNull();
  });

  it('reports what a workshop eats as well as what it makes', () => {
    // A Woodcutter at full tilt is four logs a day nobody else is building
    // with, which is a decision about logs as much as about firewood.
    const woodcutter = productionSummary('woodcutter');
    expect(woodcutter.outputs).toEqual([{ resource: 'firewood', perDay: 16 }]);
    expect(woodcutter.inputs).toEqual([{ resource: 'logs', perDay: 4 }]);
  });

  it('does not pretend a gathered good costs anything', () => {
    expect(productionSummary('quarry').inputs).toEqual([]);
  });

  it('reports both halves of a recipe with two outputs', () => {
    const hunter = productionSummary('hunter');
    expect(hunter.outputs.map((rate) => rate.resource)).toEqual(['food', 'hides']);
  });
});

describe('a building that produces nothing', () => {
  it('says so rather than reporting zero', () => {
    // A house is not a slow producer; it is not a producer. Zero on the panel
    // would read as "broken workshop".
    for (const id of ['house', 'storage-yard', 'food-storage', 'cemetery'] as const) {
      expect(productionSummary(id)).toEqual(NO_PRODUCTION);
    }
  });

  it('says so for a lodge that works on the map instead', () => {
    // The Forester's Lodge plants and marks trees rather than making a good, so
    // it has no rate to quote — its output is the wood still standing in ten
    // years, which is not a number a day.
    expect(productionSummary('forester').outputs).toEqual([]);
  });
});

describe('the figures track the data', () => {
  it('gives a rate to exactly the buildings with a recipe and a post', () => {
    for (const id of BUILDING_IDS) {
      const definition = buildingDefinition(id);
      const produces = definition.recipeId !== undefined && definition.workerSlots > 0;
      expect(productionSummary(id).outputs.length > 0).toBe(produces);
    }
  });

  it('never quotes a fraction the simulation cannot make', () => {
    // Output is rounded per run exactly as the production system rounds it, so
    // a seasonal scale can never promise half a log that never appears.
    for (const id of BUILDING_IDS) {
      for (const rate of productionSummary(id).outputs) {
        expect(rate.perDay).toBeGreaterThan(0);
        expect(Number.isFinite(rate.perDay)).toBe(true);
      }
    }
  });
});
