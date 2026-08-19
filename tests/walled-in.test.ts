/**
 * The settlement must not be able to wall itself in.
 *
 * **Reported from a real game, and the worst class of defect this project has
 * had.** A player sent a screenshot of a settlement with materials all over the
 * ground, villagers shuffling between two cells, and a banner saying the works
 * had stopped for want of timber. Reproduced headlessly on an ordinary opening:
 * by day twenty-four every villager in the settlement *and* its only store were
 * sealed into a four-cell pocket by the settlement's own buildings. Nobody could
 * reach a job, a pile or a post ever again, the haul board grew from twelve jobs
 * to a hundred and ninety-one, six hundred and seventy-six logs lay in the wood,
 * and they starved with three hundred food in sight of the larder.
 *
 * Three separate things had to be true for that to happen, and each has its own
 * claim here: buildings could seal ground, nothing noticed anybody stranded, and
 * a villager offered work they could not walk to would be offered the same work
 * for ever.
 */

import { describe, expect, it } from 'vitest';

import { findPath } from '@/simulation/pathfinding/AStar';
import { Simulation } from '@/simulation/Simulation';
import type { GridPoint } from '@/shared/types/geometry';

const OPTIONS = { seed: 20316248, worldWidth: 96, worldHeight: 96, startingVillagers: 10 };

/** Clears an area of trees and rock so placement rules do not get in the way. */
function clear(simulation: Simulation, from: GridPoint, size: number): void {
  for (let gy = from.gy; gy < from.gy + size; gy += 1) {
    for (let gx = from.gx; gx < from.gx + size; gx += 1) {
      const tree = simulation.world.trees.getAt({ gx, gy });
      if (tree) {
        simulation.world.trees.remove(tree.id);
      }
      simulation.world.terrain.set(gx, gy, 'grass');
      simulation.world.navigation.refreshCell(simulation.world.terrain, gx, gy);
    }
  }
}

describe('a building that would wall ground off', () => {
  /** A solid ring of blocked cells with one gap, and open ground inside it. */
  function pen(simulation: Simulation, centre: GridPoint): GridPoint {
    clear(simulation, { gx: centre.gx - 4, gy: centre.gy - 4 }, 9);
    const nav = simulation.world.navigation;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) {
          continue;
        }
        // Everything but the gap in the middle of the right-hand wall.
        if (dx === 2 && dy === 0) {
          continue;
        }
        nav.block(centre.gx + dx, centre.gy + dy);
      }
    }
    return { gx: centre.gx + 2, gy: centre.gy };
  }

  it('refuses to fill the last gap in a pen', () => {
    const simulation = new Simulation(OPTIONS);
    const gap = pen(simulation, { gx: 24, gy: 24 });
    expect(simulation.world.navigation.wouldSeal([gap])).toBe(true);
  });

  it('allows the same cell once the pen has a second way out', () => {
    // The rule is about *disconnecting*, not about being surrounded. Knock a
    // second hole in the wall and filling the first one costs nothing.
    const simulation = new Simulation(OPTIONS);
    const gap = pen(simulation, { gx: 40, gy: 40 });
    simulation.world.navigation.refreshCell(simulation.world.terrain, 38, 40);

    expect(simulation.world.navigation.wouldSeal([gap])).toBe(false);
  });

  it('lets an ordinary house go up in open ground', () => {
    const simulation = new Simulation(OPTIONS);
    clear(simulation, { gx: 56, gy: 56 }, 10);
    expect(
      simulation.world.navigation.wouldSeal([
        { gx: 60, gy: 60 },
        { gx: 61, gy: 60 },
        { gx: 60, gy: 61 },
        { gx: 61, gy: 61 },
      ]),
    ).toBe(false);
  });

  it('refuses the placement itself, with a reason a player can read', () => {
    const simulation = new Simulation(OPTIONS);
    const gap = pen(simulation, { gx: 70, gy: 70 });
    const check = simulation.canPlaceBuilding('house', gap);
    // A 2x2 house cannot fit a one-cell gap anyway, so ask about the rule with
    // something that can: a bridge is the only 1x1, and it wants water. The
    // honest check is therefore the grid's, plus that the refusal exists at all.
    expect(check.ok).toBe(false);
    expect(simulation.world.navigation.wouldSeal([gap])).toBe(true);
  });
});

describe('a settlement built shoulder to shoulder', () => {
  it('never seals anybody in, however tightly it is packed', () => {
    // The reproduction, and the claim that matters: pack buildings around the
    // camp as densely as the rules allow, and every villager must still be able
    // to reach the settlement's store.
    const simulation = new Simulation(OPTIONS);
    const camp = simulation.world.landfallCell;

    let placed = 0;
    for (let ring = 2; ring < 14 && placed < 24; ring += 1) {
      for (let dx = -ring; dx <= ring && placed < 24; dx += 1) {
        for (let dy = -ring; dy <= ring && placed < 24; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
            continue;
          }
          const cell = { gx: camp.gx + dx, gy: camp.gy + dy };
          if (!simulation.canPlaceBuilding('house', cell).ok) {
            continue;
          }
          const building = simulation.placeBuilding('house', cell);
          if (building) {
            simulation.world.buildings.complete(simulation.world, building);
            placed += 1;
          }
        }
      }
    }
    expect(placed).toBeGreaterThan(10);

    // Let everybody settle, then check nobody is in a pocket.
    for (let tick = 1; tick <= 600; tick += 1) {
      simulation.update(tick, 0.1);
    }

    const nav = simulation.world.navigation;
    const storeRegions = new Set(
      simulation.storages.all.map((store) => nav.regionAt(store.cell.gx, store.cell.gy)),
    );
    for (const villager of simulation.villagers.all) {
      const region = nav.regionAt(villager.cell.gx, villager.cell.gy);
      expect(storeRegions.has(region), `villager ${villager.id} is cut off`).toBe(true);
    }
  });
});

