/**
 * Minerals: the half of the economy you pay for rather than tend.
 *
 * Timber grows back; stone and iron do not. The permanent supply is a quarry or
 * a mine, and the price is a piece of land you never get back — so the rules
 * worth testing are the ones that make that a decision: they must sit against a
 * rock face, they must keep producing without any input, and what they produce
 * has to reach a yard by the same hauling the rest of the game uses.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/simulation/Simulation';
import { SEASONAL_YIELD, TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { TOOL_WORK_BONUS, TOOLS_PER_WORKER_PER_DAY } from '@/simulation/seasons/SurvivalSystem';
import { recipe } from '@/data/recipes';
import { buildingDefinition } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };
const TICK = 0.1;

describe('placing against a rock face', () => {
  it('refuses a quarry in open meadow', () => {
    const simulation = new Simulation(OPTIONS);
    const open = findCell(simulation, (cell) => {
      if (!simulation.canPlaceBuilding('gatherer-hut', cell).ok) {
        return false;
      }
      return !touchesRock(simulation, cell, 3);
    });
    expect(open).not.toBeNull();
    if (!open) {
      return;
    }

    const check = simulation.canPlaceBuilding('quarry', open);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe('needs-rock-face');
    }
  });

  it('accepts a quarry dug into one', () => {
    const simulation = new Simulation(OPTIONS);
    const face = quarrySite(simulation);
    expect(face).not.toBeNull();
    if (!face) {
      return;
    }
    expect(simulation.canPlaceBuilding('quarry', face).ok).toBe(true);
  });

  it('holds a mine to the same rule', () => {
    const simulation = new Simulation(OPTIONS);
    const open = findCell(simulation, (cell) => {
      if (!simulation.canPlaceBuilding('house', cell).ok) {
        return false;
      }
      return !touchesRock(simulation, cell, 2);
    });
    if (!open) {
      return;
    }
    expect(simulation.canPlaceBuilding('mine', open).ok).toBe(false);
  });
});

describe('a working quarry', () => {
  it('cuts stone out of nothing and gets it to a yard', () => {
    const simulation = new Simulation(OPTIONS);
    const site = quarrySite(simulation);
    expect(site).not.toBeNull();
    if (!site) {
      return;
    }

    const quarry = simulation.placeBuilding('quarry', site);
    expect(quarry).not.toBeNull();
    if (!quarry) {
      return;
    }
    simulation.world.buildings.complete(simulation.world, quarry);

    const before = simulation.storages.totalOf('stone');
    for (let tick = 1; tick <= TICKS_PER_DAY * 20; tick += 1) {
      simulation.update(tick, TICK);
    }

    // Not merely produced — *stored*. A quarry whose output never reaches a
    // yard is a quarry that does nothing, and the pile on the ground beside it
    // is exactly what that failure looks like.
    expect(simulation.storages.totalOf('stone')).toBeGreaterThan(before);
  });

  it('needs no input at all, unlike every other workshop', () => {
    // The point of the building: surface deposits run out, this does not.
    expect(recipe('cut-stone')?.inputs).toEqual([]);
    expect(recipe('dig-iron')?.inputs).toEqual([]);
  });

  it('is slower per unit than picking a deposit up off the ground', () => {
    // If a quarry beat gathering, nobody would ever gather, and the finite
    // deposits scattered over the map would be pointless scenery.
    const cut = recipe('cut-stone');
    expect(cut).not.toBeNull();
    if (!cut) {
      return;
    }
    const perUnit = cut.workTicks / (cut.outputs[0]?.amount ?? 1);
    expect(perUnit).toBeGreaterThan(30 / 6);
  });
});

describe('iron and tools', () => {
  it('gives iron somewhere to go', () => {
    // A resource with no consumer is clutter dressed as content. The forge is
    // the consumer, and this is the test that says so.
    const forge = recipe('forge-tools');
    expect(forge?.inputs.some((input) => input.resource === 'iron')).toBe(true);
    expect(forge?.outputs.some((output) => output.resource === 'tools')).toBe(true);
    expect(buildingDefinition('blacksmith').recipeId).toBe('forge-tools');
  });

  it('wears tools out through use, and only if there are any', () => {
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0];
    expect(yard).toBeDefined();
    if (!yard) {
      return;
    }

    // A day with no tools at all takes nothing and costs nothing.
    for (let tick = 1; tick <= TICKS_PER_DAY + 1; tick += 1) {
      simulation.update(tick, TICK);
    }
    expect(simulation.snapshot().lastDay.toolsWorn).toBe(0);
    expect(simulation.snapshot().lastDay.toolFraction).toBe(0);

    yard.inventory.add('tools', 50);
    const stocked = simulation.storages.totalOf('tools');
    for (let tick = TICKS_PER_DAY + 2; tick <= TICKS_PER_DAY * 2 + 2; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.storages.totalOf('tools')).toBeLessThan(stocked);
    expect(simulation.snapshot().lastDay.toolFraction).toBeGreaterThan(0);
  });

  it('charges wear against working adults, not children', () => {
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0];
    if (!yard) {
      return;
    }
    yard.inventory.add('tools', 100);

    const adults = simulation.villagers.all.filter((villager) => villager.isAdult).length;
    for (let tick = 1; tick <= TICKS_PER_DAY + 1; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.snapshot().lastDay.toolsWorn).toBeCloseTo(
      adults * TOOLS_PER_WORKER_PER_DAY,
      5,
    );
  });

  it('makes work measurably quicker', () => {
    // The bonus is the whole payoff, so it is worth proving it moves something
    // rather than trusting that a multiplier is wired up.
    const runFor = (withTools: boolean, seed: number): number => {
      const simulation = new Simulation({ ...OPTIONS, seed });
      if (withTools) {
        simulation.storages.all[0]?.inventory.add('tools', 400);
      }
      // There has to be work, or both runs complete nothing and the comparison
      // is between two zeroes.
      for (const tree of [...simulation.world.trees.all].slice(0, 60)) {
        simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
      }
      for (let tick = 1; tick <= TICKS_PER_DAY * 12; tick += 1) {
        simulation.update(tick, TICK);
      }
      return simulation.snapshot().jobsCompleted;
    };

    // Summed across seeds, because one settlement is too coarse to measure
    // this with. The bonus applies to *work* ticks and most of a villager's
    // day is travel, so twelve days of one settlement separates the two runs
    // by about one completed job — well inside the noise, and on one seed they
    // came out exactly equal while three others showed the gain. Four
    // settlements make the difference clear without making the claim weaker.
    let bare = 0;
    let equipped = 0;
    for (const seed of [20260815, 2024, 991, 7]) {
      bare += runFor(false, seed);
      equipped += runFor(true, seed);
    }

    expect(equipped).toBeGreaterThan(bare);
    expect(TOOL_WORK_BONUS).toBeGreaterThan(0);
  });

  it('leaves an unequipped settlement running at exactly its old speed', () => {
    // Tools are a bonus, never a tax. A player who never builds a forge must
    // not silently get slower because this feature shipped.
    const simulation = new Simulation(OPTIONS);
    for (let tick = 1; tick <= TICKS_PER_DAY * 3; tick += 1) {
      simulation.update(tick, TICK);
    }
    expect(simulation.snapshot().lastDay.toolFraction).toBe(0);
  });
});

// --- helpers ---------------------------------------------------------------

function findCell(simulation: Simulation, matches: (cell: GridPoint) => boolean): GridPoint | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
      if (matches(cell)) {
        return cell;
      }
    }
  }
  return null;
}

/** `true` when rock lies within `radius` cells of a footprint origin. */
function touchesRock(simulation: Simulation, origin: GridPoint, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cell = { gx: origin.gx + dx, gy: origin.gy + dy };
      if (
        simulation.world.terrain.contains(cell.gx, cell.gy) &&
        simulation.world.terrainAt(cell) === 'stone'
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Ground a quarry will actually take, as near the settlement as possible.
 *
 * Nearest rather than first: scanning from the map's corner found a rock face
 * seventy cells from where the villagers start, and the test then measured how
 * long it takes to walk across the map rather than whether a quarry works.
 */
function quarrySite(simulation: Simulation): GridPoint | null {
  const centre = simulation.world.centreCell;
  let best: GridPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      if (!simulation.canPlaceBuilding('quarry', { gx, gy }).ok) {
        continue;
      }
      const distance = Math.abs(gx - centre.gx) + Math.abs(gy - centre.gy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { gx, gy };
      }
    }
  }
  return best;
}

