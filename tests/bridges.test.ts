/**
 * Crossing the river.
 *
 * The map used to be one piece of walkable ground with a sea at one edge, and
 * "can anybody get there" was a question with only one answer. A river through
 * the middle makes it a real question, and the bridge is the player's answer to
 * it — five logs, one cell of water, and the far bank stops being scenery.
 *
 * **A bridge is a road laid over the water**, and that is not a trick of the
 * implementation: it is what a bridge is. Everything a road already does — being
 * preferred by pathfinding, being walked faster, being drawn joined to the
 * tracks either side, being saved — a bridge gets for nothing, and the only new
 * rule in the whole feature is that boards can be laid over water and not over
 * rock.
 */

import { describe, expect, it } from 'vitest';

import { buildingDefinition } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';
import { Simulation } from '@/simulation/Simulation';
import { restore, serialise } from '@/simulation/save/serialise';

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('what a bridge costs and where it goes', () => {
  it('is five logs and a cell of water', () => {
    const definition = buildingDefinition('bridge');
    expect(definition.footprint).toEqual({ width: 1, height: 1 });
    expect(definition.constructionCost).toEqual([{ resource: 'logs', amount: 5 }]);
    expect(definition.on).toBe('water');
    expect(definition.crossing).toBe(true);
  });

  it('is offered on its own square of river, not in the build menu', () => {
    // Siting a one-cell bridge by eye with a floating outline is worse in every
    // way than tapping the water and pressing a button — and the build menu's
    // groups are sized for a thumb.
    expect(buildingDefinition('bridge').placement).toBe('cell');
  });

  it('will not be built on dry land', () => {
    const simulation = new Simulation(OPTIONS);
    const check = simulation.canPlaceBuilding('bridge', simulation.world.heartCell);
    expect(check.ok).toBe(false);
    expect(check.ok ? null : check.reason).toBe('needs-water');
  });

  it('goes on a river cell the settlement can reach', () => {
    const simulation = new Simulation(OPTIONS);
    expect(simulation.canPlaceBuilding('bridge', nearBank(simulation)).ok).toBe(true);
  });

  it('will not be built out in the middle of nowhere', () => {
    // The far end of the river, with no route to either of its banks. A bridge
    // nobody can reach is five logs carried to a place they cannot be carried
    // to.
    const simulation = new Simulation(OPTIONS);
    const far = farWater(simulation);
    expect(far).not.toBeNull();
    const check = simulation.canPlaceBuilding('bridge', far!);
    expect(check.ok).toBe(false);
    expect(check.ok ? null : check.reason).toBe('unreachable');
  });
});

describe('once it stands', () => {
  it('makes the water walkable', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = nearBank(simulation);
    expect(simulation.world.isWalkable(cell)).toBe(false);

    raiseBridge(simulation, cell);

    expect(simulation.world.isWalkable(cell)).toBe(true);
  });

  it('is quicker to cross than open ground, being a road', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = nearBank(simulation);
    raiseBridge(simulation, cell);

    const heart = simulation.world.heartCell;
    expect(simulation.world.navigation.costAt(cell.gx, cell.gy)).toBeLessThan(
      simulation.world.navigation.costAt(heart.gx, heart.gy),
    );
  });

  it('joins the two banks into one piece of ground', () => {
    // **The whole point.** Before it, the far bank is a different patch of the
    // map and every job on it is refused before a search is even started.
    const simulation = new Simulation(OPTIONS);
    const crossing = crossingCells(simulation);
    expect(crossing.length).toBeGreaterThan(0);

    const navigation = simulation.world.navigation;
    const near = bankBeside(simulation, crossing[0]!, true);
    const far = bankBeside(simulation, crossing.at(-1)!, false);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(navigation.connects(near!, far!)).toBe(false);

    for (const cell of crossing) {
      raiseBridge(simulation, cell);
    }

    expect(navigation.connects(near!, far!)).toBe(true);
  });

  it('opens the far bank to building', () => {
    const simulation = new Simulation(OPTIONS);
    const crossing = crossingCells(simulation);
    // Somewhere over there that is refused *only* because nobody can get to it:
    // clear ground, no trees, no rock. That is the refusal a bridge lifts.
    const plot = farPlot(simulation, crossing.at(-1)!);
    expect(plot).not.toBeNull();

    for (const cell of crossing) {
      raiseBridge(simulation, cell);
    }

    expect(simulation.canPlaceBuilding('gatherer-hut', plot!).ok).toBe(true);
  });

  it('cannot be taken up with the road tool', () => {
    // Lifting a road is immediate and free, which would make a bridge free to
    // remove and — worse — leave the building standing over water nobody could
    // cross.
    const simulation = new Simulation(OPTIONS);
    const cell = nearBank(simulation);
    raiseBridge(simulation, cell);

    expect(simulation.liftRoad(cell)).toBe(false);
    expect(simulation.world.isWalkable(cell)).toBe(true);
  });

  it('takes its boards with it when it is pulled down', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = nearBank(simulation);
    const bridge = raiseBridge(simulation, cell);

    simulation.world.buildings.demolish(simulation.world, bridge.id);

    expect(simulation.world.roads.hasAt(cell)).toBe(false);
    expect(simulation.world.isWalkable(cell)).toBe(false);
  });

  it('is still there after a save and a load', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = nearBank(simulation);
    raiseBridge(simulation, cell);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.world.roads.hasAt(cell)).toBe(true);
    expect(loaded.world.isWalkable(cell)).toBe(true);
  });
});

