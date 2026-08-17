/**
 * The settlement, counted.
 *
 * Pure: simulation and a translator in, plain rows out. No DOM, so the
 * arithmetic can be tested headlessly — which matters here more than in most
 * panels, because every figure on this sheet is a *claim about the future* and
 * a wrong one sends the player to build the wrong thing.
 *
 * Three decisions worth knowing before reading further.
 *
 * **This is not the people panel.** That one lists individuals under the roof
 * they sleep under. This one counts: how many, of what, making what, spending
 * what. "Will we get through winter" is a question for this sheet.
 *
 * **Production and consumption are estimates, and are labelled as such.** The
 * production figure is what the staffed workshops would make in a day if
 * nobody ever walked anywhere, waited for an input to arrive or stopped for the
 * night. Real output is lower — usually well under it, because travel is most
 * of a villager's day. It is still worth showing: the *ordering* is honest
 * (which workshop feeds the settlement, which barely registers) and so is the
 * comparison against demand, which is exact.
 *
 * **Demand is exact where the simulation is exact.** Food, firewood, tools and
 * coats all come out of `SurvivalSystem`'s own constants rather than a second
 * set copied here, so a change to the balance cannot leave this sheet lying.
 */

import { recipe as findRecipe } from '@/data/recipes';
import { WORKING_AGE } from '@/data/population';
import { RESOURCE_IDS, type ResourceId } from '@/data/resources';
import type { Simulation } from '@/simulation/Simulation';
import { hasColdReading } from '@/simulation/history/Chronicle';
import { DAYS_PER_YEAR, SEASONAL_YIELD, TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import {
  SPIRIT_NEUTRAL,
  CLOTHING_PER_VILLAGER_PER_COLD_DAY,
  FIREWOOD_PER_VILLAGER_PER_COLD_DAY,
  FOOD_PER_VILLAGER_PER_DAY,
  TOOLS_PER_WORKER_PER_DAY,
  TOOL_WORK_BONUS,
} from '@/simulation/seasons/SurvivalSystem';
import type { MessageKey } from '@/ui/i18n/messages';

export type Translate = (key: MessageKey) => string;

export type LedgerTabId = 'people' | 'buildings' | 'production' | 'consumption' | 'chronicle';

/**
 * Tab order, and the default is the first.
 *
 * People lead because "who have I got, and are they working?" is the question a
 * player opens this panel to answer. The chronicle sits last: it is the only page
 * about the past, and nobody needs it in a hurry.
 */
export const LEDGER_TABS: readonly LedgerTabId[] = [
  'people',
  'buildings',
  'production',
  'consumption',
  'chronicle',
];

/** One labelled figure. `detail` is the quiet second line, when there is one. */
export interface LedgerRow {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  /** Draws the row as good, bad or neither. Nothing else reads it. */
  readonly tone?: 'good' | 'bad';
}

export interface LedgerSection {
  readonly id: string;
  /**
   * The heading, or empty to have none.
   *
   * A one-section tab whose heading repeats the tab's own name says the same
   * word twice in three lines. Empty is how such a tab says "no heading" rather
   * than the renderer guessing.
   */
  readonly title: string;
  /** Shown when the section has nothing to report. */
  readonly empty?: string;
  readonly rows: readonly LedgerRow[];
}

/**
 * The one button the ledger has.
 *
 * Only the rescue tab carries one, and only ever one: a page of figures with
 * controls scattered through it stops being a page of figures. The model says
 * what it is called and whether it can be pressed; the renderer decides how it
 * looks and what pressing it calls.
 */
export interface LedgerAction {
  readonly label: string;
  readonly enabled: boolean;
}

export interface LedgerTab {
  readonly id: LedgerTabId;
  readonly title: string;
  /** A sentence above the sections, where one is needed. Usually a caveat. */
  readonly note?: string;
  readonly action?: LedgerAction;
  readonly sections: readonly LedgerSection[];
}

/** Per-day figures behind the production and consumption tabs. */
export interface Flows {
  /** Estimated output per day, by resource. Only staffed workshops appear. */
  readonly production: ReadonlyMap<ResourceId, number>;
  /** Estimated input consumed per day by those same workshops. */
  readonly workshopDemand: ReadonlyMap<ResourceId, number>;
  /** What the people themselves spend per day, at today's temperature. */
  readonly survivalDemand: ReadonlyMap<ResourceId, number>;
}

/**
 * Works out what a day would produce and cost at the settlement's current
 * staffing, season and temperature.
 *
 * Exported on its own because the resource drawer wants the same numbers
 * without the rest of the sheet.
 */
export function estimateFlows(simulation: Simulation): Flows {
  const production = new Map<ResourceId, number>();
  const workshopDemand = new Map<ResourceId, number>();
  const survivalDemand = new Map<ResourceId, number>();

  const snapshot = simulation.snapshot();
  // Tools speed every job up, this one included. Read from the last day rather
  // than from the stores, because that is the figure the simulation itself
  // uses.
  const workRate = 1 + TOOL_WORK_BONUS * snapshot.lastDay.toolFraction;

  for (const building of simulation.world.buildings.all) {
    if (!building.isComplete || building.workers.length === 0) {
      continue;
    }
    const recipeId = building.definition.recipeId;
    const recipe = recipeId === undefined ? undefined : findRecipe(recipeId);
    if (!recipe) {
      // A forester plants and fells, a healer treats people. Neither turns one
      // resource into another, so neither belongs in a table of goods.
      continue;
    }
    const scale = SEASONAL_YIELD[recipe.seasonal][snapshot.season];
    const batches = (building.workers.length * TICKS_PER_DAY * workRate) / recipe.workTicks;

    for (const output of recipe.outputs) {
      // Rounded exactly as the simulation rounds it, so a yield the season has
      // rounded away to nothing shows as nothing rather than as a fraction.
      const perBatch = Math.max(0, Math.round(output.amount * scale));
      add(production, output.resource, batches * perBatch);
    }
    for (const input of recipe.inputs) {
      add(workshopDemand, input.resource, batches * input.amount);
    }
  }

  const people = simulation.villagers.all;
  // Workers, not grown-ups: tools are worn by whoever is doing the work, and
  // that is fourteen to sixty. Must match `SurvivalSystem`, or the ledger
  // forecasts a demand the settlement does not have.
  const workers = people.filter((villager) => villager.canWork).length;
  const housed = people.filter((villager) => villager.homeId !== null).length;
  const freezing = simulation.year.isFreezing;

  add(survivalDemand, 'food', people.length * FOOD_PER_VILLAGER_PER_DAY);
  add(survivalDemand, 'tools', workers * TOOLS_PER_WORKER_PER_DAY);
  if (freezing) {
    // Only houses are heated, so an unhoused settlement burns nothing — and
    // pays for it in warmth rather than in firewood.
    add(survivalDemand, 'firewood', housed * FIREWOOD_PER_VILLAGER_PER_COLD_DAY);
    add(survivalDemand, 'clothing', people.length * CLOTHING_PER_VILLAGER_PER_COLD_DAY);
  }

  return { production, workshopDemand, survivalDemand };
}

/** Total demand per day: what the workshops eat plus what the people do. */
export function totalDemand(flows: Flows, resource: ResourceId): number {
  return (flows.workshopDemand.get(resource) ?? 0) + (flows.survivalDemand.get(resource) ?? 0);
}

export function buildLedger(simulation: Simulation, t: Translate): readonly LedgerTab[] {
  const flows = estimateFlows(simulation);
  return [
    peopleTab(simulation, t),
    buildingsTab(simulation, t),
    productionTab(flows, t),
    consumptionTab(simulation, flows, t),
    chronicleTab(simulation, t),
  ];
}

/**
 * The settlement's own history.
 *
 * The only page in the ledger about the past, and it exists because **the
 * present cannot be asked what the past was**: by year thirty most of the people
 * a settlement is made of are dead and most of its winters are decades gone. A
 * village of twelve tells you nothing about the forty who lived there.
 *
 * The figures are recorded as they happen — see `history/Chronicle.ts` — which
 * is why they are saved rather than recomputed.
 */
function chronicleTab(simulation: Simulation, t: Translate): LedgerTab {
  const chronicle = simulation.snapshot().chronicle;
  const rows: LedgerRow[] = [
    { label: t('chronicle.year'), value: String(yearOfTick(simulation.tick)) },
    { label: t('chronicle.born'), value: String(chronicle.born) },
    { label: t('chronicle.arrived'), value: String(chronicle.arrived) },
    { label: t('chronicle.died'), value: String(chronicle.died) },
    { label: t('chronicle.peak'), value: String(chronicle.peakPopulation) },
    { label: t('chronicle.raised'), value: String(chronicle.buildingsRaised) },
    { label: t('chronicle.foodEaten'), value: String(Math.round(chronicle.foodEaten)) },
    { label: t('chronicle.firewoodBurned'), value: String(Math.round(chronicle.firewoodBurned)) },
  ];

  // Only once there is a reading to report: `coldest` starts at +Infinity, and
  // printing that would be the panel talking nonsense on the first morning.
  if (hasColdReading(chronicle)) {
    rows.push({ label: t('chronicle.coldest'), value: `${Math.round(chronicle.coldest)}°` });
  }
  if (chronicle.roughNights > 0) {
    rows.push({
      label: t('chronicle.roughNights'),
      value: String(chronicle.roughNights),
      detail: t('chronicle.roughNights.detail'),
      tone: 'bad' as const,
    });
  }

  return {
    id: 'chronicle',
    title: t('chronicle.title'),
    note: t('chronicle.note'),
    // No heading: one section, and repeating the tab's own name under it is noise.
    sections: [{ id: 'history', title: '', rows }],
  };
}

function peopleTab(simulation: Simulation, t: Translate): LedgerTab {
  const snapshot = simulation.snapshot();
  const people = simulation.villagers.all;
  const workers = people.filter((villager) => villager.canWork);
  const ill = people.filter((villager) => villager.isIll).length;
  const homeless = people.filter((villager) => villager.homeId === null).length;
  const employed = workers.filter((villager) => villager.employerId !== null).length;

  return {
    id: 'people',
    title: t('ledger.tab.people'),
    sections: [
      {
        id: 'population',
        title: t('ledger.section.population'),
        rows: [
          { label: t('ledger.people.total'), value: String(people.length) },
          // Three groups rather than two, because that is the shape of the
          // problem a player runs into: a settlement can stall with twenty
          // people and half its workshops empty, and the reason is always how
          // many of the twenty are under fourteen or over sixty.
          { label: t('ledger.people.workers'), value: String(workers.length) },
          {
            label: t('ledger.people.children'),
            value: String(people.filter((villager) => villager.age < WORKING_AGE).length),
          },
          {
            label: t('ledger.people.elders'),
            value: String(people.filter((villager) => villager.isElder).length),
          },
          {
            label: t('ledger.people.homeless'),
            value: String(homeless),
            ...(homeless > 0 ? { tone: 'bad' as const } : {}),
          },
          {
            label: t('ledger.people.ill'),
            value: String(ill),
            ...(ill > 0 ? { tone: 'bad' as const } : {}),
          },
          { label: t('ledger.people.deaths'), value: String(snapshot.deaths) },
        ],
      },
      {
        id: 'work',
        title: t('ledger.section.work'),
        rows: [
          { label: t('ledger.people.employed'), value: String(employed) },
          {
            label: t('ledger.people.labourers'),
            value: String(workers.length - employed),
            detail: t('ledger.people.labourers.detail'),
          },
          {
            label: t('ledger.people.vacancies'),
            value: String(snapshot.employment.vacancies),
            ...(snapshot.employment.vacancies > 0 ? { tone: 'bad' as const } : {}),
          },
        ],
      },
      {
        id: 'condition',
        title: t('ledger.section.condition'),
        rows: [
          {
            label: t('ledger.people.hunger'),
            value: mean(people.map((villager) => villager.needs.hunger)),
          },
          {
            label: t('ledger.people.warmth'),
            value: mean(people.map((villager) => villager.needs.warmth)),
          },
          {
            label: t('ledger.people.health'),
            value: mean(people.map((villager) => villager.needs.health)),
          },
          {
            label: t('ledger.people.tooled'),
            value: percent(snapshot.lastDay.toolFraction),
            detail: t('ledger.people.tooled.detail'),
          },
          {
            label: t('ledger.people.clothed'),
            value: percent(snapshot.lastDay.clothingFraction),
            detail: t('ledger.people.clothed.detail'),
          },
          {
            label: t('need.spirit'),
            value: String(Math.round(snapshot.lastDay.spirit)),
            detail: t('ledger.people.spirit.detail'),
            ...(snapshot.lastDay.spirit > SPIRIT_NEUTRAL ? { tone: 'good' as const } : {}),
          },
        ],
      },
    ],
  };
}

function buildingsTab(simulation: Simulation, t: Translate): LedgerTab {
  const standing = new Map<
    string,
    { name: string; done: number; building: number; staff: number; slots: number }
  >();

  for (const building of simulation.world.buildings.all) {
    const entry = standing.get(building.definition.id) ?? {
      name: t(`building.${building.definition.id}` as MessageKey),
      done: 0,
      building: 0,
      staff: 0,
      slots: 0,
    };
    if (building.isComplete) {
      entry.done += 1;
      entry.staff += building.workers.length;
      entry.slots += building.hiringTarget;
    } else {
      entry.building += 1;
    }
    standing.set(building.definition.id, entry);
  }

  const rows: LedgerRow[] = [];
  // Sorted by id rather than left in insertion order, so the list does not
  // reshuffle itself every time the settlement puts up a building.
  for (const entry of [...standing.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value)) {
    const parts: string[] = [];
    if (entry.building > 0) {
      parts.push(`${entry.building} ${t('ledger.buildings.underway')}`);
    }
    if (entry.slots > 0) {
      parts.push(`${entry.staff}/${entry.slots} ${t('ledger.buildings.staffed')}`);
    }
    rows.push({
      label: entry.name,
      value: String(entry.done),
      ...(parts.length > 0 ? { detail: parts.join(' · ') } : {}),
      ...(entry.slots > entry.staff ? { tone: 'bad' as const } : {}),
    });
  }

  const snapshot = simulation.snapshot();
  return {
    id: 'buildings',
    title: t('ledger.tab.buildings'),
    sections: [
      {
        id: 'shelter',
        title: t('ledger.section.shelter'),
        rows: [
          {
            label: t('ledger.buildings.beds'),
            value: `${snapshot.villagerCount}/${snapshot.housingCapacity}`,
            detail: t('ledger.buildings.beds.detail'),
            ...(snapshot.villagerCount > snapshot.housingCapacity ? { tone: 'bad' as const } : {}),
          },
        ],
      },
      {
        id: 'standing',
        title: t('ledger.section.standing'),
        empty: t('ledger.buildings.none'),
        rows,
      },
    ],
  };
}

function productionTab(flows: Flows, t: Translate): LedgerTab {
  const rows: LedgerRow[] = [];
  for (const resource of RESOURCE_IDS) {
    const made = flows.production.get(resource) ?? 0;
    if (made <= 0) {
      continue;
    }
    const demand = totalDemand(flows, resource);
    const net = made - demand;
    rows.push({
      label: t(`hud.${resource}` as MessageKey),
      value: `+${round1(made)}`,
      detail:
        demand > 0
          ? `${t('ledger.flow.net')} ${signed(net)} ${t('ledger.flow.perDay')}`
          : t('ledger.flow.noDemand'),
      ...(demand > 0 ? { tone: net >= 0 ? ('good' as const) : ('bad' as const) } : {}),
    });
  }

  return {
    id: 'production',
    title: t('ledger.tab.production'),
    note: t('ledger.production.note'),
    sections: [
      {
        id: 'output',
        title: t('ledger.section.output'),
        empty: t('ledger.production.none'),
        rows,
      },
    ],
  };
}

function consumptionTab(simulation: Simulation, flows: Flows, t: Translate): LedgerTab {
  const snapshot = simulation.snapshot();
  const rows: LedgerRow[] = [];

  for (const resource of RESOURCE_IDS) {
    const demand = totalDemand(flows, resource);
    if (demand <= 0) {
      continue;
    }
    const stored = snapshot.stored[resource];
    const made = flows.production.get(resource) ?? 0;
    const net = made - demand;
    // Days of stock only means anything while there is stock and it is falling.
    // "Forever" is the honest answer above the line, and "none" is the honest
    // answer at zero — "lasts about 0 days" is a countdown dressed over an
    // empty shelf, and reads as an emergency even where there is none.
    const detail =
      net >= 0
        ? t('ledger.flow.sustained')
        : stored <= 0
          ? t('ledger.flow.empty')
          : `${t('ledger.flow.lasts')} ${Math.floor(stored / -net)} ${t('ledger.flow.days')}`;
    rows.push({
      label: t(`hud.${resource}` as MessageKey),
      value: `-${round1(demand)}`,
      detail,
      ...(net >= 0 ? { tone: 'good' as const } : { tone: 'bad' as const }),
    });
  }

  const yesterday: LedgerRow[] = [
    { label: t('ledger.spent.food'), value: round1(snapshot.lastDay.foodEaten) },
    { label: t('ledger.spent.firewood'), value: round1(snapshot.lastDay.firewoodBurned) },
    { label: t('ledger.spent.tools'), value: round1(snapshot.lastDay.toolsWorn) },
    { label: t('ledger.spent.clothing'), value: round1(snapshot.lastDay.clothingWorn) },
  ];

  return {
    id: 'consumption',
    title: t('ledger.tab.consumption'),
    note: simulation.year.isFreezing
      ? t('ledger.consumption.freezing')
      : t('ledger.consumption.mild'),
    sections: [
      {
        id: 'demand',
        title: t('ledger.section.demand'),
        empty: t('ledger.consumption.none'),
        rows,
      },
      { id: 'yesterday', title: t('ledger.section.yesterday'), rows: yesterday },
    ],
  };
}

/** Which year of the settlement a tick falls in, counting from 1. */
export function yearOfTick(tick: number): number {
  return Math.floor(tick / (TICKS_PER_DAY * DAYS_PER_YEAR)) + 1;
}

function add(into: Map<ResourceId, number>, resource: ResourceId, amount: number): void {
  into.set(resource, (into.get(resource) ?? 0) + amount);
}

function mean(values: readonly number[]): string {
  if (values.length === 0) {
    return '--';
  }
  return String(Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** One decimal, and no trailing `.0` — `4` reads better than `4.0`. */
function round1(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
