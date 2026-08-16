/**
 * Getting off this coast.
 *
 * The game's only win condition, and the one thing in it that takes decades of
 * play to see. Nobody is going to catch a bug here by playing — a mistake in
 * the arrival arithmetic surfaces three hours into a campaign, once, and the
 * settlement it ruins cannot be got back. So it is tested hard.
 *
 * Three properties matter most:
 *
 * **The bottle is carried, not clicked.** The whole project refuses to fake
 * logistics. Asking for the message must post a job that a villager physically
 * walks to the water; until somebody arrives, nothing has been sent.
 *
 * **The clock cannot be cheated.** One bottle, one ship. Sending twice must not
 * halve the wait, and a save must restore into a rescue that agrees with its
 * own tick rather than one that resets the countdown.
 *
 * **The chronicle is about the past.** Every figure on the closing page is
 * something a snapshot of the present cannot be asked for. If it is not
 * recorded as it happens, it is gone.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import {
  DAYS_PER_YEAR,
  RESCUE_TICKS,
  RESCUE_YEARS,
  SAIL_SIGHTED_DAYS,
  arrivalTick,
  hasShipLanded,
  readRescue,
} from '@/simulation/rescue/RescueSystem';
import { hasColdReading, newChronicle } from '@/simulation/rescue/Chronicle';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { restore, serialise } from '@/simulation/save/serialise';

const TICK = 0.1;
const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

const SAVED_AT = '2026-08-16T00:00:00.000Z';

const NOTHING_SENT = { messageSentTick: null, arrivedTick: null };
const NO_SCHOOL = { hasSchool: false, carrying: false };
const SCHOOL = { hasSchool: true, carrying: false };

describe('reading the rescue', () => {
  it('starts unaware, because nobody knows the settlement is there', () => {
    const report = readRescue(NOTHING_SENT, 0, NO_SCHOOL);
    expect(report.stage).toBe('unaware');
    expect(report.canSendMessage).toBe(false);
    expect(report.daysRemaining).toBeNull();
  });

  it('becomes ready once a school stands', () => {
    const report = readRescue(NOTHING_SENT, 0, SCHOOL);
    expect(report.stage).toBe('ready');
    expect(report.canSendMessage).toBe(true);
  });

  it('will not offer the bottle twice while somebody is walking it out', () => {
    // A second button press while the first messenger is still on the beach
    // would read as though it made the ship come sooner. It would not.
    const report = readRescue(NOTHING_SENT, 0, { hasSchool: true, carrying: true });
    expect(report.stage).toBe('carrying');
    expect(report.canSendMessage).toBe(false);
  });

  it('counts down from the message, not from the founding', () => {
    // Getting word out early has to be worth something, or the school is a
    // box to tick rather than a goal to race towards.
    const early = readRescue({ messageSentTick: 0, arrivedTick: null }, 0, SCHOOL);
    const late = readRescue({ messageSentTick: 100_000, arrivedTick: null }, 100_000, SCHOOL);
    expect(early.daysRemaining).toBe(late.daysRemaining);
    expect(early.yearsRemaining).toBe(RESCUE_YEARS);
  });

  it('never offers the bottle again once it is away', () => {
    const report = readRescue({ messageSentTick: 0, arrivedTick: null }, 500, SCHOOL);
    expect(report.stage).toBe('awaited');
    expect(report.canSendMessage).toBe(false);
  });

  it('sights the sail exactly a season before it lands', () => {
    // The boundary is worth pinning rather than approximating: a sail that
    // appears a day late is a payoff the player watches for and does not get.
    const state = { messageSentTick: 0, arrivedTick: null };
    const firstSighting = arrivalTick(0) - SAIL_SIGHTED_DAYS * TICKS_PER_DAY;

    expect(readRescue(state, firstSighting - 1, SCHOOL).stage).toBe('awaited');
    expect(readRescue(state, firstSighting, SCHOOL).stage).toBe('sighted');
    expect(readRescue(state, firstSighting, SCHOOL).daysRemaining).toBe(SAIL_SIGHTED_DAYS);
  });

  it('reports arrival from the recorded tick rather than from the clock', () => {
    // Derived state must not contradict the record. A settlement the player
    // keeps running past the ending still shows as rescued.
    const report = readRescue({ messageSentTick: 0, arrivedTick: 100 }, 9_999_999, SCHOOL);
    expect(report.stage).toBe('arrived');
    expect(report.daysRemaining).toBe(0);
  });

  it('lands the ship exactly once the span is up, and not before', () => {
    const state = { messageSentTick: 400, arrivedTick: null };
    expect(hasShipLanded(state, arrivalTick(400) - 1)).toBe(false);
    expect(hasShipLanded(state, arrivalTick(400))).toBe(true);
  });

  it('does not land a second ship on a settlement already rescued', () => {
    expect(hasShipLanded({ messageSentTick: 400, arrivedTick: 500 }, 9_999_999)).toBe(false);
  });

  it('lands nothing at all when no bottle ever went out', () => {
    expect(hasShipLanded(NOTHING_SENT, 9_999_999)).toBe(false);
  });

  it('agrees with the calendar about how long the wait is', () => {
    // The one figure a player will hold in their head. If the constant and the
    // calendar ever disagree, the sentence on screen is wrong.
    expect(RESCUE_TICKS).toBe(RESCUE_YEARS * DAYS_PER_YEAR * TICKS_PER_DAY);
    expect(DAYS_PER_YEAR).toBe(48);
  });
});

describe('sending the message', () => {
  it('refuses while there is no school', () => {
    const simulation = new Simulation(OPTIONS);
    expect(simulation.rescue.stage).toBe('unaware');
    expect(simulation.sendMessage()).toBe(false);
  });

  it('accepts once the school stands', () => {
    const simulation = new Simulation(OPTIONS);
    expect(raise(simulation, 'school')).not.toBeNull();
    expect(simulation.rescue.canSendMessage).toBe(true);
    expect(simulation.sendMessage()).toBe(true);
  });

  it('posts a job rather than sending anything itself', () => {
    // The bottle must physically reach the water. A flag set on the button
    // press would be exactly the faked logistics this project refuses.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'school');
    simulation.sendMessage();

    expect(simulation.jobs.all.some((job) => job.type === 'carry-message')).toBe(true);
    expect(simulation.rescue.stage).toBe('carrying');
    expect(simulation.snapshot().rescue.daysRemaining).toBeNull();
  });

  it('refuses a second bottle while the first is still being carried', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'school');
    expect(simulation.sendMessage()).toBe(true);
    expect(simulation.sendMessage()).toBe(false);
    expect(simulation.jobs.all.filter((job) => job.type === 'carry-message')).toHaveLength(1);
  });

  it('sends the messenger to water, not to the middle of the camp', () => {
    const simulation = new Simulation(OPTIONS);
    const tideline = simulation.world.tidelineCell;
    expect(simulation.world.isWalkable(tideline)).toBe(true);

    // The point of the tideline is that it is *at* the sea. The landfall is
    // set back from it on purpose, so the two must not be the same cell.
    expect(tideline).not.toEqual(simulation.world.landfallCell);
    expect(touchesWater(simulation, tideline)).toBe(true);
  });

  it('records the message only when somebody arrives with it', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'school');
    simulation.sendMessage();
    expect(simulation.rescueTicks.messageSentTick).toBeNull();

    run(simulation, TICKS_PER_DAY * 12);
    expect(simulation.rescueTicks.messageSentTick).not.toBeNull();
    expect(simulation.rescue.stage).toBe('awaited');
  });

  it('refuses once the bottle is away, however many schools stand', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'school');
    simulation.sendMessage();
    run(simulation, TICKS_PER_DAY * 12);

    const sentAt = simulation.rescueTicks.messageSentTick;
    expect(simulation.sendMessage()).toBe(false);
    expect(simulation.rescueTicks.messageSentTick).toBe(sentAt);
  });
});

describe('the ship', () => {
  it('comes, and ends the settlement in the other direction', () => {
    const simulation = sentSettlement();
    const sentAt = simulation.rescueTicks.messageSentTick!;

    // Jumped rather than played: forty years at ten ticks a second is not
    // something a test suite should sit through, and the arrival is decided by
    // the tick rather than by anything that happens in between.
    simulation.restoreClock(arrivalTick(sentAt), 0);
    run(simulation, TICKS_PER_DAY);

    expect(simulation.rescue.stage).toBe('arrived');
    expect(simulation.snapshot().hasFailed).toBe(false);
  });

  it('does not come for a settlement with nobody left in it', () => {
    // An empty settlement is not rescued, it is found. The failure overlay is
    // the right ending for that and already exists.
    const simulation = sentSettlement();
    const sentAt = simulation.rescueTicks.messageSentTick!;
    for (const villager of [...simulation.villagers.all]) {
      simulation.villagers.remove(villager.id);
    }

    simulation.restoreClock(arrivalTick(sentAt), 0);
    run(simulation, TICKS_PER_DAY);

    expect(simulation.rescue.stage).not.toBe('arrived');
    expect(simulation.snapshot().hasFailed).toBe(true);
  });
});

describe('the chronicle', () => {
  it('has nothing to say on the first day, and says so', () => {
    const fresh = newChronicle();
    expect(hasColdReading(fresh)).toBe(false);
    expect(fresh.born).toBe(0);
    expect(fresh.died).toBe(0);
  });

  it('records the coldest night the settlement stood in', () => {
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY * 3);

    const chronicle = simulation.snapshot().chronicle;
    expect(hasColdReading(chronicle)).toBe(true);
    expect(chronicle.coldest).toBeLessThanOrEqual(simulation.year.temperature);
  });

  it('counts a building when the wall goes up', () => {
    const simulation = new Simulation(OPTIONS);
    expect(simulation.snapshot().chronicle.buildingsRaised).toBe(0);
    raise(simulation, 'house');
    expect(simulation.snapshot().chronicle.buildingsRaised).toBe(1);
  });

  it('keeps counting a building that was later pulled down', () => {
    // "How many were ever raised" is a fact about the past. Demolishing one
    // does not unbuild the years that went into it.
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');
    expect(house).not.toBeNull();
    simulation.world.buildings.demolish(simulation.world, house!.id);

    expect(simulation.snapshot().chronicle.buildingsRaised).toBe(1);
  });

  it('follows the population up but never back down', () => {
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY * 2);
    const peak = simulation.snapshot().chronicle.peakPopulation;
    expect(peak).toBe(simulation.villagers.all.length);

    for (const villager of [...simulation.villagers.all].slice(0, 4)) {
      simulation.villagers.remove(villager.id);
    }
    run(simulation, TICKS_PER_DAY * 2);
    expect(simulation.snapshot().chronicle.peakPopulation).toBe(peak);
  });

  it('accumulates what the settlement ate', () => {
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY * 4);
    expect(simulation.snapshot().chronicle.foodEaten).toBeGreaterThan(0);
  });

  it('buries everyone it loses', () => {
    const simulation = new Simulation(OPTIONS);
    // Nothing to eat and nowhere to sleep. This settlement is going to end.
    for (const storage of simulation.storages.all) {
      storage.inventory.clear();
    }
    simulation.storages.markChanged();
    run(simulation, TICKS_PER_DAY * 60);

    const chronicle = simulation.snapshot().chronicle;
    expect(chronicle.died).toBeGreaterThan(0);
    expect(chronicle.died).toBe(simulation.snapshot().deaths);
  });
});

describe('across a save', () => {
  it('carries the rescue and the chronicle through', () => {
    const simulation = sentSettlement();
    run(simulation, TICKS_PER_DAY * 4);
    const before = simulation.snapshot();

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, SAVED_AT));

    expect(loaded.rescueTicks).toEqual(simulation.rescueTicks);
    expect(loaded.snapshot().chronicle).toEqual(before.chronicle);
  });

  it('restores into a wait that agrees with its own clock', () => {
    // The countdown is derived from the saved tick, so a settlement reloaded
    // halfway through its wait must not start the forty years again.
    const simulation = sentSettlement();
    run(simulation, TICKS_PER_DAY * DAYS_PER_YEAR);
    const remaining = simulation.rescue.daysRemaining;

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, SAVED_AT));

    expect(loaded.rescue.daysRemaining).toBe(remaining);
    expect(remaining).toBeLessThan(RESCUE_YEARS * DAYS_PER_YEAR);
  });

  it('loads a save written before there was any way home', () => {
    // Older saves have no rescue and no chronicle. They must restore as a
    // settlement that never sent for anyone, not fail to load.
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY);
    const save = serialise(simulation, SAVED_AT);
    const { rescue: _rescue, chronicle: _chronicle, ...older } = save;

    const loaded = new Simulation(OPTIONS);
    restore(loaded, older);

    expect(loaded.rescue.stage).toBe('unaware');
    expect(loaded.snapshot().chronicle.born).toBe(0);
  });
});

/** A settlement with a school, whose bottle has physically reached the water. */
function sentSettlement(): Simulation {
  const simulation = new Simulation(OPTIONS);
  raise(simulation, 'school');
  simulation.sendMessage();
  run(simulation, TICKS_PER_DAY * 12);
  if (simulation.rescueTicks.messageSentTick === null) {
    throw new Error('the messenger never reached the water');
  }
  return simulation;
}

function run(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, TICK);
  }
}

function touchesWater(simulation: Simulation, cell: { gx: number; gy: number }): boolean {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const at = { gx: cell.gx + (dx ?? 0), gy: cell.gy + (dy ?? 0) };
    if (
      at.gx >= 0 &&
      at.gy >= 0 &&
      at.gx < simulation.world.width &&
      at.gy < simulation.world.height &&
      simulation.world.terrainAt(at) === 'water'
    ) {
      return true;
    }
  }
  return false;
}

function place(simulation: Simulation, id: BuildingId): Building | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
      if (simulation.canPlaceBuilding(id, cell).ok) {
        return simulation.placeBuilding(id, cell);
      }
    }
  }
  return null;
}

function raise(simulation: Simulation, id: BuildingId): Building | null {
  const building = place(simulation, id);
  if (building) {
    simulation.world.buildings.complete(simulation.world, building);
  }
  return building;
}