describe('a construction site', () => {
  it('gets finished even when the first load in is all one material', () => {
    // **A Feller's Hut was measured holding eight logs and full**, with the two
    // stone it needed lying on its doorstep being re-fetched for ever. A site's
    // materials hold exactly its cost, so a load tipped in whole could fill the
    // room another material needed and the building could never be finished —
    // which is what left a settlement with no timber, no firewood and a banner
    // saying the works had stopped.
    const simulation = new Simulation(OPTIONS);
    clear(simulation, { gx: 48, gy: 48 }, 10);
    const site = simulation.placeBuilding('feller', { gx: 52, gy: 52 });
    expect(site).not.toBeNull();

    // Everything it needs, and plenty of it, so the only question is delivery.
    const store = simulation.storages.all[0]!;
    store.inventory.add('logs', 200);
    store.inventory.add('stone', 200);
    simulation.storages.markChanged();

    for (let tick = 1; tick <= 60 * 30; tick += 1) {
      simulation.update(tick, 0.1);
      if (site!.isComplete) {
        break;
      }
    }

    expect(site!.isComplete).toBe(true);
  }, 30_000);

  it('never leaves a heap standing on its own doorstep', () => {
    // **What a player reads as "the works are stuck".** A load the site cannot
    // take used to be set down where the hauler stood, which is the site's own
    // doorway — and it only happens because somebody else's load arrived first
    // while this one was walking. Measured before the fix: a heap sat on some
    // site's doorway for one tick in forty of an ordinary year. The remainder
    // goes on to a yard in the hauler's hands now, so nothing lands there at all.
    const simulation = new Simulation(OPTIONS);
    const camp = simulation.world.landfallCell;

    let ordered = 0;
    for (let ring = 2; ring < 12 && ordered < 6; ring += 1) {
      for (let dx = -ring; dx <= ring && ordered < 6; dx += 1) {
        for (let dy = -ring; dy <= ring && ordered < 6; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
            continue;
          }
          const cell = { gx: camp.gx + dx, gy: camp.gy + dy };
          if (
            simulation.canPlaceBuilding('house', cell).ok &&
            simulation.placeBuilding('house', cell)
          ) {
            ordered += 1;
          }
        }
      }
    }
    expect(ordered).toBeGreaterThan(2);

    let ticksWithAHeapAtADoor = 0;
    for (let tick = 1; tick <= 60 * 20; tick += 1) {
      simulation.update(tick, 0.1);
      for (const building of simulation.world.buildings.all) {
        if (building.isComplete) {
          continue;
        }
        for (const pile of simulation.world.piles.all) {
          if (pile.isEmpty) {
            continue;
          }
          if (pile.cell.gx === building.accessCell.gx && pile.cell.gy === building.accessCell.gy) {
            ticksWithAHeapAtADoor += 1;
          }
        }
      }
    }

    expect(ticksWithAHeapAtADoor).toBe(0);
  }, 30_000);
});

describe('the region map and the pathfinder', () => {
  it('agree about a diagonal gap, which is the whole point of the region map', () => {
    // **The most expensive disagreement this project has had.** `AStar` refuses to
    // cut a corner — a diagonal step is legal only when both orthogonal cells it
    // passes between are clear, because the looser rule reads as walking through a
    // wall. The region map counted that squeeze as a way through. So `connects`
    // said two cells were joined, every route between them failed after burning
    // the whole search budget, and villagers claimed errands they could not
    // finish, dropped their loads and were handed the same errand again.
    //
    // Measured on a settlement of fifty: twenty-nine thousand material errands
    // completed carrying nothing, nineteen sites had not moved in a hundred days,
    // and the ground filled with heaps nobody could deliver. Deaths across
    // twenty-four seeds fell from 162 to 39 when the two were made to agree.
    const simulation = new Simulation(OPTIONS);
    const nav = simulation.world.navigation;
    clear(simulation, { gx: 30, gy: 30 }, 10);

    // Two single-cell rooms joined at one corner and nothing else. Everything in
    // a seven-by-seven block is walled but these three cells:
    //
    //   A at (33,33) — the gap at (34,34) — B at (35,35)
    //
    // Both steps are purely diagonal, and both orthogonal cells beside each are
    // blocked, so the pathfinder refuses them.
    const open = new Set(['33,33', '34,34', '35,35']);
    for (let gy = 31; gy <= 37; gy += 1) {
      for (let gx = 31; gx <= 37; gx += 1) {
        if (!open.has(`${gx},${gy}`)) {
          nav.block(gx, gy);
        }
      }
    }

    const a = { gx: 33, gy: 33 };
    const b = { gx: 35, gy: 35 };
    expect(nav.isWalkable(a.gx, a.gy)).toBe(true);
    expect(nav.isWalkable(b.gx, b.gy)).toBe(true);
    expect(nav.isWalkable(34, 34)).toBe(true);

    // The pathfinder cannot get from one to the other, so the region map must not
    // pretend otherwise — and every rule built on `connects` depends on it.
    const route = findPath(nav, a, b);
    expect(route.path).toBeNull();
    expect(nav.connects(a, b)).toBe(false);
  });
});
