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
import { LOGS_PER_TREE, RESOURCE_IDS, STONE_PER_DEPOSIT } from '@/data/resources';
import { SKILL_THRESHOLD_YEARS, SKILL_WORK_BONUS } from '@/data/skills';
import { DAYS_PER_YEAR, SEASONS } from '@/simulation/seasons/SeasonClock';
import { FOOD_PER_VILLAGER_PER_DAY, TOOL_WORK_BONUS } from '@/simulation/seasons/SurvivalSystem';
import { EN, ES, type MessageKey } from '@/ui/i18n/messages';
import { BLANK, SECTION_IDS, buildGuide, type Translate } from '@/ui/guide/guideContent';
import { annualProduction } from '@/ui/hud/productionModel';

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
      // A blank cell in a table of figures is worse than a missing table: the
      // reader concludes the game has no answer rather than that the guide has
      // a hole. Every cell, in both languages.
      for (const table of section.tables) {
        expect(table.caption.trim(), `${table.id} caption`).not.toBe('');
        for (const column of table.columns) {
          expect(column.trim(), `${table.id} column`).not.toBe('');
        }
        for (const row of table.rows) {
          expect(row.label.trim(), `${table.id} row label`).not.toBe('');
          expect(row.values, `${table.id}/${row.label} width`).toHaveLength(
            table.columns.length - 1,
          );
          for (const value of row.values) {
            expect(value.trim(), `${table.id}/${row.label} cell`).not.toBe('');
          }
        }
        if (table.note !== null) {
          expect(table.note.trim(), `${table.id} note`).not.toBe('');
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

  it('says what a workshop makes in a year, and what it eats to do it', () => {
    // Asked for in as many words: a cost and a number of workers do not tell a
    // player whether a Woodcutter will see them through a winter, and a year is
    // the unit this game is played in.
    const cutter = entryFor('buildings', EN['building.woodcutter']);
    const yearly = annualProduction('woodcutter');

    expect(cutter.output).not.toBeNull();
    expect(cutter.output).toContain(String(Math.round(yearly.outputs[0]!.perYear)));
    expect(cutter.output).toContain(String(Math.round(yearly.inputs[0]!.perYear)));
    expect(cutter.output).toContain(EN['guide.aYear']);
    expect(cutter.output).toContain(EN['guide.using']);
  });

  it('leaves the line out for anything that produces nothing', () => {
    // `null` rather than an empty string, so the renderer omits the element
    // instead of drawing a blank line under a House.
    expect(entryFor('buildings', EN['building.house']).output).toBeNull();
    expect(entryFor('buildings', EN['building.storage-yard']).output).toBeNull();
  });

  it("says a Feller's Hut is what fells the wood, and a Woodcutter is not", () => {
    // The other half of the same question, and the one a player got wrong in a
    // real game: they had a Woodcutter standing, no timber, and no way to learn
    // that felling is a different building's trade.
    const feller = entryFor('buildings', EN['building.feller']);
    expect(buildingDefinition('feller').felling).toBeDefined();
    expect(feller.meta).toContain(EN['guide.fellsOwn']);

    const cutter = entryFor('buildings', EN['building.woodcutter']);
    expect(buildingDefinition('woodcutter').felling).toBeUndefined();
    expect(cutter.meta).not.toContain(EN['guide.fellsOwn']);
  });

  it('says what a year of living costs, per villager', () => {
    // The figure the whole game turns on, and the one nothing said. A player can
    // read that a hut makes so much food a year and still not know whether that
    // feeds ten people.
    const food = entryFor('resources', EN['hud.food']);
    expect(food.meta).toContain(EN['guide.perVillagerYear']);
    expect(food.meta).toMatch(/\d+/);

    // Firewood is only the housed, and only on the days it freezes, so its
    // figure must be smaller than the food one rather than equal to it.
    const firewood = entryFor('resources', EN['hud.firewood']);
    expect(firewood.meta).toContain(EN['guide.perHousedYear']);
    const burned = Number(/\d+/.exec(firewood.meta ?? '')?.[0]);
    const eaten = Number(/\d+/.exec(food.meta ?? '')?.[0]);
    expect(burned).toBeGreaterThan(0);
    expect(burned).toBeLessThan(eaten);
  });

  it('names the building whose art belongs beside it, and only there', () => {
    // The thumbnail was asked for with "or is that too much trouble?". It is one
    // call, because the building art draws onto a plain canvas as happily as onto
    // a Phaser scene — so the guide shows the same building the map does. What
    // this half promises is only *which* building; the picture is the renderer's.
    const buildings = sectionNamed('buildings');
    for (const [index, id] of BUILDING_IDS.entries()) {
      expect(buildings.entries[index]!.art, `${id} art`).toBe(id);
    }

    // Nothing else claims a picture: there is no art for "Zoom" or for hunger,
    // and an entry that asked for one would draw a broken image.
    for (const section of buildGuide(strict('en'))) {
      if (section.id === 'buildings') {
        continue;
      }
      for (const entry of section.entries) {
        expect(entry.art, `${section.id}/${entry.term}`).toBeNull();
      }
    }
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

/**
 * The bonuses, asked for in as many words: "put them in the help".
 *
 * Every one of them was already in the game and none was anywhere a player could
 * see. A settlement that had kept the same woodcutter for five years was working
 * half again as fast with no way to know it.
 */
describe('what the guide says about the bonuses', () => {
  it('gives every bonus a name, an explanation and its figures', () => {
    const bonuses = sectionNamed('bonuses');
    expect(bonuses.entries.length).toBeGreaterThanOrEqual(6);
    for (const entry of bonuses.entries) {
      expect(entry.meta, `${entry.term} has no figures`).not.toBeNull();
      expect(entry.meta).toMatch(/\d/);
    }
  });

  it('quotes the tool bonus and the whole experience ladder from the data', () => {
    const tools = entryFor('bonuses', EN['guide.bonus.tools']);
    expect(tools.meta).toContain(`+${Math.round(TOOL_WORK_BONUS * 100)}%`);

    // All three levels, with the years each takes. A ladder with a rung missing
    // is worse than no ladder: the player plans around the two they can see.
    const experience = entryFor('bonuses', EN['guide.bonus.experience']);
    for (const level of ['apprentice', 'expert', 'master'] as const) {
      expect(experience.meta).toContain(EN[`skill.${level}`]);
      expect(experience.meta).toContain(String(SKILL_THRESHOLD_YEARS[level]));
      expect(experience.meta).toContain(`+${Math.round((SKILL_WORK_BONUS[level] - 1) * 100)}%`);
    }
  });

  it("says what a Temple answers, read from the building's own definition", () => {
    const spirit = entryFor('bonuses', EN['guide.bonus.spirit']);
    const temple = buildingDefinition('temple').solace!.share;
    expect(spirit.meta).toContain(`${Math.round(temple * 100)}%`);
    expect(spirit.meta).toContain(EN['building.temple']);
  });

  it('says a year, not years, for the one-year rung', () => {
    // 1 year, 2 years, 5 years. A single plural form prints "1 years" in both
    // languages the game speaks.
    const experience = entryFor('bonuses', EN['guide.bonus.experience']);
    expect(experience.meta).toContain(`1 ${EN['guide.bonus.year']}`);
    expect(experience.meta).toContain(`2 ${EN['guide.bonus.years']}`);
  });

  it('writes a decimal the way each language writes it', () => {
    // A coat lasts years, so its yearly cost is a fraction — the first
    // fractional figure in the game, and Spanish writes it with a comma.
    const english = entryFor('bonuses', EN['guide.bonus.coats']);
    expect(english.meta).toMatch(/\d\.\d/);

    const spanish = buildGuide(strict('es'))
      .find((section) => section.id === 'bonuses')!
      .entries.find((entry) => entry.term === ES['guide.bonus.coats'])!;
    expect(spanish.meta).toMatch(/\d,\d/);
    expect(spanish.meta).not.toMatch(/\d\.\d/);
  });
});

/**
 * The reference tables, asked for by a player who could not plan a settlement.
 *
 * The guide could already say what one building makes. What it could not do was
 * let two be compared, or answer "and what does that feed?" — and neither
 * question can be answered by prose, only by a column.
 */
describe('the figures at the end', () => {
  it('gives every building a row, including the ones that make nothing', () => {
    // Every building, deliberately: that a Cemetery produces nothing is a fact
    // worth being able to check, and a table that dropped its empty rows would
    // leave the reader wondering whether they had missed one.
    const table = tableNamed('figures', 'buildings');
    expect(table.rows).toHaveLength(BUILDING_IDS.length);
    expect(table.rows.map((row) => row.label)).toEqual(
      BUILDING_IDS.map((id) => EN[`building.${id}` as MessageKey]),
    );
  });

  it('quotes the yearly figures from the same model the panels use', () => {
    const table = tableNamed('figures', 'buildings');
    const row = table.rows[BUILDING_IDS.indexOf('woodcutter')]!;
    const yearly = annualProduction('woodcutter');

    expect(row.values[0]).toContain(String(Math.round(yearly.outputs[0]!.perYear)));
    expect(row.values[1]).toContain(String(Math.round(yearly.inputs[0]!.perYear)));
    expect(row.values[2]).toBe(String(buildingDefinition('woodcutter').workerSlots));
  });

  it('says a felling building makes timber rather than nothing', () => {
    // A Feller's Hut has no recipe, so `annualProduction` has nothing to say
    // about it. Left blank the table would read as "this building is useless".
    const table = tableNamed('figures', 'buildings');
    const feller = table.rows[BUILDING_IDS.indexOf('feller')]!;
    expect(feller.values[0]).toBe(EN['guide.figures.timber']);

    const house = table.rows[BUILDING_IDS.indexOf('house')]!;
    expect(house.values[0]).toBe(BLANK);
  });

  it('says what a tree and a rock face give up', () => {
    // The conversion the first hour of every game needs: eight logs is two
    // trees, which nothing anywhere said.
    const table = tableNamed('figures', 'land');
    expect(table.rows[0]!.values[0]).toContain(String(LOGS_PER_TREE));
    expect(table.rows[1]!.values[0]).toContain(String(STONE_PER_DEPOSIT));
  });

  it('says what a year of living draws, and who pays each cost', () => {
    const table = tableNamed('figures', 'people');
    const labels = table.rows.map((row) => row.label);
    for (const resource of ['food', 'firewood', 'clothing', 'tools'] as const) {
      expect(labels, `${resource} is missing`).toContain(EN[`hud.${resource}` as MessageKey]);
    }

    const food = table.rows[labels.indexOf(EN['hud.food'])]!;
    expect(Number(food.values[0])).toBe(FOOD_PER_VILLAGER_PER_DAY * DAYS_PER_YEAR);
    expect(food.values[1]).toBe(EN['guide.figures.everyone']);

    // Firewood is only the housed, and only on freezing days, so it must come
    // out well under the food figure rather than equal to it.
    const firewood = table.rows[labels.indexOf(EN['hud.firewood'])]!;
    expect(Number(firewood.values[0])).toBeGreaterThan(0);
    expect(Number(firewood.values[0])).toBeLessThan(Number(food.values[0]));
    expect(firewood.values[1]).toBe(EN['guide.figures.everyoneHoused']);

    // A coat lasts years, so its yearly figure is a fraction. Rounded to a whole
    // number it would print as `0` and read as free.
    const clothing = table.rows[labels.indexOf(EN['hud.clothing'])]!;
    expect(Number(clothing.values[0])).toBeGreaterThan(0);
    expect(Number(clothing.values[0])).toBeLessThan(10);

    // The length of the year and the count of freezing days: every figure above
    // is derived from them and neither is a row.
    expect(table.note).toContain(String(DAYS_PER_YEAR));
  });

  it('reads the same in Spanish, down to the row order', () => {
    const spanish = buildGuide(strict('es')).find((section) => section.id === 'figures')!;
    const english = tableNamed('figures', 'buildings');
    const translated = spanish.tables.find((table) => table.id === 'buildings')!;

    expect(translated.rows).toHaveLength(english.rows.length);
    expect(translated.rows.map((row) => row.label)).toEqual(
      BUILDING_IDS.map((id) => ES[`building.${id}` as MessageKey]),
    );
    // The figures are figures in any language; only the goods beside them change.
    expect(translated.rows[BUILDING_IDS.indexOf('woodcutter')]!.values[0]).toContain(
      ES['hud.firewood'].toLocaleLowerCase(),
    );
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

function tableNamed(sectionId: string, tableId: string) {
  const table = sectionNamed(sectionId).tables.find((candidate) => candidate.id === tableId);
  if (!table) {
    throw new Error(`No table called ${tableId} in ${sectionId}`);
  }
  return table;
}

function entryFor(sectionId: string, term: string) {
  const entry = sectionNamed(sectionId).entries.find((candidate) => candidate.term === term);
  if (!entry) {
    throw new Error(`No guide entry called ${term} in ${sectionId}`);
  }
  return entry;
}