describe('building one, in play', () => {
  it('is carried out and finished by the settlement itself', () => {
    // The whole chain, driven by nobody: five logs out of the yard, carried to
    // the bank, and a villager standing on dry land laying boards over water.
    const simulation = new Simulation(OPTIONS);
    const cell = nearBank(simulation);
    const before = simulation.storages.totalOf('logs');
    const bridge = simulation.placeBuilding('bridge', cell);
    expect(bridge).not.toBeNull();

    for (let tick = 1; tick <= 4000 && !bridge!.isComplete; tick += 1) {
      simulation.update(tick, 0.1);
    }

    expect(bridge!.isComplete).toBe(true);
    expect(simulation.world.isWalkable(cell)).toBe(true);
    // Five logs really left the yard: the timber was carried, not conjured.
    expect(simulation.storages.totalOf('logs')).toBeLessThanOrEqual(before - 5);
  });
});

/** A river cell with the settlement's own bank on one side of it. */
function nearBank(simulation: Simulation): GridPoint {
  const cell = crossingCells(simulation)[0];
  if (!cell) {
    throw new Error('No river cell within reach of the settlement');
  }
  return cell;
}

/**
 * The line of water at the narrowest crossing near the settlement.
 *
 * Walked out from the bank across the channel, so the cells returned are exactly
 * the ones a player would bridge.
 */
function crossingCells(simulation: Simulation): GridPoint[] {
  const world = simulation.world;
  const horizontal = world.river.axis === 'horizontal';
  const heart = world.heartCell;
  // Which way the channel lies from the camp: the camp is set back from one
  // bank, so stepping towards the middle of the map finds the water.
  const middle = world.river.middle[horizontal ? heart.gx : heart.gy];
  if (!middle) {
    throw new Error('The river does not run past the settlement');
  }
  const towards = horizontal ? Math.sign(middle.gy - heart.gy) : Math.sign(middle.gx - heart.gx);

  const cells: GridPoint[] = [];
  let step = 0;
  let seenWater = false;
  for (; step < world.width + world.height; step += 1) {
    const cell = horizontal
      ? { gx: heart.gx, gy: heart.gy + towards * step }
      : { gx: heart.gx + towards * step, gy: heart.gy };
    if (!world.terrain.contains(cell.gx, cell.gy)) {
      break;
    }
    const water = world.terrainAt(cell) === 'water';
    if (water) {
      seenWater = true;
      cells.push(cell);
      continue;
    }
    if (seenWater) {
      break;
    }
  }
  return cells;
}

/** The dry cell just before or just after a stretch of water. */
function bankBeside(simulation: Simulation, cell: GridPoint, near: boolean): GridPoint | null {
  const world = simulation.world;
  const horizontal = world.river.axis === 'horizontal';
  const heart = world.heartCell;
  const towards = horizontal
    ? Math.sign(cell.gy - heart.gy) || 1
    : Math.sign(cell.gx - heart.gx) || 1;
  const step = near ? -towards : towards;

  for (let distance = 1; distance < 8; distance += 1) {
    const candidate = horizontal
      ? { gx: cell.gx, gy: cell.gy + step * distance }
      : { gx: cell.gx + step * distance, gy: cell.gy };
    if (world.isWalkable(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * A plot on the far bank that only the water is keeping the settlement from.
 *
 * Searched for rather than assumed, because the opposite bank is ordinary
 * wilderness: right across from the ford it is as likely to be wooded or rocky
 * as clear, and "trees in the way" is a different refusal from the one under
 * test.
 */
function farPlot(simulation: Simulation, waterEdge: GridPoint): GridPoint | null {
  const world = simulation.world;
  const horizontal = world.river.axis === 'horizontal';
  const heart = world.heartCell;
  const away = horizontal
    ? Math.sign(waterEdge.gy - heart.gy) || 1
    : Math.sign(waterEdge.gx - heart.gx) || 1;

  for (let distance = 1; distance < 20; distance += 1) {
    for (let sideways = -6; sideways <= 6; sideways += 1) {
      const cell = horizontal
        ? { gx: waterEdge.gx + sideways, gy: waterEdge.gy + away * distance }
        : { gx: waterEdge.gx + away * distance, gy: waterEdge.gy + sideways };
      const check = simulation.canPlaceBuilding('gatherer-hut', cell);
      if (!check.ok && check.reason === 'unreachable') {
        return cell;
      }
    }
  }
  return null;
}

/** A water cell far from the settlement, on nobody's bank. */
function farWater(simulation: Simulation): GridPoint | null {
  const world = simulation.world;
  const heart = world.heartCell;
  let best: GridPoint | null = null;
  let bestDistance = 0;

  for (const cell of world.river.middle) {
    const distance = Math.hypot(cell.gx - heart.gx, cell.gy - heart.gy);
    if (distance > bestDistance && world.terrainAt(cell) === 'water') {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}

/** Places a bridge and finishes it, as the builders would. */
function raiseBridge(simulation: Simulation, cell: GridPoint) {
  const bridge = simulation.placeBuilding('bridge', cell);
  if (!bridge) {
    throw new Error(`A bridge was refused at ${cell.gx},${cell.gy}`);
  }
  simulation.world.buildings.complete(simulation.world, bridge);
  return bridge;
}
