/**
 * The people under a building's panel.
 *
 * **A workshop used to be a number.** "Workers 2/2" answers how many and nothing
 * else — not who, not that one of the two is fourteen, not that the settlement
 * has just put its only master forager on a woodpile. The cards name them.
 *
 * What is worth testing is which people a building answers for and what the card
 * claims about them. A card that named the wrong trade, or called a first-day
 * forager an apprentice, would be the panel inventing a settlement.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import { ADULT_AGE, RETIREMENT_AGE } from '@/data/population';
import { SKILL_THRESHOLD_DAYS } from '@/data/skills';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { CARD_COLOURS, cardsFor, hasCards } from '@/ui/hud/cardModel';

const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('who a building answers for', () => {
  it('names the people at a workshop', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);

    const cards = cardsFor(simulation, hut.id);
    expect(cards.length).toBe(hut.workers.length);
    expect(cards.map((card) => card.id).sort()).toEqual([...hut.workers].sort());
  });

  it('names the family under a house', () => {
    // Same problem as a workshop's: "Residents 3/4" is a number about people.
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house')!;
    run(simulation, TICKS_PER_DAY);

    const living = simulation.villagers.all.filter((villager) => villager.homeId === house.id);
    expect(living.length).toBeGreaterThan(0);
    expect(
      cardsFor(simulation, house.id)
        .map((card) => card.id)
        .sort(),
    ).toEqual(living.map((villager) => villager.id).sort());
  });

  it('has nobody to show for a site still going up', () => {
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'gatherer-hut')!;
    expect(cardsFor(simulation, site.id)).toEqual([]);
  });

  it('has nobody to show for a building that is neither', () => {
    // A cemetery has no posts and no beds.
    expect(hasCards('cemetery')).toBe(false);
    expect(hasCards('gatherer-hut')).toBe(true);
    expect(hasCards('house')).toBe(true);
  });

  it('says nothing about a building that is not there', () => {
    expect(cardsFor(new Simulation(OPTIONS), 9999)).toEqual([]);
  });
});

describe('what a card claims', () => {
  it('gives a name, an age and a face', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);

    for (const card of cardsFor(simulation, hut.id)) {
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.age).toBeGreaterThan(0);
      expect(['child', 'woman', 'man', 'elder']).toContain(card.portrait);
      expect(CARD_COLOURS).toContain(card.colour);
    }
  });

  it('picks the face from the age first and the sex second', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house')!;
    run(simulation, TICKS_PER_DAY);
    const living = simulation.villagers.all.filter((villager) => villager.homeId === house.id);
    const person = living[0]!;

    person.age = 8;
    expect(cardFor(simulation, house.id, person.id).portrait).toBe('child');

    person.age = RETIREMENT_AGE + 4;
    expect(cardFor(simulation, house.id, person.id).portrait).toBe('elder');

    person.age = ADULT_AGE + 10;
    expect(cardFor(simulation, house.id, person.id).portrait).toBe(
      person.sex === 'f' ? 'woman' : 'man',
    );
  });

  it('keeps the same colour for the same person', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);

    const first = cardsFor(simulation, hut.id);
    run(simulation, TICKS_PER_DAY);
    const later = cardsFor(simulation, hut.id);

    for (const card of first) {
      const same = later.find((entry) => entry.id === card.id);
      if (same) {
        expect(same.colour).toBe(card.colour);
      }
    }
  });

  it('claims no level for somebody who has not earned one', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);

    for (const card of cardsFor(simulation, hut.id)) {
      expect(card.level).toBe('none');
      expect(card.trade).toBeNull();
      expect(card.years).toBe(0);
    }
  });

  it('names the level once it is earned, at this trade', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);

    const worker = simulation.villagers.all.find((villager) => villager.id === hut.workers[0])!;
    worker.experience.set('gatherer-hut', SKILL_THRESHOLD_DAYS.master);
    // Experience at some *other* trade must not appear on this card: a master
    // mason foraging is a forager, whatever else she can do.
    worker.experience.set('quarry', SKILL_THRESHOLD_DAYS.master * 2);

    const card = cardsFor(simulation, hut.id).find((entry) => entry.id === worker.id)!;
    expect(card.level).toBe('master');
    expect(card.trade).toBe('gatherer-hut');
    expect(card.years).toBeGreaterThanOrEqual(5);
  });

  it('puts the most experienced first', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);
    expect(hut.workers.length).toBeGreaterThan(1);

    const second = simulation.villagers.all.find((villager) => villager.id === hut.workers[1])!;
    second.experience.set('gatherer-hut', SKILL_THRESHOLD_DAYS.expert);

    expect(cardsFor(simulation, hut.id)[0]?.id).toBe(second.id);
  });

  it('marks somebody who is unwell', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut')!;
    run(simulation, TICKS_PER_DAY);

    const worker = simulation.villagers.all.find((villager) => villager.id === hut.workers[0])!;
    worker.illDaysRemaining = 5;

    expect(cardsFor(simulation, hut.id).find((card) => card.id === worker.id)?.isIll).toBe(true);
  });
});

/** The card for one person under one building, for the tests that want just it. */
function cardFor(simulation: Simulation, buildingId: number, villagerId: number) {
  const card = cardsFor(simulation, buildingId).find((entry) => entry.id === villagerId);
  if (!card) {
    throw new Error(`No card for villager ${villagerId} under building ${buildingId}`);
  }
  return card;
}

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
