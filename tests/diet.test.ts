/**
 * Five foods, and what a varied table is worth.
 *
 * **One good called "food" was the last place in the economy with no decision in
 * it.** Every building that fed the settlement made the same interchangeable
 * number, so a village with four gatherer huts ate exactly as well as one with a
 * field, an orchard, a fishing hut and a hunter — and the second had gone to far
 * more trouble for it.
 *
 * The calories are deliberately identical: a fish feeds somebody exactly as well
 * as a cabbage, and a settlement living on one thing does not starve for it. What
 * variety buys is spirit and health, and health is how it becomes life
 * expectancy — days not spent ill are days at the end of a life. Every claim
 * below is about that chain, or about the two rules that decide which food comes
 * off which shelf.
 */

import { describe, expect, it } from 'vitest';

import { FOOD_IDS, RESOURCES, isFood } from '@/data/resources';
import { BUILDINGS, buildingDefinition } from '@/data/buildings';
import { DIET_SOLACE_SHARE, Simulation } from '@/simulation/Simulation';
import { StorageRegistry } from '@/simulation/logistics/Storage';
import {
  FOOD_KINDS,
  drawMeal,
  foodKinds,
  foodStored,
  foodWantedPerVillager,
  varietyShare,
} from '@/simulation/resources/diet';
import { DIET_HEALTH_SHARE, chanceFor } from '@/simulation/population/IllnessSystem';
import { FOOD_PER_VILLAGER_PER_DAY } from '@/simulation/seasons/SurvivalSystem';
import { recipe } from '@/data/recipes';
import type { ResourceId } from '@/data/resources';
import type { Villager } from '@/simulation/villagers/Villager';

const OPTIONS = { seed: 20260821, worldWidth: 96, worldHeight: 96, startingVillagers: 10 };

describe('the five foods', () => {
  it('are what the food buildings each bring in', () => {
    // One building, one kind: the whole reason to raise a second sort of food
    // building is that it puts a different thing on the shelf.
    const from = (id: Parameters<typeof buildingDefinition>[0]): readonly ResourceId[] => {
      const made = buildingDefinition(id).recipeId;
      return (made ? recipe(made)?.outputs : [])?.map((output) => output.resource) ?? [];
    };

    expect(from('gatherer-hut')).toEqual(['spices']);
    expect(from('crop-field')).toEqual(['vegetables']);
    expect(from('orchard')).toEqual(['fruit']);
    expect(from('fishing-hut')).toEqual(['fish']);
    expect(from('hunter')).toEqual(['meat', 'hides']);
  });

  it('feed a person exactly alike', () => {
    // The rule the whole feature rests on. If fish fed better than cabbage,
    // variety would be a tax on the settlement that farms.
    for (const id of FOOD_IDS) {
      expect(isFood(id)).toBe(true);
    }
    expect(FOOD_PER_VILLAGER_PER_DAY).toBe(1);
  });

  it('want between them what one food used to want alone', () => {
    // The hauling rule reads this. Splitting the appetite five ways and then
    // asking per kind would drop the harvest to the bottom of the job board
    // while the settlement was still four fifths short of a winter's food.
    expect(foodWantedPerVillager()).toBe(25);
  });

  it('do not count a herb as a meal', () => {
    // Herbs are in the game to treat illness. A settlement that could eat them
    // would be able to answer a famine with a herbalist.
    expect(RESOURCES.herbs.category).toBe('medicine');
    expect(isFood('herbs')).toBe(false);
    expect(FOOD_IDS).not.toContain('herbs');
  });

  it('all carry and stack alike, because they differ by season instead', () => {
    // Measured: a smaller basket for the smallest harvest cost twenty lives
    // across twenty-four worlds, because foraged food is what the opening runs
    // on and carrying it at twenty a trip is a hauling tax on the whole game.
    for (const id of FOOD_IDS) {
      expect(RESOURCES[id].carryLimit, id).toBe(RESOURCES.vegetables.carryLimit);
      expect(RESOURCES[id].maxStack, id).toBe(RESOURCES.vegetables.maxStack);
    }
  });
});

describe('a day’s rations', () => {
  it('come out of the exposed store before the larder', () => {
    // **Measured, and it cost twenty-two lives to get wrong.** Food in an open
    // yard is food that is about to rot; a settlement that ate its way through
    // the larder while the harvest spoiled outside would be wasting the very
    // building the player raised to stop it.
    const storages = new StorageRegistry();
    const larder = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500, preservation: 0.1 });
    const yard = storages.add({ cell: { gx: 5, gy: 5 }, capacity: 500 });
    larder.inventory.add('vegetables', 100);
    yard.inventory.add('vegetables', 100);

    expect(drawMeal(storages, 20)).toBe(20);
    expect(yard.inventory.count('vegetables')).toBe(80);
    expect(larder.inventory.count('vegetables')).toBe(100);
  });

  it('are spread across the kinds a store holds', () => {
    // A settlement eats mostly what it has most of. Draining the smallest kind
    // first would destroy the settlement's own variety on its behalf.
    const storages = new StorageRegistry();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    yard.inventory.add('vegetables', 60);
    yard.inventory.add('fish', 20);
    yard.inventory.add('meat', 20);

    expect(drawMeal(storages, 10)).toBe(10);
    expect(yard.inventory.count('vegetables')).toBe(54);
    expect(yard.inventory.count('fish')).toBe(18);
    expect(yard.inventory.count('meat')).toBe(18);
  });

  it('are eaten in full even when the shares round down', () => {
    // Whole units mean the proportional shares round down, and a settlement that
    // went very slightly hungry every day for the sake of arithmetic would be
    // losing health to a rounding nobody can see.
    const storages = new StorageRegistry();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    yard.inventory.add('vegetables', 7);
    yard.inventory.add('fruit', 7);
    yard.inventory.add('spices', 7);

    expect(drawMeal(storages, 10)).toBe(10);
    expect(foodStored(storages)).toBe(11);
  });

  it('take what there is in a famine, and no more', () => {
    const storages = new StorageRegistry();
    storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 }).inventory.add('fish', 3);
    expect(drawMeal(storages, 10)).toBe(3);
    expect(foodStored(storages)).toBe(0);
  });
});

