/**
 * Turning a running settlement into a save, and back.
 *
 * Both directions live in one file so the two halves are read together — a
 * field added to one and forgotten in the other is the classic save bug, and
 * the round-trip test in `tests/save.test.ts` exists to catch exactly that.
 */

import type { ResourceId } from '@/data/resources';
import type { Simulation } from '@/simulation/Simulation';
import type { Inventory } from '@/simulation/resources/Inventory';
import { Building } from '@/simulation/buildings/Building';
import { Villager } from '@/simulation/villagers/Villager';
import type { SavedInventory, SaveGame } from './SaveGame';
import { SAVE_VERSION } from './SaveGame';

export function serialise(simulation: Simulation, savedAt: string): SaveGame {
  const world = simulation.world;

  return {
    version: SAVE_VERSION,
    savedAt,
    worldSeed: simulation.worldSeed,
    simulationTime: simulation.tick,

    world: {
      width: world.width,
      height: world.height,
      terrain: Array.from(world.terrain.toBuffer()),
      trees: [...world.trees.all].map((tree) => ({
        id: tree.id,
        gx: tree.gx,
        gy: tree.gy,
        variant: tree.variant,
        scale: tree.scale,
      })),
    },

    villagers: simulation.villagers.all.map((villager) => ({
      id: villager.id,
      name: villager.name,
      age: villager.age,
      wx: villager.position.wx,
      wy: villager.position.wy,
      hunger: villager.needs.hunger,
      warmth: villager.needs.warmth,
      health: villager.needs.health,
      currentJobId: villager.currentJobId,
      carrying: toRecord(villager.inventory),
    })),

    piles: [...world.piles.all].map((pile) => ({
      gx: pile.cell.gx,
      gy: pile.cell.gy,
      resource: pile.resource,
      amount: pile.amount,
    })),

    storages: simulation.storages.all.map((storage) => ({
      gx: storage.cell.gx,
      gy: storage.cell.gy,
      capacity: storage.inventory.capacity,
      accepts: null,
      contents: toRecord(storage.inventory),
    })),

    buildings: [...world.buildings.all].map((building) => ({
      id: building.id,
      buildingId: building.definition.id,
      gx: building.origin.gx,
      gy: building.origin.gy,
      complete: building.isComplete,
      buildTicksRemaining: building.buildTicksRemaining,
      materials: toRecord(building.materials),
      input: toRecord(building.input),
    })),

    // Jobs are already plain data — that design choice in Phase 4 is what
    // makes this a copy rather than a conversion.
    jobs: simulation.jobs.all.map((job) => ({ ...job })),
    deaths: simulation.snapshot().deaths,
  };
}

/**
 * Rebuilds a simulation from a save.
 *
 * The world is regenerated from the seed for the parts that never change —
 * nothing — and then overwritten from the save for everything that does. In
 * practice that means the terrain buffer, the trees and every entity are
 * restored verbatim, because villagers reshape all of them.
 */
export function restore(simulation: Simulation, save: SaveGame): void {
  const world = simulation.world;

  // Terrain is restored rather than regenerated: villagers reshape it, and
  // re-running the generator would undo every clearing they ever made.
  world.terrain.loadBuffer(Uint8Array.from(save.world.terrain));
  world.navigation.rebuild(world.terrain);
  world.trees.restore(save.world.trees);

  world.piles.clear();
  for (const pile of save.piles) {
    world.piles.drop({ gx: pile.gx, gy: pile.gy }, pile.resource, pile.amount);
  }

  simulation.storages.clear();
  for (const saved of save.storages) {
    const storage = simulation.storages.add({
      cell: { gx: saved.gx, gy: saved.gy },
      capacity: saved.capacity,
    });
    fillInventory(storage.inventory, saved.contents);
  }

  world.buildings.clear();
  for (const saved of save.buildings) {
    const building = new Building(saved.id, saved.buildingId, { gx: saved.gx, gy: saved.gy });
    building.buildTicksRemaining = saved.buildTicksRemaining;
    fillInventory(building.materials, saved.materials);
    fillInventory(building.input, saved.input);
    if (saved.complete) {
      building.state = 'complete';
      // Finished buildings block their footprint; the navigation rebuild above
      // cleared that, so it has to be re-applied.
      for (const cell of building.cells()) {
        world.navigation.block(cell.gx, cell.gy);
      }
    }
    world.buildings.restoreOne(building);
  }

  simulation.villagers.restore(
    save.villagers.map((saved) => {
      const villager = new Villager({
        id: saved.id,
        name: saved.name,
        age: saved.age,
        position: { wx: saved.wx, wy: saved.wy },
      });
      villager.needs.hunger = saved.hunger;
      villager.needs.warmth = saved.warmth;
      villager.needs.health = saved.health;
      villager.currentJobId = saved.currentJobId;
      fillInventory(villager.inventory, saved.carrying);
      return villager;
    }),
  );

  simulation.jobs.restore(save.jobs);
  simulation.restoreClock(save.simulationTime, save.deaths);
}

function toRecord(inventory: Inventory): SavedInventory {
  const record: Record<string, number> = {};
  for (const { resource, amount } of inventory.contents) {
    record[resource] = amount;
  }
  return record;
}

/** Fills an inventory from a saved record. */
export function fillInventory(inventory: Inventory, saved: SavedInventory): void {
  inventory.clear();
  for (const [resource, amount] of Object.entries(saved)) {
    inventory.add(resource as ResourceId, amount);
  }
}
