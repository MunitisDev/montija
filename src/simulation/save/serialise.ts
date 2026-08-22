/**
 * Turning a running settlement into a save, and back.
 *
 * Both directions live in one file so the two halves are read together — a
 * field added to one and forgotten in the other is the classic save bug, and
 * the round-trip test in `tests/save.test.ts` exists to catch exactly that.
 */

import { BUILDINGS, type BuildingId } from '@/data/buildings';
import { MATURE_DAYS } from '@/simulation/world/TreeGrowth';
import type { ResourceId } from '@/data/resources';
import type { Simulation } from '@/simulation/Simulation';
import type { Inventory } from '@/simulation/resources/Inventory';
import { LIFESPAN_MAX } from '@/data/population';
import { Building } from '@/simulation/buildings/Building';
import { findAccessCell } from '@/simulation/buildings/BuildingRegistry';
import { newChronicle } from '@/simulation/history/Chronicle';
import type { DeathRecord } from '@/simulation/history/Necrology';
import { SPIRIT_NEUTRAL } from '@/simulation/seasons/SurvivalSystem';
import { Villager } from '@/simulation/villagers/Villager';
import type { SavedInventory, SaveGame } from './SaveGame';
import { SAVE_VERSION } from './SaveGame';

export function serialise(
  simulation: Simulation,
  savedAt: string,
  /**
   * What the player called this settlement.
   *
   * Passed in rather than read off the simulation because it is not a fact about
   * the settlement's machinery — it is which *file* this is, and the file is the
   * game's business. See `save/settlementName.ts`.
   */
  settlementName?: string,
): SaveGame {
  const world = simulation.world;

  return {
    version: SAVE_VERSION,
    savedAt,
    ...(settlementName === undefined ? {} : { settlementName }),
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
        planted: tree.planted,
      })),
      roads: world.roads.all(),
      fences: world.fences.survey(),
      landfall: { ...world.landfallCell },
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
      spirit: villager.needs.spirit,
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
      illDaysLived: villager.illDaysLived,
      experience: [...villager.experience],
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
      days: pile.days,
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
      burning: building.burning,
      improved: building.improved,
      upgrading: building.upgrading,
    })),

    // Jobs are already plain data — that design choice in Phase 4 is what
    // makes this a copy rather than a conversion.
    jobs: simulation.jobs.all.map((job) => ({ ...job })),
    deaths: simulation.snapshot().deaths,
    wear: simulation.wearDebt.map(([resource, owed]) => [resource, owed] as const),
    stockLimits: simulation.stockLimits.all.map(([resource, limit]) => [resource, limit] as const),
    chronicle: { ...simulation.snapshot().chronicle },
    necrology: simulation.necrology.all.map((record) => ({ ...record })),
    woodland: simulation.woodland.state(),
    // The pack, if one is on the map. A settlement saved mid-raid loads back
    // mid-raid: the wolves are where they were, as hurt as they were, and the
    // alarm is still up — anything else would be a free escape from a bad night.
    wolves: simulation.wolves.state(),
    random: {
      villagers: simulation.villagers.randomState,
      forest: simulation.forestRandomState,
      illness: simulation.illnessRandomState,
      wolves: simulation.wolfRandomState,
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

  // The settlement's own seed, before anything asks the world what kind of year
  // it is having. See `Simulation.restoreSeed`.
  simulation.restoreSeed(save.worldSeed);

  // Terrain is restored rather than regenerated: villagers reshape it, and
  // re-running the generator would undo every clearing they ever made.
  world.terrain.loadBuffer(Uint8Array.from(save.world.terrain));
  // **Before anything asks where the settlement is.** The camp is remembered
  // rather than recomputed, and the one it is remembering belongs to the map this
  // load just replaced — see `World.restoreLandfall`.
  world.restoreLandfall(save.world.landfall ? { ...save.world.landfall } : null);
  // Roads before the rebuild, not after: the navigation grid reads them while
  // it re-costs every cell, so restoring them second would leave a settlement
  // whose roads were drawn but not routed over until the next one was laid.
  world.roads.restore(save.world.roads ?? []);
  // The wall, restored the same way and for the same reason: a list, because a
  // settlement has tens of cells of it rather than thousands. Each carries what
  // kind it is and how chewed it was — a save written before there was more than
  // one kind restores as a palisade, which is what those settlements had.
  world.fences.restoreWall(save.world.fences ?? []);
  world.navigation.rebuild(world.terrain);
  // Trees written before growth existed restore as full-grown; see `SavedTree`.
  world.trees.restore(
    save.world.trees.map((tree) => ({ ...tree, planted: tree.planted ?? -MATURE_DAYS })),
  );

  world.piles.clear();
  for (const pile of save.piles) {
    const cell = { gx: pile.gx, gy: pile.gy };
    const resource = legacyResource(pile.resource);
    world.piles.drop(cell, resource, pile.amount);
    // The age comes back with it. A heap twelve days old is the settlement's
    // most urgent errand, and a reload that forgot it would quietly hand the
    // player back the deadlock they had just been rescued from.
    const restored = world.piles.getAt(cell, resource);
    if (restored) {
      restored.days = pile.days ?? 0;
    }
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
    // **A building the game no longer has is dropped, not loaded.** Buildings are
    // removed from the game from time to time — the Forester's Lodge went when the
    // woods learned to grow back on their own — and a settlement saved with one
    // standing must still open. Restoring it would look up a definition that is
    // not there and take the whole save down with it, which turns "that building
    // is gone" into "your settlement is gone".
    if (!(saved.buildingId in BUILDINGS)) {
      continue;
    }
    const building = new Building(saved.id, saved.buildingId, { gx: saved.gx, gy: saved.gy });
    building.buildTicksRemaining = saved.buildTicksRemaining;
    // Saves written before yards were linked to their buildings carry nothing;
    // a finished storage building then simply opens its yard on the next tick.
    building.storageId = saved.storageId ?? null;
    building.desiredWorkers = saved.desiredWorkers ?? building.definition.workerSlots;
    building.burning = saved.burning === true;
    building.improved = saved.improved === true;
    building.upgrading = saved.upgrading === true;
    fillInventory(building.materials, saved.materials);
    fillInventory(building.input, saved.input);
    if (saved.complete) {
      building.state = 'complete';
      // Finished buildings block their footprint; the navigation rebuild above
      // cleared that, so it has to be re-applied. A bridge is the exception and
      // the reverse: it *opens* its cell, and the road that carries it came back
      // with the rest of the roads above — blocking it here would load a
      // settlement whose bridges nobody could cross.
      if (!building.definition.crossing) {
        for (const cell of building.cells()) {
          world.navigation.block(cell.gx, cell.gy);
        }
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
      villager.illDaysLived = saved.illDaysLived ?? 0;
      villager.experience.clear();
      for (const [trade, days] of saved.experience ?? []) {
        villager.experience.set(trade as BuildingId, days);
      }
      villager.needs.hunger = saved.hunger;
      villager.needs.warmth = saved.warmth;
      villager.needs.health = saved.health;
      // Neutral for a save written before the settlement had a spirit, which
      // is the honest reading: that settlement had neither Temple nor
      // Cemetery, and neutral is exactly what having neither is worth.
      villager.needs.spirit = saved.spirit ?? SPIRIT_NEUTRAL;
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
    if (save.random.wolves) {
      simulation.restoreWolfRandom(save.random.wolves);
    }
  }
  // Older saves have no chronicle and restore at zero: a settlement whose
  // history was never written down, honestly reported as such.
  simulation.restoreChronicle({ ...newChronicle(), ...(save.chronicle ?? {}) });
  // Cast rather than validated: the fields are written by this same serialiser,
  // and a save from another version is already rejected by the version check.
  simulation.restoreNecrology((save.necrology ?? []) as readonly DeathRecord[]);
  simulation.woodland.restore(save.woodland ?? {});
  simulation.wolves.restore(save.wolves ?? {});
  simulation.restoreWearDebt(
    (save.wear ?? []).map(([resource, owed]) => [resource as ResourceId, owed] as const),
  );
  // Lifted first, so loading a settlement that had no ceilings into a session
  // that did leaves the loaded settlement's own instructions standing.
  simulation.stockLimits.clear();
  for (const [resource, limit] of save.stockLimits ?? []) {
    simulation.stockLimits.set(legacyResource(resource), limit);
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
    inventory.add(legacyResource(resource), amount);
  }
}

/**
 * What a good in an older save is called now.
 *
 * There was one good called `food` until the larder was split into five, and a
 * settlement saved before that has its whole winter's supply under that name.
 * Dropping it would empty their stores; refusing the save would lose their
 * settlement. It comes back as **vegetables**, the staple of the five, which is
 * the closest true thing that can be said about an undifferentiated heap of
 * food.
 */
function legacyResource(saved: string): ResourceId {
  return saved === 'food' ? 'vegetables' : (saved as ResourceId);
}
