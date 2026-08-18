/**
 * What the build menu offers.
 *
 * The menu is generated from `data/buildings.ts` so that adding a building
 * never means writing menu code. The risk that creates is the opposite one: a
 * building added to the data and quietly missing from the menu, or landing in a
 * group where nobody would look for it. Neither fails anything at build time,
 * and both are invisible until a player goes hunting for a Tailor.
 *
 * So the property tested hardest is **completeness**: every building reachable,
 * exactly once, under a heading that names it.
 */

import { describe, expect, it } from 'vitest';

import {
  BUILDING_CATEGORIES,
  BUILDING_IDS,
  buildingDefinition,
  type BuildingId,
} from '@/data/buildings';
import { RESOURCE_IDS, type ResourceId } from '@/data/resources';
import { EN, type MessageKey } from '@/ui/i18n/messages';
import { buildMenuGroups, type Stores } from '@/ui/build-menu/buildMenuModel';

const t = (key: MessageKey): string => {
  const value = (EN as Record<string, string | undefined>)[key];
  if (value === undefined) {
    throw new Error(`No English string for ${key}`);
  }
  return value;
};

function stores(contents: Partial<Record<ResourceId, number>> = {}): Stores {
  const full = {} as Record<ResourceId, number>;
  for (const id of RESOURCE_IDS) {
    full[id] = contents[id] ?? 0;
  }
  return full;
}

const EMPTY = stores();
const STOCKED = stores({ logs: 100, stone: 100, iron: 100, hides: 100, food: 100 });

describe('grouping', () => {
  it('offers every building exactly once', () => {
    // A building in the data and not in the menu is unreachable, and nothing
    // else in the codebase would notice.
    //
    // Except the ones the data says are placed on a cell the player has already
    // tapped: a bridge is offered on the panel for its own square of river,
    // because siting one by eye with a floating outline is worse in every way
    // and a fifth card in a group turns the menu back into a scroller.
    const offered = buildMenuGroups(EMPTY, t)
      .flatMap((group) => group.options)
      .map((option) => option.id)
      .sort();
    const fromMenu = BUILDING_IDS.filter(
      (id) => buildingDefinition(id).placement !== 'cell',
    ).sort();

    expect(offered).toEqual(fromMenu);
    expect(fromMenu.length).toBeLessThan(BUILDING_IDS.length);
  });

  it('puts each building in the group its data names', () => {
    for (const group of buildMenuGroups(EMPTY, t)) {
      for (const option of group.options) {
        expect(buildingDefinition(option.id).category).toBe(group.id);
      }
    }
  });

  it('lists the groups in the declared order', () => {
    expect(buildMenuGroups(EMPTY, t).map((group) => group.id)).toEqual(BUILDING_CATEGORIES);
  });

  it('leaves no group empty', () => {
    // A category button that opens onto nothing is a dead control. If a group
    // ever empties out it should be deleted, not shipped.
    for (const group of buildMenuGroups(EMPTY, t)) {
      expect(group.options.length).toBeGreaterThan(0);
    }
  });

  it('keeps every group small enough to read without scrolling', () => {
    // The whole reason for grouping. Four cards is two rows on a phone held
    // upright; more than that and the panel is a scroller again.
    for (const group of buildMenuGroups(EMPTY, t)) {
      expect(group.options.length).toBeLessThanOrEqual(4);
    }
  });

  it('names every group and every building', () => {
    for (const group of buildMenuGroups(EMPTY, t)) {
      expect(group.title).not.toMatch(/^build\./);
      for (const option of group.options) {
        expect(option.name).not.toMatch(/^building\./);
        expect(option.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('puts the house in shelter and the school in the settlement', () => {
    // Two anchors, so a future reshuffle has to be deliberate: the house is
    // the most-built thing in the game and the school is the way home.
    expect(find(EMPTY, 'house').group).toBe('shelter');
    expect(find(EMPTY, 'school').group).toBe('settlement');
  });
});

describe('what a card costs', () => {
  it('reads the price straight out of the definition', () => {
    const option = find(STOCKED, 'house').option;
    const definition = buildingDefinition('house');

    expect(option.cost.map((part) => [part.resource, part.amount])).toEqual(
      definition.constructionCost.map((entry) => [entry.resource, entry.amount]),
    );
  });

  it('names the resource in the player’s language', () => {
    expect(find(STOCKED, 'house').option.cost[0]?.text).toBe(`8 ${t('hud.logs')}`);
  });

  it('marks a material the settlement has none of', () => {
    // The difference between "nearly" and "not until you have found iron".
    const school = find(stores({ logs: 100, stone: 100 }), 'school').option;
    const iron = school.cost.find((part) => part.resource === 'iron');

    expect(iron?.missing).toBe(true);
    expect(school.cost.find((part) => part.resource === 'logs')?.missing).toBe(false);
  });

  it('marks nothing when the stores cover it', () => {
    for (const part of find(STOCKED, 'school').option.cost) {
      expect(part.missing).toBe(false);
    }
  });

  it('calls a building out of reach only when none of its cost is in store', () => {
    expect(find(EMPTY, 'school').option.outOfReach).toBe(true);
    expect(find(stores({ logs: 1 }), 'school').option.outOfReach).toBe(false);
    expect(find(STOCKED, 'school').option.outOfReach).toBe(false);
  });

  it('never calls a free building out of reach', () => {
    // Nothing costs nothing today, but a building that did would be buildable
    // by definition, and "out of reach" on it would be nonsense.
    for (const group of buildMenuGroups(EMPTY, t)) {
      for (const option of group.options) {
        if (option.cost.length === 0) {
          expect(option.outOfReach).toBe(false);
        }
      }
    }
  });
});

function find(stock: Stores, id: BuildingId) {
  for (const group of buildMenuGroups(stock, t)) {
    const option = group.options.find((entry) => entry.id === id);
    if (option) {
      return { group: group.id, option };
    }
  }
  throw new Error(`the build menu never offers ${id}`);
}
