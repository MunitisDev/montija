/**
 * What the guide says, as data rather than as markup.
 *
 * The point of separating it is that the interesting half is **generated from
 * the game's own data tables**. Every building in `data/buildings.ts` and every
 * resource in `data/resources.ts` appears here automatically, with its real
 * cost and its real staffing, so a guide cannot quietly fall out of step with
 * the game the way a hand-written page would. Adding a building adds a guide
 * entry; changing its cost changes what the guide says it costs.
 *
 * It is also the only shape this could take and still be tested. The test
 * environment is Node with no DOM, and a page assembled directly into elements
 * could only be checked by a human reading it. As data it can be asserted
 * against: every building covered, every resource covered, nothing blank.
 *
 * The prose half — the objective, the loop, the controls — is translated text
 * rather than generated, because no data table knows why a settlement is worth
 * building.
 */

import {
  BUILDING_IDS,
  buildingDefinition,
  type BuildingDefinition,
  type BuildingId,
} from '@/data/buildings';
import { LOGS_PER_TREE, RESOURCE_IDS, STONE_PER_DEPOSIT, type ResourceId } from '@/data/resources';
import { annualProduction, type AnnualRate } from '@/ui/hud/productionModel';
import {
  DAYS_PER_SEASON,
  DAYS_PER_YEAR,
  SEASONS,
  TICKS_PER_DAY,
  yearStateAt,
} from '@/simulation/seasons/SeasonClock';
import {
  CLOTHING_PER_VILLAGER_PER_COLD_DAY,
  FIREWOOD_PER_VILLAGER_PER_COLD_DAY,
  FOOD_PER_VILLAGER_PER_DAY,
  TOOLS_PER_WORKER_PER_DAY,
} from '@/simulation/seasons/SurvivalSystem';
import { yearFigure } from '@/ui/format/rates';
import type { MessageKey } from '@/ui/i18n/messages';

/** Looks a string up. The guide never touches `I18n` directly, so it tests. */
export type Translate = (key: MessageKey) => string;

export interface GuideEntry {
  readonly term: string;
  readonly detail: string;
  /**
   * The facts, when there are any: what a building costs and who staffs it.
   *
   * `null` rather than an empty string, so a renderer can leave the element out
   * instead of emitting a blank line.
   */
  readonly meta: string | null;
  /**
   * What a building makes in a year, when there is anything to say.
   *
   * A second line rather than more of {@link meta}, because it answers a
   * different question. The cost and the staffing are what a building *is*; the
   * yearly figure is what it is *for*, and it is the number a player planning a
   * winter needs to be able to find without doing arithmetic.
   *
   * `null` for a house, a yard, a cemetery — anything that produces nothing.
   */
  readonly output: string | null;
}

/**
 * One line of a reference table: a heading cell and the figures beside it.
 *
 * `values` lines up with its table's `columns` from the second onwards. A blank
 * is {@link BLANK} rather than an empty string, because a table whose empty
 * cells are invisible reads as a table with missing rows.
 */
export interface GuideTableRow {
  readonly label: string;
  readonly values: readonly string[];
}

/**
 * A block of figures, as opposed to a list of explanations.
 *
 * **A different shape from {@link GuideEntry} because it answers a different
 * kind of question.** An entry says what a thing is, in a sentence. A table says
 * what a thing *costs*, in a column a reader can run their eye down and compare.
 * "Which of these two feeds more people" is not a question prose can answer.
 *
 * Generated from the same tables the simulation runs on, like everything else in
 * this file, so the figures cannot drift from the game.
 */
export interface GuideTable {
  readonly id: string;
  readonly caption: string;
  /** Column headings. The first names the row-label column. */
  readonly columns: readonly string[];
  readonly rows: readonly GuideTableRow[];
  /**
   * A line under the table, for the caveat a column cannot hold.
   *
   * `null` when there is nothing to add. Used for the length of the year and
   * the count of freezing days, which every figure in the household table is
   * derived from and neither of which is a row.
   */
  readonly note: string | null;
}

