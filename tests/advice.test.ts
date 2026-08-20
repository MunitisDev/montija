/**
 * The one line of advice the settlement is allowed to give, and when it is
 * allowed to give it.
 *
 * **Advice that cries wolf is advice a player stops reading**, and the food
 * warnings had been doing exactly that. They counted *buildings*: "is there a
 * Gatherer Hut, and is there one for every six people". So a settlement eating
 * comfortably off a field, an orchard and a fishing hut was told that nobody was
 * gathering food, and a settlement with three hundred in the larder was told to
 * build another hut. Both complaints came from a real game, and both were fair —
 * the player could see the food on the screen while the banner said otherwise.
 *
 * What this file holds to account is the rule that replaced it: the *stores*
 * decide, not the buildings. The only thing still counted is whether anything at
 * all brings food in, which is a different question and the first one a
 * settlement has to answer.
 */

import { describe, expect, it } from 'vitest';

import { FOOD_DAYS_LOW, Simulation } from '@/simulation/Simulation';
import { DAYS_PER_SEASON, TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';

const OPTIONS = { seed: 20260822, worldWidth: 80, worldHeight: 80, startingVillagers: 10 };

describe('what the settlement says about food', () => {
  it('says nothing at all when the larder is deep', () => {
    // The complaint that started this: food everywhere, and a banner asking for
    // another hut. Any food building will do — this one is a field.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'crop-field');
    stockFood(simulation, 600);
    runADay(simulation);

    expect(simulation.snapshot().advice).not.toBe('foodFalling');
    expect(simulation.snapshot().advice).not.toBe('foodLow');
  });

  it('counts a field, an orchard or a boat as bringing food in', () => {
    // Four of the five food buildings are not Gatherer Huts, and the settlement
    // that lives off them was being told nobody was gathering.
    for (const id of ['crop-field', 'orchard', 'fishing-hut', 'hunter'] as const) {
      const simulation = new Simulation(OPTIONS);
      const built = raise(simulation, id);
      expect(built, id).not.toBeNull();
      stockFood(simulation, 600);
      runADay(simulation);
      expect(simulation.snapshot().advice, id).not.toBe('foodLow');
    }
  });

  it('asks for somewhere to get food when nothing does', () => {
    // Still said on the first morning, with a hold full of roots: it is the one
    // thing a new settlement has to do, and having food today is not having a
    // food supply.
    const simulation = new Simulation(OPTIONS);
    expect(simulation.snapshot().stored.vegetables).toBeGreaterThan(0);
    expect(simulation.snapshot().advice).toBe('foodLow');
  });

  it('says the food is running out when it is running out', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'crop-field');
    // Under a fortnight for ten people, and nothing coming in to lift it.
    stockFood(simulation, FOOD_DAYS_LOW * 10 - 20);
    runADay(simulation);

    expect(simulation.snapshot().advice).toBe('foodFalling');
  });

  it('holds its tongue while a thin larder is filling', () => {
    // A low store that is *rising* is a harvest coming in, not a famine. This is
    // the whole reason the rule reads the trend rather than the amount.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'crop-field');
    stockFood(simulation, 20);
    runADay(simulation);
    expect(simulation.snapshot().advice).toBe('foodFalling');

    stockFood(simulation, 40);
    expect(simulation.snapshot().advice).not.toBe('foodFalling');
  });
});

describe('what it says about firewood', () => {
  it('says nothing in autumn when the woodpile is deep', () => {
    // The same defect as the food advice: it warned about having no Woodcutter
    // whatever was in the store, so a settlement that had salvaged or bought a
    // winter's firewood was nagged all autumn about a building it did not need.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'crop-field');
    toAutumn(simulation);
    stockFood(simulation, 600);
    stock(simulation, 'firewood', DAYS_PER_SEASON * 40);
    runADay(simulation);

    expect(simulation.world.buildings.countOf('woodcutter')).toBe(0);
    expect(simulation.snapshot().advice).not.toBe('firewoodLow');
    expect(simulation.snapshot().advice).not.toBe('firewoodShort');
  });

  it('asks for a woodcutter in autumn when the woodpile is not', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'crop-field');
    // Roofs first: sleeping rough in autumn is a worse problem than a thin
    // woodpile and the settlement rightly says so instead, which would leave
    // this test measuring the shelter advice.
    for (let index = 0; index < 4; index += 1) {
      raise(simulation, 'house');
    }
    // And a larder, or the settlement complains about its food rotting in the
    // open — also true, also higher up the list, and also not what this is about.
    raise(simulation, 'food-storage');
    toAutumn(simulation);
    stockFood(simulation, 600);
    runADay(simulation);

    expect(simulation.snapshot().advice).toBe('firewoodLow');
  });
});

// --- helpers ---------------------------------------------------------------

function runADay(simulation: Simulation): void {
  for (let tick = 0; tick < TICKS_PER_DAY; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

/** Runs to autumn, fed by hand so nobody starves on the way. */
function toAutumn(simulation: Simulation): void {
  const limit = TICKS_PER_DAY * 48;
  for (let tick = 0; tick < limit && simulation.year.season !== 'autumn'; tick += 1) {
    if (simulation.tick % TICKS_PER_DAY === 0) {
      stockFood(simulation, 200);
    }
    simulation.update(simulation.tick + 1, 0.1);
  }
}

/** Tops the larder up to a level, rather than piling food in without limit. */
function stockFood(simulation: Simulation, to: number): void {
  const yard = simulation.storages.all[0];
  if (!yard) {
    return;
  }
  const short = to - yard.inventory.count('vegetables');
  if (short > 0) {
    yard.inventory.add('vegetables', short);
  } else {
    yard.inventory.remove('vegetables', -short);
  }
  simulation.storages.markChanged();
}

function stock(simulation: Simulation, resource: 'firewood' | 'logs', amount: number): void {
  simulation.storages.all[0]?.inventory.add(resource, amount);
  simulation.storages.markChanged();
}

/** Puts a finished building up wherever the ground will take it. */
function raise(simulation: Simulation, id: BuildingId): Building | null {
  const from = simulation.world.landfallCell;
  for (let radius = 2; radius < 30; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const origin = { gx: from.gx + dx, gy: from.gy + dy };
        const building = simulation.world.buildings.place(simulation.world, id, origin);
        if (building) {
          simulation.world.buildings.complete(simulation.world, building);
          return building;
        }
      }
    }
  }
  return null;
}
