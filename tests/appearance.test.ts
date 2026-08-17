/**
 * Telling one villager from another, on the map and in the panels.
 *
 * **A settlement of thirty was thirty of the same hooded figure.** Age and sex
 * exist in the simulation and matter to it — who may work, who may bear children,
 * who has earned the walk about the village — and could not be seen at all.
 *
 * The rule tested here is small and load-bearing: **age decides before sex**, and
 * a person's colour never changes. Both matter because the same rule feeds two
 * pictures — the sprite on the ground and the portrait in the panel — and a
 * villager who looked like two different people in the two places would be worse
 * than one who looked like everybody else.
 *
 * The drawing itself is reviewed by looking at it. What a test can protect is
 * that the *choice* is right and stable.
 */

import { describe, expect, it } from 'vitest';

import { ADULT_AGE, RETIREMENT_AGE, WORKING_AGE } from '@/data/population';
import {
  PERSON_COLOURS,
  VILLAGER_LOOKS,
  colourFor,
  colourIndexFor,
  cssColour,
  lookFor,
} from '@/shared/appearance';
import { Simulation } from '@/simulation/Simulation';

const OPTIONS = { seed: 20260816, worldWidth: 48, worldHeight: 48, startingVillagers: 10 };

const person = (age: number, sex: 'f' | 'm', id = 1) => ({ id, age, sex });

describe('which figure', () => {
  it('draws anybody below adulthood as a child', () => {
    expect(lookFor(person(2, 'f'))).toBe('child');
    expect(lookFor(person(ADULT_AGE - 1, 'm'))).toBe('child');
  });

  it('still draws a working fourteen-year-old as a child', () => {
    // **Age decides before anything else.** A fourteen-year-old may hold a post,
    // and a settlement whose workshops are staffed by children should look like
    // one — that is the thing the player needs to notice.
    expect(WORKING_AGE).toBeLessThan(ADULT_AGE);
    expect(lookFor(person(WORKING_AGE, 'f'))).toBe('child');
  });

  it('draws a grown villager as a woman or a man', () => {
    expect(lookFor(person(30, 'f'))).toBe('woman');
    expect(lookFor(person(30, 'm'))).toBe('man');
  });

  it('draws anybody past retirement as an elder, whichever they are', () => {
    expect(lookFor(person(RETIREMENT_AGE, 'f'))).toBe('elder');
    expect(lookFor(person(RETIREMENT_AGE + 12, 'm'))).toBe('elder');
  });

  it('only ever names a figure that exists', () => {
    for (let age = 0; age < 90; age += 1) {
      for (const sex of ['f', 'm'] as const) {
        expect(VILLAGER_LOOKS).toContain(lookFor(person(age, sex)));
      }
    }
  });
});

describe('which colour', () => {
  it('gives everybody one of the settlement palette', () => {
    for (let id = 0; id < 50; id += 1) {
      expect(PERSON_COLOURS).toContain(colourFor(person(30, 'f', id)));
      expect(colourIndexFor(person(30, 'f', id))).toBeLessThan(PERSON_COLOURS.length);
    }
  });

  it('never changes it, however old they get', () => {
    // The whole reason it is worth having: a colour that shifted with a birthday
    // would tell the player nothing at all.
    const young = colourFor(person(7, 'f', 12));
    const grown = colourFor(person(34, 'f', 12));
    const old = colourFor(person(71, 'f', 12));
    expect(grown).toBe(young);
    expect(old).toBe(young);
  });

  it('spreads a real settlement across the palette', () => {
    // Six colours and ten founders: if they all came out the same the palette
    // would be decoration rather than a way of telling people apart.
    const simulation = new Simulation(OPTIONS);
    const used = new Set(simulation.villagers.all.map((villager) => colourFor(villager)));
    expect(used.size).toBeGreaterThan(1);
  });

  it('writes the same colour the panels can use', () => {
    expect(cssColour(0x8a7a5c)).toBe('#8a7a5c');
    // Leading zeroes survive: a colour that came out `#8a7a5` would be a
    // different colour, quietly.
    expect(cssColour(0x0a0b0c)).toBe('#0a0b0c');
  });
});

describe('a settlement of real people', () => {
  it('gives every villager a figure and a colour', () => {
    const simulation = new Simulation(OPTIONS);
    for (const villager of simulation.villagers.all) {
      expect(VILLAGER_LOOKS).toContain(lookFor(villager));
      expect(PERSON_COLOURS).toContain(colourFor(villager));
    }
  });
});
