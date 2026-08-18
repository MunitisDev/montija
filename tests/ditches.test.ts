/**
 * Leading the water, and the orchard that needs it.
 *
 * An orchard used to be a building like any other: put it anywhere there is
 * room, wait four hundred ticks, collect the best harvest in the game. Nothing
 * about *where* mattered, which for the one building whose whole subject is
 * growing things was the wrong shape.
 *
 * Two rules replace it, and this file is about how they meet:
 *
 * - an orchard has to stand on water — the river, or a channel dug from it;
 * - and it is worth twice as much beside a larder, because fruit does not wait.
 *
 * The ditch is what turns the first rule from a restriction into a decision: the
 * player leads the river to the orchard rather than putting the orchard wherever
 * the river happens to run.
 */

import { describe, expect, it } from 'vitest';

import { buildingDefinition, type BuildingId } from '@/data/buildings';
import { WET_TERRAIN } from '@/data/terrain';
import type { GridPoint } from '@/shared/types/geometry';
import { Simulation } from '@/simulation/Simulation';
import { siteYield } from '@/simulation/production/siteYield';
import { restore, serialise } from '@/simulation/save/serialise';
import { productionSummary } from '@/ui/hud/productionModel';

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('digging a channel', () => {
  it('can only be cut from water that is already there', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);

    // The cell alongside the water can be dug; three cells inland cannot.
    expect(simulation.world.canDig({ gx: origin.gx + 1, gy: origin.gy })).toBe(true);
    expect(simulation.world.canDig({ gx: origin.gx + 3, gy: origin.gy })).toBe(false);
  });

  it('extends from a channel already dug, one cell at a time', () => {
    // The whole point of a ditch: a line the player draws inland, not a tile
    // stamped anywhere near water.
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const first = { gx: origin.gx + 1, gy: origin.gy };
    const second = { gx: origin.gx + 2, gy: origin.gy };

    expect(simulation.world.canDig(second)).toBe(false);
    expect(simulation.world.digDitch(first)).toBe(true);
    expect(simulation.world.canDig(second)).toBe(true);
  });

  it('will not be cut through a road, a wood or rock', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const bank = { gx: origin.gx + 1, gy: origin.gy };

    simulation.world.paveRoad(bank);
    expect(simulation.world.canDig(bank)).toBe(false);
    simulation.world.liftRoad(bank);
    expect(simulation.world.canDig(bank)).toBe(true);

    simulation.world.terrain.set(bank.gx, bank.gy, 'stone');
    expect(simulation.world.canDig(bank)).toBe(false);
    simulation.world.terrain.set(bank.gx, bank.gy, 'forest');
    expect(simulation.world.canDig(bank)).toBe(false);
  });

  it('is water once it is dug: nobody wades it and nothing is built in it', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const bank = { gx: origin.gx + 1, gy: origin.gy };
    expect(simulation.world.isWalkable(bank)).toBe(true);

    simulation.world.digDitch(bank);

    expect(simulation.world.terrainAt(bank)).toBe('ditch');
    expect(simulation.world.isWalkable(bank)).toBe(false);
    expect(simulation.world.isBuildable(bank)).toBe(false);
  });

  it('can be filled in again, giving the ground back', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const bank = { gx: origin.gx + 1, gy: origin.gy };
    simulation.world.digDitch(bank);

    expect(simulation.fillDitch(bank)).toBe(true);
    expect(simulation.world.isWalkable(bank)).toBe(true);
    expect(simulation.fillDitch(bank)).toBe(false);
  });

  it('is dug by a villager when the player orders it', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const bank = { gx: origin.gx + 1, gy: origin.gy };

    expect(simulation.designateDitch(bank)).toBe(true);
    expect(simulation.isDitchDesignated(bank)).toBe(true);

    for (let tick = 1; tick <= 4000 && !simulation.hasDitch(bank); tick += 1) {
      simulation.update(tick, 0.1);
    }

    expect(simulation.hasDitch(bank)).toBe(true);
  });

  it('cancels an order that has not been dug yet', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const bank = { gx: origin.gx + 1, gy: origin.gy };
    simulation.designateDitch(bank);

    expect(simulation.cancelDitchDesignation(bank)).toBe(true);
    expect(simulation.isDitchDesignated(bank)).toBe(false);
    expect(simulation.hasDitch(bank)).toBe(false);
  });

  it('survives a save and a load, being terrain', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const bank = { gx: origin.gx + 1, gy: origin.gy };
    simulation.world.digDitch(bank);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.world.terrainAt(bank)).toBe('ditch');
    expect(loaded.world.isWalkable(bank)).toBe(false);
  });
});