describe('what counts as a varied larder', () => {
  it('is a real amount of a kind, not a token of it', () => {
    // Half a day's ration each. Letting one unit count would make the whole
    // rule a matter of remembering to leave one of everything on the shelf.
    const storages = new StorageRegistry();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    yard.inventory.add('vegetables', 100);
    yard.inventory.add('fish', 1);

    expect(foodKinds(storages, 10)).toBe(1);
    yard.inventory.add('fish', 4);
    expect(foodKinds(storages, 10)).toBe(2);
  });

  it('pays nothing for eating at all, and the same for every kind after', () => {
    // One kind is not an achievement. Every kind after the first is worth the
    // same again, so the fifth is as welcome as the second — a curve that paid
    // less for the last one would quietly tell the player to stop at three.
    expect(varietyShare(0)).toBe(0);
    expect(varietyShare(1)).toBe(0);
    expect(varietyShare(FOOD_KINDS)).toBe(1);
    expect(varietyShare(3) - varietyShare(2)).toBeCloseTo(varietyShare(5) - varietyShare(4));
  });
});

describe('what a varied table is worth', () => {
  it('lifts the settlement’s spirit, without a building', () => {
    const simulation = new Simulation(OPTIONS);
    const plain = simulation.solace;

    const yard = simulation.storages.all[0];
    expect(yard).toBeDefined();
    for (const id of FOOD_IDS) {
      yard?.inventory.add(id, 40);
    }
    simulation.storages.markChanged();

    expect(foodKinds(simulation.storages, simulation.villagers.count)).toBe(FOOD_KINDS);
    expect(simulation.solace).toBeCloseTo(plain + DIET_SOLACE_SHARE);
  });

  it('keeps people out of their sickbeds, which is what lengthens a life', () => {
    // The chain that makes variety life expectancy: a day spent ill is already a
    // day off the end of a life, so falling ill less often is living longer —
    // and the population system never learns that food had anything to do with
    // it.
    const housed = { homeId: 4 } as unknown as Villager;
    expect(chanceFor(housed, 1)).toBeCloseTo(chanceFor(housed, 0) * (1 - DIET_HEALTH_SHARE));
    expect(chanceFor(housed, 1)).toBeLessThan(chanceFor(housed, 0));
    // And never enough to eat your way out of homelessness: a roof is worth far
    // more than a table.
    const rough = { homeId: null } as unknown as Villager;
    expect(chanceFor(rough, 1)).toBeGreaterThan(chanceFor(housed, 0));
  });

  it('is collected rather than owed, so a plain settlement plays as it always did', () => {
    // Nothing about a settlement eating one thing is a penalty. It simply has
    // not taken a comfort that was there.
    const simulation = new Simulation(OPTIONS);
    expect(foodKinds(simulation.storages, simulation.villagers.count)).toBe(1);
    expect(simulation.solace).toBe(0);
    expect(chanceFor({ homeId: 1 } as unknown as Villager, varietyShare(1))).toBe(
      chanceFor({ homeId: 1 } as unknown as Villager),
    );
  });
});

describe('the fishing hut', () => {
  it('has to stand on the water', () => {
    // The second building whose place on the map is a real decision.
    expect(buildingDefinition('fishing-hut').adjacentTo).toContain('water');
    expect(buildingDefinition('fishing-hut').adjacentTo).toContain('ditch');
  });

  it('is the one harvest that never stops', () => {
    // A river has no harvest: it is worth about the same every month, best when
    // the meltwater runs, and still worth something through the ice. That makes
    // it the answer to a hungry spring, which nothing else in the game is.
    const fish = recipe('catch-fish');
    expect(fish).not.toBeNull();
    expect(fish?.seasonal).toBe('fish');

    const forage = recipe('forage-food');
    const crop = recipe('grow-crops');
    expect(forage?.seasonal).toBe('forage');
    expect(crop?.seasonal).toBe('crop');
  });

  it('is cheap, because the settlement that needs it is already in trouble', () => {
    const hut = buildingDefinition('fishing-hut');
    const gatherer = buildingDefinition('gatherer-hut');
    const total = (id: typeof hut) =>
      id.constructionCost.reduce((sum, part) => sum + part.amount, 0);
    expect(total(hut)).toBeLessThanOrEqual(total(gatherer));
    expect(hut.constructionCost.every((part) => part.resource === 'logs')).toBe(true);
  });

  it('is in the food group of the build menu, with the rest of the larder', () => {
    expect(BUILDINGS['fishing-hut'].category).toBe('food');
  });
});