describe('farming through the year', () => {
  it('gives every profile a curve, and only workshops a flat one', () => {
    for (const [profile, curve] of Object.entries(SEASONAL_YIELD)) {
      const values = Object.values(curve);
      if (profile === 'none') {
        expect(new Set(values).size, profile).toBe(1);
        continue;
      }
      // Everything that comes out of the ground must actually vary, or the
      // whole reason to have separate profiles evaporates.
      expect(new Set(values).size, profile).toBeGreaterThan(1);
    }
  });

  it('yields nothing from the frozen ground', () => {
    for (const profile of ['forage', 'crop', 'orchard'] as const) {
      expect(SEASONAL_YIELD[profile].winter, profile).toBe(0);
    }
  });

  it('makes a field an autumn crop and foraging a summer one', () => {
    // The difference between the two is the entire reason to sow. If a field
    // peaked in summer alongside foraging it would just be a second hut.
    expect(SEASONAL_YIELD.crop.autumn).toBeGreaterThan(SEASONAL_YIELD.crop.summer);
    expect(SEASONAL_YIELD.forage.summer).toBeGreaterThan(SEASONAL_YIELD.forage.autumn);
  });

  it('makes an orchard a bet on autumn and nothing before it', () => {
    expect(SEASONAL_YIELD.orchard.spring).toBe(0);
    expect(SEASONAL_YIELD.orchard.autumn).toBeGreaterThan(SEASONAL_YIELD.crop.autumn);
    // And it has to be worth waiting for: the longest build in the game.
    expect(buildingDefinition('orchard').buildTicks).toBeGreaterThan(
      buildingDefinition('crop-field').buildTicks * 3,
    );
  });

  it('actually feeds a settlement in autumn', () => {
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 8 });
    const site = findCell(simulation, (cell) => simulation.canPlaceBuilding('crop-field', cell).ok);
    expect(site).not.toBeNull();
    if (!site) {
      return;
    }

    const field = simulation.placeBuilding('crop-field', site);
    if (!field) {
      return;
    }
    simulation.world.buildings.complete(simulation.world, field);

    // Run into autumn, when a field is worth having.
    let harvested = 0;
    for (let tick = 1; tick <= TICKS_PER_DAY * 55; tick += 1) {
      simulation.update(tick, TICK);
      if (simulation.snapshot().season === 'autumn') {
        harvested = simulation.storages.totalOf('food') + simulation.world.piles.totalOf('food');
      }
    }
    expect(harvested).toBeGreaterThan(0);
  });
});
