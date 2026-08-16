/**
 * The instructions, checked against the game they describe.
 *
 * A written guide rots. Someone adds a building, changes a cost, renames a
 * resource, and the page that explains the game quietly starts lying — and
 * nothing fails, because prose does not compile. The brief is explicit that
 * documentation must describe reality, and an in-game guide is the piece of
 * documentation a player is most likely to read.
 *
 * So the guide is generated from the same data tables the game runs on, and
 * these tests hold it to that: every building covered, every resource covered,
 * the costs matching the definitions, and — the failure mode a cast to
 * `MessageKey` hides — no missing strings in either language.
 */

import { describe, expect, it } from 'vitest';

import { BUILDING_IDS, buildingDefinition } from '@/data/buildings';
import { RESOURCE_IDS } from '@/data/resources';
import { SEASONS } from '@/simulation/seasons/SeasonClock';
import { EN, ES, type MessageKey } from '@/ui/i18n/messages';
import { SECTION_IDS, buildGuide, type Translate } from '@/ui/guide/guideContent';

const CATALOGUES = { en: EN, es: ES } as const;
const LANGUAGES = ['en', 'es'] as const;

/**
 * A translator that refuses to paper over a missing key.
 *
 * The real one falls back to English so a player never sees a raw key, which is
 * right in the game and useless in a test: a Spanish guide silently rendering
 * English would pass. Here a missing key is an error.
 */
function strict(language: (typeof LANGUAGES)[number]): Translate {
  const catalogue = CATALOGUES[language] as Record<string, string | undefined>;
  return (key: MessageKey) => {
    const value = catalogue[key];
    if (value === undefined) {
      throw new Error(`${language} has no string for ${key}`);
    }
    return value;
  };
}

describe('the guide, in every language', () => {
  it.each(LANGUAGES)('%s has a string for every key it asks for', (language) => {
    // The whole point of the strict translator: `building.${id}` and friends
    // are casts, and a cast is a promise to the compiler rather than a check.
    expect(() => buildGuide(strict(language))).not.toThrow();
  });

  it.each(LANGUAGES)('%s says something in every field', (language) => {
    for (const section of buildGuide(strict(language))) {
      expect(section.title.trim(), `${section.id} title`).not.toBe('');
      if (section.body !== null) {
        expect(section.body.trim(), `${section.id} body`).not.toBe('');
      }
      for (const entry of section.entries) {
        expect(entry.term.trim(), `${section.id} term`).not.toBe('');
        expect(entry.detail.trim(), `${section.id}/${entry.term}`).not.toBe('');
        if (entry.meta !== null) {
          expect(entry.meta.trim(), `${section.id}/${entry.term} meta`).not.toBe('');
        }
      }
    }
  });

  it('covers the sections it promises, in order', () => {
    expect(buildGuide(strict('en')).map((section) => section.id)).toEqual([...SECTION_IDS]);
  });
});

describe('what the guide covers', () => {
  it('explains every building in the game', () => {
    // The test that catches the real failure: adding a building to the build
    // menu and forgetting it exists as far as the player's instructions go.
    const buildings = sectionNamed('buildings');
    expect(buildings.entries).toHaveLength(BUILDING_IDS.length);

    for (const id of BUILDING_IDS) {
      const name = EN[`building.${id}` as MessageKey];
      expect(
        buildings.entries.some((entry) => entry.term === name),
        `${id} is missing from the guide`,
      ).toBe(true);
    }
  });

  it('explains every resource in the game', () => {
    const resources = sectionNamed('resources');
    expect(resources.entries).toHaveLength(RESOURCE_IDS.length);

    for (const id of RESOURCE_IDS) {
      const name = EN[`hud.${id}` as MessageKey];
      expect(
        resources.entries.some((entry) => entry.term === name),
        `${id} is missing from the guide`,
      ).toBe(true);
    }
  });

  it('explains every season', () => {
    expect(sectionNamed('seasons').entries).toHaveLength(SEASONS.length);
  });

  it('lists buildings in build-menu order', () => {
    // Reading the guide and scanning the toolbar should be the same act. If
    // they diverge the player has to translate between two orderings.
    expect(sectionNamed('buildings').entries.map((entry) => entry.term)).toEqual(
      BUILDING_IDS.map((id) => EN[`building.${id}` as MessageKey]),
    );
  });
});

describe('what the guide says about a building', () => {
  it('quotes the cost from the definition rather than from prose', () => {
    const house = entryFor('buildings', EN['building.house']);
    for (const cost of buildingDefinition('house').constructionCost) {
      expect(house.meta).toContain(String(cost.amount));
      expect(house.meta).toContain(EN[`hud.${cost.resource}` as MessageKey]);
    }
  });

  it('says how many people a workshop employs', () => {
    const hut = entryFor('buildings', EN['building.gatherer-hut']);
    expect(buildingDefinition('gatherer-hut').workerSlots).toBeGreaterThan(0);
    expect(hut.meta).toContain(String(buildingDefinition('gatherer-hut').workerSlots));
    expect(hut.meta).toContain(EN['guide.workerSlots']);
  });

  it('says how many a house shelters, and does not call it understaffed', () => {
    // A house employing nobody is not a fact worth reporting; a workshop
    // employing nobody is, because the player will be waiting for it to start.
    const house = entryFor('buildings', EN['building.house']);
    expect(house.meta).toContain(String(buildingDefinition('house').housing));
    expect(house.meta).not.toContain(EN['guide.noWorkers']);
  });

  it('says plainly when a building employs nobody', () => {
    const yard = entryFor('buildings', EN['building.storage-yard']);
    expect(buildingDefinition('storage-yard').workerSlots).toBe(0);
    expect(yard.meta).toContain(EN['guide.noWorkers']);
  });

  it('costs match every definition, not just the ones spelled out above', () => {
    const buildings = sectionNamed('buildings');
    for (const [index, id] of BUILDING_IDS.entries()) {
      const entry = buildings.entries[index]!;
      for (const cost of buildingDefinition(id).constructionCost) {
        expect(entry.meta, `${id} cost`).toContain(String(cost.amount));
      }
    }
  });
});

// --- helpers ---------------------------------------------------------------

function sectionNamed(id: string) {
  const section = buildGuide(strict('en')).find((candidate) => candidate.id === id);
  if (!section) {
    throw new Error(`No guide section called ${id}`);
  }
  return section;
}

function entryFor(sectionId: string, term: string) {
  const entry = sectionNamed(sectionId).entries.find((candidate) => candidate.term === term);
  if (!entry) {
    throw new Error(`No guide entry called ${term} in ${sectionId}`);
  }
  return entry;
}