export interface GuideSection {
  readonly id: string;
  readonly title: string;
  /** An opening paragraph, for the sections that are prose rather than a list. */
  readonly body: string | null;
  readonly entries: readonly GuideEntry[];
  /** The figures, for the one section that is a reference sheet. */
  readonly tables: readonly GuideTable[];
}

/** What goes in a cell with nothing in it. An em dash, so the row still reads. */
export const BLANK = '—';

/** The order the guide reads in. Answers "what am I doing?" before "how?". */
export const SECTION_IDS = [
  'objective',
  'loop',
  'controls',
  'land',
  'seasons',
  'needs',
  'hardship',
  'resources',
  'buildings',
  // Last, and deliberately: it is a reference sheet, not something to read
  // through. A player comes back to it with a question about a number.
  'figures',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/**
 * The steps of the core loop, and the ideas in the controls and hardship lists.
 *
 * Ids only; the words live in the translation catalogue. Kept as arrays so the
 * renderer never decides what the guide contains.
 */
const LOOP_STEPS = ['designate', 'work', 'haul', 'store'] as const;
const CONTROLS = ['pan', 'zoom', 'select', 'build', 'speed', 'save'] as const;
const HARDSHIPS = ['hunger', 'cold', 'illness', 'age'] as const;

/**
 * What the player can do to the ground itself, as opposed to build on it.
 *
 * Its own section because none of it is in the build menu — a road, a ditch and a
 * bridge are all offered on the panel for the cell you tapped — so a player who
 * only reads the menu would never learn that any of them exists.
 */
const LAND = ['river', 'road', 'ditch', 'bridge'] as const;

/**
 * The four meters on a villager, and how they differ.
 *
 * Spirit is in this list precisely because it is the odd one out: three of
 * these can kill somebody and one cannot, and a player who assumes otherwise
 * will build a Temple before a Gatherer Hut.
 */
const NEEDS = ['hunger', 'warmth', 'health', 'spirit'] as const;

export function buildGuide(t: Translate): readonly GuideSection[] {
  return [
    section('objective', t, { body: t('guide.objective.body') }),
    section('loop', t, {
      body: t('guide.loop.body'),
      entries: LOOP_STEPS.map((step) => ({
        term: t(`guide.loop.${step}` as MessageKey),
        detail: t(`guide.loop.${step}.detail` as MessageKey),
        meta: null,
        output: null,
      })),
    }),
    section('controls', t, {
      entries: CONTROLS.map((control) => ({
        term: t(`guide.control.${control}` as MessageKey),
        detail: t(`guide.control.${control}.detail` as MessageKey),
        meta: null,
        output: null,
      })),
    }),
    section('land', t, {
      body: t('guide.land.body'),
      entries: LAND.map((feature) => ({
        term: t(`guide.land.${feature}` as MessageKey),
        detail: t(`guide.land.${feature}.detail` as MessageKey),
        meta: null,
        output: null,
      })),
    }),
    section('seasons', t, {
      entries: SEASONS.map((season) => ({
        term: t(`season.${season}` as MessageKey),
        detail: t(`guide.season.${season}` as MessageKey),
        meta: null,
        output: null,
      })),
    }),
    section('needs', t, {
      entries: NEEDS.map((need) => ({
        term: t(`need.${need}` as MessageKey),
        detail: t(`guide.need.${need}` as MessageKey),
        meta: null,
        output: null,
      })),
    }),
    section('hardship', t, {
      entries: HARDSHIPS.map((cause) => ({
        term: t(`guide.hardship.${cause}` as MessageKey),
        detail: t(`guide.hardship.${cause}.detail` as MessageKey),
        meta: null,
        output: null,
      })),
    }),
    section('resources', t, {
      entries: RESOURCE_IDS.map((resource) => ({
        term: t(`hud.${resource}` as MessageKey),
        detail: t(`resource.${resource}.purpose` as MessageKey),
        meta: describeYearlyDraw(resource, t),
        output: null,
      })),
    }),
    section('buildings', t, {
      // Said once, here, rather than on every line: the yearly figures below are
      // the plain ones — full staff, no tools, no experience.
      body: t('guide.buildings.body'),
      // In build-menu order, so reading the guide and scanning the toolbar are
      // the same act. A guide sorted its own way makes the player translate
      // between two orderings for no gain.
      entries: BUILDING_IDS.map((id) => {
        const definition = buildingDefinition(id);
        return {
          term: t(`building.${id}` as MessageKey),
          detail: t(`building.${id}.description` as MessageKey),
          meta: describeBuilding(definition, t),
          output: describeYearlyOutput(id, t),
        };
      }),
    }),
    section('figures', t, {
      body: t('guide.figures.body'),
      tables: [buildingLedger(t), landYields(t), householdDraw(t)],
    }),
  ];
}

function section(
  id: SectionId,
  t: Translate,
  parts: {
    body?: string;
    entries?: readonly GuideEntry[];
    tables?: readonly GuideTable[];
  },
): GuideSection {
  return {
    id,
    title: t(`guide.${id}` as MessageKey),
    body: parts.body ?? null,
    entries: parts.entries ?? [],
    tables: parts.tables ?? [],
  };
}

/**
 * How many freezing days a year there are, counted rather than written down.
 *
 * The temperature eases between one season's mean and the next, so how long the
 * settlement burns firewood is a property of that curve and not a number
 * anybody chose. Written down it would be a figure the guide states and the
 * game disagrees with the first time a season's mean is retuned.
 */
function freezingDaysPerYear(): number {
  let days = 0;
  for (let day = 0; day < SEASONS.length * DAYS_PER_SEASON; day += 1) {
    if (yearStateAt(day * TICKS_PER_DAY).isFreezing) {
      days += 1;
    }
  }
  return days;
}

/**
 * What a year of ordinary living takes out of the stores, per person.
 *
 * **Asked for, and it is the number the whole game turns on.** A player can read
 * that a Gatherer Hut makes so much food a year and still have no idea whether
 * that feeds ten people, because nothing anywhere said what ten people eat. Put
 * beside the yearly output of every building, the two figures are a plan.
 *
 * Food is every mouth every day. Firewood is only the housed — somebody with no
 * roof burns nothing, which is the cruel half of the rule — and only on the days
 * it actually freezes. `null` for everything else: a made-up figure for iron
 * would be worse than saying nothing.
 */
function describeYearlyDraw(resource: ResourceId, t: Translate): string | null {
  const yearDays = SEASONS.length * DAYS_PER_SEASON;

  if (resource === 'food') {
    const perYear = Math.round(FOOD_PER_VILLAGER_PER_DAY * yearDays);
    return `${perYear} ${t('guide.perVillagerYear')}`;
  }
  if (resource === 'firewood') {
    const perYear = Math.round(FIREWOOD_PER_VILLAGER_PER_COLD_DAY * freezingDaysPerYear());
    return `${perYear} ${t('guide.perHousedYear')}`;
  }
  return null;
}

/**
 * The facts about a building: what it costs, who staffs it, who it houses.
 *
 * Read from the definition rather than written down, because a cost written
 * down in two places is a cost that will disagree with itself.
 */
function describeBuilding(definition: BuildingDefinition, t: Translate): string {
  const parts: string[] = [describeCost(definition, t)];

  if (definition.workerSlots > 0) {
    parts.push(`${definition.workerSlots} ${t('guide.workerSlots')}`);
  } else if (!definition.housing) {
    // A house employing nobody is not worth remarking on; a workshop that
    // employs nobody is, because the player will be waiting for it to start.
    parts.push(t('guide.noWorkers'));
  }

  if (definition.housing) {
    parts.push(`${t('guide.houses')} ${definition.housing}`);
  }

  // **The two buildings that produce timber without a recipe.** A Forester's
  // Lodge and a Woodcutter both put logs on the ground by felling trees, which no
  // yearly figure can reach: it depends on how much wood is standing near them.
  // Saying so is the difference between a building whose purpose is legible and
  // one a player has to guess at — and "what did the lodge actually do?" was
  // asked, which is the proof it was not legible.
  if (definition.forestry) {
    parts.push(`${t('guide.tendsWithin')} ${definition.forestry.radius} ${t('guide.cells')}`);
    parts.push(`${definition.forestry.targetTrees} ${t('guide.treesKept')}`);
  }
  if (definition.felling) {
    parts.push(t('guide.fellsOwn'));
  }

  return parts.join(' · ');
}

/**
 * What a building makes in an ordinary year, and what it eats to do it.
 *
 * **Asked for by a player who could not tell what a building was worth.** The
 * build menu shows a cost and a number of workers, and neither of those says
 * whether a Woodcutter feeds a settlement through a winter. A yearly figure does,
 * because a year is the unit this game is played in.
 *
 * Deliberately the plain figure: fully staffed, no tools, no experience, nobody
 * walking a long way and nobody ill. Every one of those moves it, most of them
 * upwards, and a baseline that quietly included them would be unusable for
 * comparing one building against another. The section's opening paragraph says
 * so, once, rather than every line repeating the caveat.
 *
 * @returns `null` for anything that produces nothing, so the renderer can leave
 *   the line out rather than print an empty one.
 */
function describeYearlyOutput(id: BuildingId, t: Translate): string | null {
  const { outputs, inputs } = annualProduction(id);
  if (outputs.length === 0) {
    return null;
  }

  const list = (entries: readonly { resource: string; perYear: number }[]): string =>
    entries
      .map(
        (entry) =>
          `${Math.round(entry.perYear)} ${t(`hud.${entry.resource}` as MessageKey).toLocaleLowerCase()}`,
      )
      .join(', ');

  const made = `${list(outputs)} ${t('guide.aYear')}`;
  return inputs.length === 0 ? made : `${made}, ${t('guide.using')} ${list(inputs)}`;
}

function describeCost(definition: BuildingDefinition, t: Translate): string {
  if (definition.constructionCost.length === 0) {
    return t('guide.free');
  }
  return definition.constructionCost
    .map((entry) => `${entry.amount} ${t(`hud.${entry.resource}` as MessageKey)}`)
    .join(', ');
}

/**
 * Every building's year, side by side.
 *
 * **Asked for, and the one thing the guide could not previously answer.** The
 * buildings section says what each building makes on its own line, which is
 * enough to understand a building and useless for choosing between two. Down a
 * column, "which of these feeds the settlement" takes a second to see.
 *
 * Every building appears, including the ones that make nothing: that a Cemetery
 * produces nothing is a fact worth being able to check, and a table that quietly
 * dropped the rows with no figures would leave the reader wondering whether they
 * had missed something.
 *
 * The plain figure throughout — full staff, no tools, no experience, nobody
 * ill — because a baseline that folded in modifiers could not be compared
 * against anything. The section says so once, above.
 */
function buildingLedger(t: Translate): GuideTable {
  return {
    id: 'buildings',
    caption: t('guide.figures.buildings'),
    columns: [
      t('guide.figures.building'),
      t('guide.figures.makes'),
      t('guide.figures.uses'),
      t('guide.figures.workers'),
    ],
    rows: BUILDING_IDS.map((id) => {
      const definition = buildingDefinition(id);
      const { outputs, inputs } = annualProduction(id);
      // A Feller's Hut and a Forester's Lodge produce timber without a recipe,
      // by felling what stands near them. No yearly figure can reach that — it
      // depends on the wood — so the cell says as much rather than reading as a
      // building that produces nothing.
      const timber = definition.felling || definition.forestry ? t('guide.figures.timber') : BLANK;
      return {
        label: t(`building.${id}` as MessageKey),
        values: [
          outputs.length > 0 ? amounts(outputs, t) : timber,
          inputs.length > 0 ? amounts(inputs, t) : BLANK,
          definition.workerSlots > 0 ? String(definition.workerSlots) : BLANK,
        ],
      };
    }),
    // A Healer with two posts and nothing in the "makes" column would read as a
    // building that does nothing. Said once, under the table, rather than
    // inventing a unit for kindness.
    note: t('guide.figures.buildingsNote'),
  };
}

/**
 * What the land itself gives up, per tree and per deposit.
 *
 * Small, and the section would be incomplete without it: the first two hours of
 * every game are spent felling and quarrying, and a player working out how many
 * trees a house costs needs the conversion. Eight logs is two trees, which is
 * not obvious until somebody says that a tree is four.
 */
function landYields(t: Translate): GuideTable {
  const name = (resource: ResourceId): string =>
    t(`hud.${resource}` as MessageKey).toLocaleLowerCase();
  return {
    id: 'land',
    caption: t('guide.figures.land'),
    columns: [t('guide.figures.work'), t('guide.figures.yield')],
    rows: [
      { label: t('guide.figures.tree'), values: [`${LOGS_PER_TREE} ${name('logs')}`] },
      { label: t('guide.figures.deposit'), values: [`${STONE_PER_DEPOSIT} ${name('stone')}`] },
    ],
    note: t('guide.figures.landNote'),
  };
}

/**
 * What living costs, per person and per year.
 *
 * **The other half of the buildings table, and worthless without it.** A
 * Gatherer Hut's yearly food figure says nothing on its own, because nothing
 * anywhere said what a villager eats. Put beside it, the two tables are a plan:
 * this many mouths, that many huts.
 *
 * Each row names who pays it, because they differ and the difference is the
 * game. Food is every mouth every day of the year. Firewood is only the housed,
 * and only on the days it freezes — sleeping rough costs nothing in fuel, which
 * is the cruel half of that rule. Coats are everybody in the cold. Tools are
 * worn by whoever is working, so an idle settlement wears none.
 */
function householdDraw(t: Translate): GuideTable {
  const freezing = freezingDaysPerYear();
  const draw = (resource: ResourceId, perYear: number, who: MessageKey): GuideTableRow => ({
    label: t(`hud.${resource}` as MessageKey),
    values: [yearFigure(perYear), t(who)],
  });

  return {
    id: 'people',
    caption: t('guide.figures.people'),
    columns: [t('guide.figures.draw'), t('guide.figures.aYearColumn'), t('guide.figures.who')],
    rows: [
      draw('food', FOOD_PER_VILLAGER_PER_DAY * DAYS_PER_YEAR, 'guide.figures.everyone'),
      draw(
        'firewood',
        FIREWOOD_PER_VILLAGER_PER_COLD_DAY * freezing,
        'guide.figures.everyoneHoused',
      ),
      draw('clothing', CLOTHING_PER_VILLAGER_PER_COLD_DAY * freezing, 'guide.figures.everyone'),
      draw('tools', TOOLS_PER_WORKER_PER_DAY * DAYS_PER_YEAR, 'guide.figures.everyWorker'),
    ],
    note: `${DAYS_PER_YEAR} ${t('guide.figures.yearNote')} ${freezing} ${t('guide.figures.freezingNote')}`,
  };
}

/** A list of yearly amounts, as "48 food, 12 hides". */
function amounts(rates: readonly AnnualRate[], t: Translate): string {
  return rates
    .map(
      (rate) =>
        `${yearFigure(rate.perYear)} ${t(`hud.${rate.resource}` as MessageKey).toLocaleLowerCase()}`,
    )
    .join(', ');
}