describe('an orchard and its water', () => {
  it('must stand beside the river or a ditch', () => {
    const definition = buildingDefinition('orchard');
    expect(definition.adjacentTo).toEqual(WET_TERRAIN);
  });

  it('is refused on dry ground, and says why', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    // Well clear of the one water cell in the corner: nine cells of grass with
    // nothing to drink.
    const check = simulation.canPlaceBuilding('orchard', {
      gx: origin.gx + 4,
      gy: origin.gy + 4,
    });
    expect(check.ok).toBe(false);
    expect(check.ok ? null : check.reason).toBe('needs-water-nearby');
  });

  it('is allowed once the water has been led to it', () => {
    // The payoff, end to end: a plot that refused an orchard takes one after the
    // settlement digs a channel out to it.
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const plot = { gx: origin.gx + 4, gy: origin.gy + 4 };

    expect(simulation.canPlaceBuilding('orchard', plot).ok).toBe(false);

    // A channel from the corner along the top of the patch, ending against the
    // plot's own edge.
    for (let step = 1; step <= 4; step += 1) {
      expect(simulation.world.digDitch({ gx: origin.gx + step, gy: origin.gy })).toBe(true);
    }
    for (let step = 1; step <= 3; step += 1) {
      expect(simulation.world.digDitch({ gx: origin.gx + 4, gy: origin.gy + step })).toBe(true);
    }

    expect(simulation.canPlaceBuilding('orchard', plot).ok).toBe(true);
  });
});

describe('an orchard and its larder', () => {
  it('is worth twice as much with one within reach', () => {
    const nearby = buildingDefinition('orchard').nearby;
    expect(nearby?.building).toBe('food-storage');
    expect(nearby?.yieldMultiplier).toBe(2);
  });

  it('counts only a finished larder, and only a near one', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation, 24);
    const orchard = raise(simulation, 'orchard', { gx: origin.gx + 1, gy: origin.gy + 1 });
    expect(siteYield(simulation.world.buildings, orchard)).toBe(1);

    const radius = buildingDefinition('orchard').nearby!.radius;
    // Far off: a larder across the settlement is no use to fruit picked here.
    raise(simulation, 'food-storage', {
      gx: orchard.origin.gx + radius + 4,
      gy: orchard.origin.gy,
    });
    expect(siteYield(simulation.world.buildings, orchard)).toBe(1);

    const near = simulation.placeBuilding('food-storage', {
      gx: orchard.origin.gx,
      gy: orchard.origin.gy + 5,
    });
    expect(near).not.toBeNull();
    // Still a building site: an unfinished larder keeps nothing cool.
    expect(siteYield(simulation.world.buildings, orchard)).toBe(1);

    simulation.world.buildings.complete(simulation.world, near!);
    expect(siteYield(simulation.world.buildings, orchard)).toBe(2);
  });

  it('says so in the panel rather than quoting the lone figure', () => {
    const alone = productionSummary('orchard');
    const beside = productionSummary('orchard', 2);

    expect(alone.outputs[0]?.perDay).toBeGreaterThan(0);
    expect(beside.outputs[0]!.perDay).toBeGreaterThan(alone.outputs[0]!.perDay);
  });

  it('gives nothing extra to a building with no such rule', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const hut = raise(simulation, 'gatherer-hut', { gx: origin.gx + 2, gy: origin.gy + 2 });
    raise(simulation, 'food-storage', { gx: origin.gx + 5, gy: origin.gy + 2 });
    expect(siteYield(simulation.world.buildings, hut)).toBe(1);
  });
});

/**
 * A patch of clear ground beside the settlement, with one cell of water in it.
 *
 * **Made rather than found.** These are tests of the rules — what can be dug,
 * what an orchard needs — and hunting the generated map for a bank that happens
 * to have nine clear cells beside it tests the map instead. The river's own
 * tests live in `river.test.ts`; here the ground is arranged on purpose so that
 * a failure means the rule is wrong.
 *
 * @returns the origin of the cleared patch, with water at its top-left corner
 */
function clearing(simulation: Simulation, span = 10): GridPoint {
  const world = simulation.world;
  const heart = world.heartCell;
  const origin = { gx: heart.gx + 3, gy: heart.gy + 3 };

  for (let dy = 0; dy < span; dy += 1) {
    for (let dx = 0; dx < span; dx += 1) {
      const cell = { gx: origin.gx + dx, gy: origin.gy + dy };
      const tree = world.trees.getAt(cell);
      if (tree) {
        world.trees.remove(tree.id);
      }
      const pile = world.piles.anyAt(cell);
      if (pile) {
        world.piles.remove(pile.id);
      }
      world.terrain.set(cell.gx, cell.gy, 'grass');
    }
  }
  world.terrain.set(origin.gx, origin.gy, 'water');
  world.navigation.rebuild(world.terrain);
  return origin;
}

/** Puts a finished building on a cell, refusing to pretend if it will not go. */
function raise(simulation: Simulation, id: BuildingId, cell: GridPoint) {
  const check = simulation.canPlaceBuilding(id, cell);
  if (!check.ok) {
    throw new Error(`A ${id} was refused at ${cell.gx},${cell.gy}: ${check.reason}`);
  }
  const building = simulation.placeBuilding(id, cell);
  if (!building) {
    throw new Error(`A ${id} was refused at ${cell.gx},${cell.gy}`);
  }
  simulation.world.buildings.complete(simulation.world, building);
  return building;
}
