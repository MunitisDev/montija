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
import { LIFESPAN_MAX } from '@/data/population';
import { Building } from '@/simulation/buildings/Building';
import { findAccessCell } from '@/simulation/buildings/BuildingRegistry';
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
      roads: world.roads.all(),
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
      lifespan: villager.lifespan,
      homeId: villager.homeId,
      daysSinceBirthday: villager.daysSinceBirthday,
      birthCooldownDays: villager.birthCooldownDays,
      employerId: villager.employerId,
      workPreference: villager.workPreference,
      partnerId: villager.partnerId,
      sex: villager.sex,
      parentIds: villager.parentIds,
      illDaysRemaining: villager.illDaysRemaining,
      carrying: toRecord(villager.inventory),
      path: villager.path.map((step) => ({ gx: step.gx, gy: step.gy })),
      destination: villager.destination ? { ...villager.destination } : null,
      activity: villager.activity,
      idleTicks: villager.idleTicks,
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
      accepts: storage.acceptedResources,
      preservation: storage.preservation,
      ownerBuildingId: storage.ownerBuildingId,
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
      storageId: building.storageId,
      desiredWorkers: building.desiredWorkers,
    })),

    // Jobs are already plain data — that design choice in Phase 4 is what
    // makes this a copy rather than a conversion.
    jobs: simulation.jobs.all.map((job) => ({ ...job })),
    deaths: simulation.snapshot().deaths,
    random: {
      villagers: simulation.villagers.randomState,
      forest: simulation.forestRandomState,
      illness: simulation.illnessRandomState,
    },
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
  // Roads before the rebuild, not after: the navigation grid reads them while
  // it re-costs every cell, so restoring them second would leave a settlement
  // whose roads were drawn but not routed over until the next one was laid.
  world.roads.restore(save.world.roads ?? []);
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
      ...(saved.accepts ? { accepts: saved.accepts } : {}),
      // Saves written before food could spoil have no figure; 1 is the open
      // yard they were all behaving as.
      preservation: saved.preservation ?? 1,
      ownerBuildingId: saved.ownerBuildingId ?? null,
    });
    fillInventory(storage.inventory, saved.contents);
  }

  world.buildings.clear();
  for (const saved of save.buildings) {
    const building = new Building(saved.id, saved.buildingId, { gx: saved.gx, gy: saved.gy });
    building.buildTicksRemaining = saved.buildTicksRemaining;
    // Saves written before yards were linked to their buildings carry nothing;
    // a finished storage building then simply opens its yard on the next tick.
    building.storageId = saved.storageId ?? null;
    building.desiredWorkers = saved.desiredWorkers ?? building.definition.workerSlots;
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

  // Doorways depend on which cells are blocked, so they can only be worked out
  // once every building in the save has re-blocked its own footprint.
  for (const building of world.buildings.all) {
    building.accessCell = findAccessCell(world, building);
  }

  simulation.villagers.restore(
    save.villagers.map((saved) => {
      const villager = new Villager({
        id: saved.id,
        name: saved.name,
        // A save from before households had families says nothing about sex.
        // Deriving it from the id keeps a reloaded settlement roughly even
        // rather than turning it into one of anything, and it is stable: the
        // same villager reads the same way on every load.
        sex: saved.sex ?? (saved.id % 2 === 0 ? 'f' : 'm'),
        age: saved.age,
        position: { wx: saved.wx, wy: saved.wy },
        // A save from before villagers aged has no lifespan. Giving them the
        // longest one means nobody dies of old age the instant an old save is
        // loaded, which would be a very strange way to greet the player.
        lifespan: saved.lifespan ?? LIFESPAN_MAX,
      });
      villager.homeId = saved.homeId ?? null;
      villager.daysSinceBirthday = saved.daysSinceBirthday ?? 0;
      villager.birthCooldownDays = saved.birthCooldownDays ?? 0;
      villager.employerId = saved.employerId ?? null;
      villager.workPreference = saved.workPreference ?? null;
      villager.partnerId = saved.partnerId ?? null;
      villager.parentIds = saved.parentIds ?? null;
      villager.illDaysRemaining = saved.illDaysRemaining ?? 0;
      villager.needs.hunger = saved.hunger;
      villager.needs.warmth = saved.warmth;
      villager.needs.health = saved.health;
      villager.currentJobId = saved.currentJobId;
      villager.path = saved.path.map((step) => ({ gx: step.gx, gy: step.gy }));
      villager.destination = saved.destination ? { ...saved.destination } : null;
      villager.activity = saved.activity as typeof villager.activity;
      villager.idleTicks = saved.idleTicks;
      // previousPosition matters for render interpolation; a loaded villager
      // should not appear to lurch from wherever they last were.
      villager.previousPosition = villager.position;
      fillInventory(villager.inventory, saved.carrying);
      return villager;
    }),
  );

  simulation.jobs.restore(save.jobs);
  if (save.random?.villagers) {
    simulation.villagers.restoreRandomState(save.random.villagers);
    // Absent in saves written before the woods grew back; leaving the stream at
    // its seed is the right reading, since nothing had drawn from it yet.
    if (save.random.forest) {
      simulation.restoreForestRandom(save.random.forest);
    }
    if (save.random.illness) {
      simulation.restoreIllnessRandom(save.random.illness);
    }
  }
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
