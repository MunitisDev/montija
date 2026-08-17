/**
 * The labour panel: every workplace at once, and a pair of buttons each.
 *
 * **The question could not be asked before.** A player with nine workshops and a
 * settlement that had stopped growing wanted to know who was working where and
 * who was spare, and the only way to find out was to tap each building in turn.
 * Moving one person meant tapping the building they should leave, then the
 * building they should join, with the map in between.
 *
 * What is tested here is that the page tells the truth about that. Two figures
 * are easy to conflate and must not be: the **quota** is what the player asked
 * for and the **staff** is who actually turned up, and they differ exactly when
 * the settlement has nobody spare — which is the state the panel exists for.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import { SKILL_THRESHOLD_DAYS } from '@/data/skills';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { EN, type MessageKey } from '@/ui/i18n/messages';
import { buildLabour } from '@/ui/labour/labourModel';

const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

const t = (key: MessageKey): string => {
  const value = (EN as Record<string, string | undefined>)[key];
  if (value === undefined) {
    throw new Error(`No English string for ${key}`);
  }
  return value;
};

describe('what counts as a workplace', () => {
  it('says so plainly when there is nowhere to work', () => {
    // The founding yard is a store, not a job.
    expect(buildLabour(new Simulation(OPTIONS), t).posts).toEqual([]);
  });

  it('leaves out a house, which nobody works at', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'house');
    expect(buildLabour(simulation, t).posts).toEqual([]);
  });

  it('leaves out a site still going up', () => {
    // A half-built workshop has no posts to offer, and listing it with a pair of
    // buttons would invite the player to staff a pile of logs.
    const simulation = new Simulation(OPTIONS);
    place(simulation, 'gatherer-hut');
    expect(buildLabour(simulation, t).posts).toEqual([]);
  });

  it('lists a finished workshop, named and counted', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY);

    const post = buildLabour(simulation, t).posts[0];
    expect(post).toBeDefined();
    expect(post!.buildingId).toBe(hut!.id);
    expect(post!.name).toBe(t('building.gatherer-hut'));
    expect(post!.slots).toBe(hut!.definition.workerSlots);
  });

  it('numbers the workshops there is more than one of', () => {
    // Two rows both saying "Gatherer Hut" leave the player choosing between two
    // things they cannot tell apart.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    raise(simulation, 'gatherer-hut');
    raise(simulation, 'woodcutter');

    const names = buildLabour(simulation, t).posts.map((post) => post.name);
    expect(names).toContain(`${t('building.gatherer-hut')} 1`);
    expect(names).toContain(`${t('building.gatherer-hut')} 2`);
    // The only woodcutter keeps its plain name: "Woodcutter 1" is a number about
    // nothing.
    expect(names).toContain(t('building.woodcutter'));
  });

  it('lists workplaces by trade, so two of a kind sit together', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'woodcutter');
    raise(simulation, 'gatherer-hut');
    raise(simulation, 'woodcutter');

    const names = buildLabour(simulation, t).posts.map((post) => post.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('the quota and the staff', () => {
  it('reports both, and they agree when there are hands to spare', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY);

    const post = buildLabour(simulation, t).posts[0]!;
    expect(post.desired).toBeGreaterThan(0);
    expect(post.staffed).toBe(post.desired);
    expect(post.short).toBe(false);
  });

  it('shows the shortfall when the settlement has nobody left', () => {
    // **The state the panel exists for.** Ten people, and far more posts than
    // that: the quotas are met on paper and empty on the ground.
    const simulation = new Simulation(OPTIONS);
    for (let i = 0; i < 8; i += 1) {
      raise(simulation, 'gatherer-hut');
    }
    run(simulation, TICKS_PER_DAY * 2);

    const view = buildLabour(simulation, t);
    expect(view.summary.vacancies).toBeGreaterThan(0);
    expect(view.posts.some((post) => post.short)).toBe(true);
    for (const post of view.posts) {
      expect(post.staffed).toBeLessThanOrEqual(post.desired);
    }
  });

  it('never claims more staff than the building has posts', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY * 2);

    for (const post of buildLabour(simulation, t).posts) {
      expect(post.staffed).toBeLessThanOrEqual(post.slots);
      expect(post.desired).toBeLessThanOrEqual(post.slots);
    }
  });
});

describe('the buttons', () => {
  it('will not add past the last post', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    simulation.setDesiredWorkers(hut.id, hut.definition.workerSlots);

    const post = buildLabour(simulation, t).posts[0]!;
    expect(post.canAdd).toBe(false);
    expect(post.canRemove).toBe(true);
  });

  it('will not take away from an empty post', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    simulation.setDesiredWorkers(hut.id, 0);

    const post = buildLabour(simulation, t).posts[0]!;
    expect(post.canRemove).toBe(false);
    expect(post.canAdd).toBe(true);
  });

  it('moves the quota and the staff with it', () => {
    // The quota change re-runs employment straight away, which is what lets the
    // panel show the result of a press without waiting for a tick — and it has
    // to, because the clock is stopped while the panel is open.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);
    const before = buildLabour(simulation, t).posts[0]!;
    expect(before.staffed).toBeGreaterThan(0);

    simulation.setDesiredWorkers(hut.id, 0);

    const after = buildLabour(simulation, t).posts[0]!;
    expect(after.desired).toBe(0);
    expect(after.staffed).toBe(0);
    expect(after.workers).toEqual([]);
  });

  it('hands the people back to the labourers', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);
    const employed = buildLabour(simulation, t).summary.labourers;

    simulation.setDesiredWorkers(hut.id, 0);

    expect(buildLabour(simulation, t).summary.labourers).toBeGreaterThan(employed);
  });
});

describe('who is at the post', () => {
  it('names them', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY);

    const post = buildLabour(simulation, t).posts[0]!;
    expect(post.workers.length).toBe(post.staffed);
    for (const worker of post.workers) {
      expect(worker.name.length).toBeGreaterThan(0);
    }
  });

  it('says nothing about a level nobody has reached', () => {
    // A first-day forager is not an apprentice yet, and calling them one would
    // make the whole ladder meaningless.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY);

    for (const worker of buildLabour(simulation, t).posts[0]!.workers) {
      expect(worker.level).toBe('');
      expect(worker.isSpecialist).toBe(false);
    }
  });

  it('names the level once somebody has earned it, specialists first', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);

    const staff = [...hut.workers];
    expect(staff.length).toBeGreaterThan(1);
    // The second one on the list is the master, so "specialists first" has
    // something to actually reorder.
    const master = simulation.villagers.all.find((villager) => villager.id === staff[1])!;
    master.experience.set('gatherer-hut', SKILL_THRESHOLD_DAYS.master);
    // She is not first in the building's own order, so the row below is a real
    // reordering rather than the list happening to come out that way.
    expect(hut.workers[0]).not.toBe(master.id);

    const workers = buildLabour(simulation, t).posts[0]!.workers;
    expect(workers[0]?.id).toBe(master.id);
    expect(workers[0]?.level).toBe(t('skill.master'));
    expect(workers[0]?.isSpecialist).toBe(true);
  });
});

describe('the count at the top', () => {
  it('counts only people who may hold a post', () => {
    // Children under fourteen and elders over sixty cannot work, and a workforce
    // figure that included them would promise hands the settlement has not got.
    const simulation = new Simulation(OPTIONS);
    const workforce = simulation.villagers.all.filter((villager) => villager.canWork).length;
    expect(buildLabour(simulation, t).summary.workforce).toBe(workforce);
    expect(workforce).toBeLessThanOrEqual(simulation.villagers.count);
  });

  it('adds up: everybody at a post, plus the labourers, is the workforce', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    raise(simulation, 'woodcutter');
    run(simulation, TICKS_PER_DAY * 2);

    const summary = buildLabour(simulation, t).summary;
    expect(summary.employed + summary.labourers).toBe(summary.workforce);
  });
});

function run(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
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
