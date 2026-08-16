/**
 * The people panel, checked against the settlement it claims to describe.
 *
 * This panel makes *claims about people* — who lives with whom, who is
 * somebody's child, who works where, how they are doing. A layout bug is
 * embarrassing; a claim that quietly goes wrong is the game lying to the
 * player, and they have no way to tell.
 *
 * The one that needs stating loudest: **tools and clothing are not per person.**
 * The survival system works out what fraction of the day's demand the stores
 * covered and applies that same fraction to everybody. A tick beside one
 * villager saying "has tools" would be an invention, so the panel reports the
 * coverage once for the settlement and says so in as many words.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { EN, type MessageKey } from '@/ui/i18n/messages';
import {
  AUTOMATIC,
  buildRoster,
  workPreferenceFrom,
  workValue,
  type RosterView,
} from '@/ui/roster/rosterModel';
import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

const t = (key: MessageKey): string => {
  const value = (EN as Record<string, string | undefined>)[key];
  if (value === undefined) {
    throw new Error(`No English string for ${key}`);
  }
  return value;
};

function everyone(view: RosterView) {
  return view.households.flatMap((household) => household.people);
}

describe('who the panel lists', () => {
  it('accounts for every living villager exactly once', () => {
    // A roster that loses somebody is worse than no roster: the player would
    // be planning around a settlement that is not the one they have.
    const simulation = new Simulation(OPTIONS);
    const view = buildRoster(simulation, t);

    const listed = everyone(view)
      .map((person) => person.id)
      .sort((a, b) => a - b);
    expect(listed).toEqual(
      simulation.villagers.all.map((villager) => villager.id).sort((a, b) => a - b),
    );
  });

  it('keeps counting everyone once the settlement has houses', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'house');
    raise(simulation, 'house');
    for (let tick = 1; tick <= TICKS_PER_DAY * 3; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
    }

    const view = buildRoster(simulation, t);
    expect(everyone(view)).toHaveLength(simulation.villagers.all.length);
  });

  it('gathers a household under one roof', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'house');
    for (let tick = 1; tick <= TICKS_PER_DAY * 2; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
    }

    const view = buildRoster(simulation, t);
    const housed = view.households.filter((household) => household.homeId !== null);
    expect(housed.length).toBeGreaterThan(0);
    for (const household of housed) {
      for (const person of household.people) {
        const villager = simulation.villagers.all.find((v) => v.id === person.id)!;
        expect(villager.homeId).toBe(household.homeId);
      }
    }
  });

  it('puts the people with no roof in their own group', () => {
    // The group the player most needs to see, so it is never mixed in.
    const simulation = new Simulation(OPTIONS);
    const view = buildRoster(simulation, t);

    const roofless = view.households.find((household) => household.homeId === null);
    expect(roofless).toBeDefined();
    expect(roofless?.title).toBe(EN['roster.noHome']);
    expect(roofless?.people.length).toBe(simulation.villagers.all.length);
  });

  it('lists a household oldest first', () => {
    const simulation = new Simulation(OPTIONS);
    const view = buildRoster(simulation, t);
    for (const household of view.households) {
      const ages = household.people.map((person) => person.age);
      expect(ages).toEqual([...ages].sort((a, b) => b - a));
    }
  });
});

describe('what it says about a person', () => {
  it('reports needs as whole numbers a player can read', () => {
    const simulation = new Simulation(OPTIONS);
    const villager = simulation.villagers.all[0]!;
    villager.needs.hunger = 63.7;

    const person = everyone(buildRoster(simulation, t)).find((p) => p.id === villager.id)!;
    expect(person.needs.hunger).toBe(64);
  });

  it('names the building somebody works at', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    for (let tick = 1; tick <= TICKS_PER_DAY; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
    }

    const employed = simulation.villagers.all.find((v) => v.employerId === hut.id);
    expect(employed).toBeDefined();
    const person = everyone(buildRoster(simulation, t)).find((p) => p.id === employed!.id)!;
    expect(person.job).toBe(EN['building.gatherer-hut']);
  });

  it('calls everybody else a labourer rather than unemployed', () => {
    const simulation = new Simulation(OPTIONS);
    const person = everyone(buildRoster(simulation, t))[0]!;
    expect(person.job).toBe(EN['villager.labourer']);
  });

  it('marks somebody who is unwell', () => {
    const simulation = new Simulation(OPTIONS);
    simulation.villagers.all[0]!.illDaysRemaining = 5;

    const person = everyone(buildRoster(simulation, t)).find(
      (p) => p.id === simulation.villagers.all[0]!.id,
    )!;
    expect(person.isIll).toBe(true);
  });

  it('says what somebody is carrying, and nothing when their hands are empty', () => {
    const simulation = new Simulation(OPTIONS);
    const villager = simulation.villagers.all[0]!;
    expect(everyone(buildRoster(simulation, t))[0]?.carrying).toBeNull();

    villager.inventory.add('logs', 4);
    const person = everyone(buildRoster(simulation, t)).find((p) => p.id === villager.id)!;
    expect(person.carrying).toContain('4');
    expect(person.carrying).toContain(EN['hud.logs']);
  });
});

describe('what it says about a family', () => {
  it('names a partner', () => {
    const simulation = new Simulation(OPTIONS);
    for (let tick = 1; tick <= TICKS_PER_DAY * 2; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
    }

    const paired = simulation.villagers.all.find((v) => v.partnerId !== null);
    expect(paired).toBeDefined();
    if (!paired) {
      return;
    }
    const partnerName = simulation.villagers.all.find((v) => v.id === paired.partnerId)!.name;
    const person = everyone(buildRoster(simulation, t)).find((p) => p.id === paired.id)!;
    expect(person.partner).toBe(partnerName);
  });

  it('names both parents, or neither', () => {
    // Half a lineage reads as a bug rather than as somebody whose other parent
    // has died, so a child with one surviving parent shows no parents at all.
    const simulation = new Simulation(OPTIONS);
    const [first, second] = simulation.villagers.all;
    const child = simulation.villagers.bear({ gx: 30, gy: 30 }, 1, [first!.id, second!.id]);

    const person = everyone(buildRoster(simulation, t)).find((p) => p.id === child.id)!;
    expect(person.parents).toBe(`${first!.name} & ${second!.name}`);
  });

  it('lists somebody’s children under them', () => {
    const simulation = new Simulation(OPTIONS);
    const [first, second] = simulation.villagers.all;
    const child = simulation.villagers.bear({ gx: 30, gy: 30 }, 1, [first!.id, second!.id]);

    const parent = everyone(buildRoster(simulation, t)).find((p) => p.id === first!.id)!;
    expect(parent.children).toContain(child.name);
  });

  it('shows no family for a founder', () => {
    const simulation = new Simulation(OPTIONS);
    const person = everyone(buildRoster(simulation, t))[0]!;
    expect(person.parents).toBeNull();
    expect(person.children).toEqual([]);
  });
});

describe('the work picker', () => {
  it('offers automatic, labourer and every workplace', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    raise(simulation, 'woodcutter');

    const view = buildRoster(simulation, t);
    expect(view.options[0]?.value).toBe(AUTOMATIC);
    expect(view.options[1]?.value).toBe('labourer');
    expect(view.options.length).toBe(4);
  });

  it('leaves out buildings nobody could work at', () => {
    // A storage yard employs nobody, so offering it would be offering a choice
    // the simulation refuses.
    const simulation = new Simulation(OPTIONS);
    const yard = raise(simulation, 'storage-yard');
    const view = buildRoster(simulation, t);
    expect(view.options.some((option) => option.value === String(yard?.id))).toBe(false);
  });

  it('numbers workshops of the same trade so they can be told apart', () => {
    // Three huts all called "Gatherer Hut" is a picker the player cannot use.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    raise(simulation, 'gatherer-hut');

    const labels = buildRoster(simulation, t).options.map((option) => option.label);
    expect(labels).toContain(`${EN['building.gatherer-hut']} 1`);
    expect(labels).toContain(`${EN['building.gatherer-hut']} 2`);
  });

  it('offers a building still going up, and says so', () => {
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'woodcutter');
    const option = buildRoster(simulation, t).options.find(
      (candidate) => candidate.value === String(site?.id),
    );
    expect(option).toBeDefined();
    expect(option?.label).toContain(EN['roster.beingBuilt']);
  });

  it('shows what the player asked for, not where they ended up', () => {
    const simulation = new Simulation(OPTIONS);
    const villager = simulation.villagers.all[0]!;
    simulation.setWorkPreference(villager.id, 'labourer');

    const person = everyone(buildRoster(simulation, t)).find((p) => p.id === villager.id)!;
    expect(person.work).toBe('labourer');
  });

  it('round-trips every value the picker can hold', () => {
    expect(workPreferenceFrom(workValue(null))).toBeNull();
    expect(workPreferenceFrom(workValue('labourer'))).toBe('labourer');
    expect(workPreferenceFrom(workValue(42))).toBe(42);
    // Whatever a browser might hand back, "automatic" is the safe reading.
    expect(workPreferenceFrom('nonsense')).toBeNull();
  });
});

describe('the settlement summary', () => {
  it('counts adults, children and the roofless', () => {
    const simulation = new Simulation(OPTIONS);
    const view = buildRoster(simulation, t);
    expect(view.summary.people).toBe(simulation.villagers.all.length);
    expect(view.summary.adults + view.summary.children).toBe(view.summary.people);
    expect(view.summary.homeless).toBe(
      simulation.villagers.all.filter((villager) => villager.homeId === null).length,
    );
  });

  it('reports tools and coats as settlement-wide coverage', () => {
    // The honest presentation of a shared pool. If these ever become per-person
    // this test should fail and the panel should change with the model.
    const simulation = new Simulation(OPTIONS);
    const view = buildRoster(simulation, t);
    expect(view.summary.toolCoverage).toBeGreaterThanOrEqual(0);
    expect(view.summary.toolCoverage).toBeLessThanOrEqual(1);
    expect(view.summary.clothingCoverage).toBeGreaterThanOrEqual(0);
    expect(view.summary.clothingCoverage).toBeLessThanOrEqual(1);
    expect(EN['roster.suppliesNote']).toContain('settlement-wide');
  });

  it('survives a settlement with nobody left in it', () => {
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 0 });
    const view = buildRoster(simulation, t);
    expect(view.households).toEqual([]);
    expect(view.summary.people).toBe(0);
  });
});

// --- helpers ---------------------------------------------------------------

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
