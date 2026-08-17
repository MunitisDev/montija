/**
 * The settlement's people, arranged for reading.
 *
 * Pure: it takes the simulation and a translator and returns plain data. No
 * DOM, so it can be tested headlessly — which matters more here than anywhere
 * else in the UI, because this panel makes *claims about people* and a claim
 * that quietly goes wrong is worse than a layout that does.
 *
 * Two decisions worth knowing about before reading further.
 *
 * **The roster is grouped by household, not listed flat.** A flat list of
 * thirty names sorted by id is a spreadsheet; the same thirty grouped under the
 * roof they sleep under is a village. Grouping by home is also the only kind of
 * family the simulation actually knows about at settlement level, so it is
 * honest as well as readable.
 *
 * **Tools and clothing are settlement-wide and are shown that way.** They are
 * not modelled per person: the survival system works out what fraction of the
 * day's demand the stores covered and applies that same fraction to everybody.
 * A tick beside one villager's name saying "has tools" would be an invention.
 * So the coverage is reported once, for the settlement, and the per-person
 * columns carry only what is genuinely per person — hunger, warmth, health,
 * illness, work, home, family and what they are carrying right now.
 */

import { buildingDefinition } from '@/data/buildings';
import type { Simulation } from '@/simulation/Simulation';
import type { Villager, WorkPreference } from '@/simulation/villagers/Villager';
import type { MessageKey } from '@/ui/i18n/messages';

export type Translate = (key: MessageKey) => string;

/** Value used by the work picker for "you decide". */
export const AUTOMATIC = 'auto';

export interface RosterPerson {
  readonly id: number;
  readonly name: string;
  readonly age: number;
  readonly isChild: boolean;
  readonly isIll: boolean;
  /** 0..100 each, genuinely per person. */
  readonly needs: {
    readonly hunger: number;
    readonly warmth: number;
    readonly health: number;
    /** Shared across the settlement rather than private — see `spirit`. */
    readonly spirit: number;
  };
  /** What they are doing right now, translated. */
  readonly activity: string;
  /** Where they work, translated — a building's name, or "labourer". */
  readonly job: string;
  /** Their partner's name, or `null`. */
  readonly partner: string | null;
  /** Their parents' names, or `null` for a founder or a newcomer. */
  readonly parents: string | null;
  /** Names of their children, oldest first. */
  readonly children: readonly string[];
  /** What is on their back right now, or `null`. */
  readonly carrying: string | null;
  /** The picker's current value: `AUTOMATIC`, `'labourer'` or a building id. */
  readonly work: string;
}

export interface RosterHousehold {
  /** The house's id, or `null` for the people with no roof. */
  readonly homeId: number | null;
  readonly title: string;
  readonly people: readonly RosterPerson[];
}

export interface WorkOption {
  readonly value: string;
  readonly label: string;
}

export interface RosterView {
  readonly households: readonly RosterHousehold[];
  readonly options: readonly WorkOption[];
  readonly summary: {
    readonly people: number;
    readonly adults: number;
    readonly children: number;
    readonly homeless: number;
    readonly ill: number;
    readonly labourers: number;
    readonly vacancies: number;
    /** Settlement-wide, in `0..1`. Not a per-person fact — see the file note. */
    readonly toolCoverage: number;
    readonly clothingCoverage: number;
  };
}

export function buildRoster(simulation: Simulation, t: Translate): RosterView {
  const people = [...simulation.villagers.all];
  const byId = new Map(people.map((villager) => [villager.id, villager]));

  // Built once rather than searched per person: a settlement heading for the
  // three hundred villagers this project is architected towards would
  // otherwise scan the whole population once for every row it draws.
  const childrenOf = new Map<number, Villager[]>();
  for (const villager of people) {
    if (!villager.parentIds) {
      continue;
    }
    for (const parentId of villager.parentIds) {
      const list = childrenOf.get(parentId);
      if (list) {
        list.push(villager);
      } else {
        childrenOf.set(parentId, [villager]);
      }
    }
  }

  const options = workOptions(simulation, t);
  const houseNumbers = numberTheHouses(simulation);

  const households = new Map<number | null, RosterPerson[]>();
  for (const villager of people) {
    const row = describe(villager, { byId, childrenOf, simulation, t });
    const key = villager.homeId;
    const list = households.get(key);
    if (list) {
      list.push(row);
    } else {
      households.set(key, [row]);
    }
  }

  const grouped: RosterHousehold[] = [];
  for (const [homeId, members] of households) {
    if (homeId === null) {
      continue;
    }
    grouped.push({
      homeId,
      title: `${t('roster.house')} ${houseNumbers.get(homeId) ?? homeId}`,
      // Oldest first, so a household reads as parents then children.
      people: members.slice().sort((a, b) => b.age - a.age || a.id - b.id),
    });
  }
  grouped.sort((a, b) => (houseNumbers.get(a.homeId!) ?? 0) - (houseNumbers.get(b.homeId!) ?? 0));

  // The roofless last and always visible, even when empty of drama: they are
  // the people the player most needs to notice, and burying them among the
  // households would be the interface hiding the problem.
  const roofless = households.get(null);
  if (roofless && roofless.length > 0) {
    grouped.push({
      homeId: null,
      title: t('roster.noHome'),
      people: roofless.slice().sort((a, b) => b.age - a.age || a.id - b.id),
    });
  }

  const snapshot = simulation.snapshot();
  return {
    households: grouped,
    options,
    summary: {
      people: people.length,
      adults: people.filter((villager) => villager.isAdult).length,
      children: people.filter((villager) => !villager.isAdult).length,
      homeless: people.filter((villager) => villager.homeId === null).length,
      ill: people.filter((villager) => villager.isIll).length,
      labourers: snapshot.employment.labourers,
      vacancies: snapshot.employment.vacancies,
      toolCoverage: snapshot.lastDay.toolFraction,
      clothingCoverage: snapshot.lastDay.clothingFraction,
    },
  };
}

function describe(
  villager: Villager,
  context: {
    byId: Map<number, Villager>;
    childrenOf: Map<number, Villager[]>;
    simulation: Simulation;
    t: Translate;
  },
): RosterPerson {
  const { byId, childrenOf, simulation, t } = context;

  const employer =
    villager.employerId === null ? null : simulation.world.buildings.getById(villager.employerId);

  const parents = villager.parentIds
    ?.map((id) => byId.get(id)?.name)
    .filter((name): name is string => name !== undefined);

  const carried = villager.inventory.contents;

  return {
    id: villager.id,
    name: villager.name,
    age: villager.age,
    isChild: !villager.isAdult,
    isIll: villager.isIll,
    needs: {
      hunger: Math.round(villager.needs.hunger),
      warmth: Math.round(villager.needs.warmth),
      health: Math.round(villager.needs.health),
      spirit: Math.round(villager.needs.spirit),
    },
    activity: t(`villager.${villager.activity}` as MessageKey),
    job: employer ? t(`building.${employer.definition.id}` as MessageKey) : t('villager.labourer'),
    partner: villager.partnerId === null ? null : (byId.get(villager.partnerId)?.name ?? null),
    // Both parents or neither: half a lineage reads as a bug rather than as
    // somebody whose other parent has died.
    parents: parents && parents.length === 2 ? parents.join(' & ') : null,
    children: (childrenOf.get(villager.id) ?? [])
      .slice()
      .sort((a, b) => b.age - a.age || a.id - b.id)
      .map((child) => child.name),
    carrying:
      carried.length === 0
        ? null
        : carried
            .map((entry) => `${entry.amount} ${t(`hud.${entry.resource}` as MessageKey)}`)
            .join(', '),
    work: workValue(villager.workPreference),
  };
}

export function workValue(preference: WorkPreference): string {
  if (preference === null) {
    return AUTOMATIC;
  }
  return typeof preference === 'number' ? String(preference) : preference;
}

/** Turns a picker value back into something the simulation understands. */
export function workPreferenceFrom(value: string): WorkPreference {
  if (value === AUTOMATIC) {
    return null;
  }
  if (value === 'labourer') {
    return 'labourer';
  }
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

/**
 * What the work picker offers: automatic, labourer, then every workplace.
 *
 * Unfinished buildings are included. A player who posts somebody to a workshop
 * still going up means "when it opens", and the employment system already
 * treats it that way — leaving it out of the list would hide a thing the
 * simulation supports.
 */
function workOptions(simulation: Simulation, t: Translate): WorkOption[] {
  const options: WorkOption[] = [
    { value: AUTOMATIC, label: t('roster.automatic') },
    { value: 'labourer', label: t('villager.labourer') },
  ];

  const workplaces = [...simulation.world.buildings.all]
    .filter((building) => building.definition.workerSlots > 0)
    .sort((a, b) => a.id - b.id);

  // Three gatherer huts called "Gatherer Hut" three times is a picker the
  // player cannot use, so identical trades are numbered.
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const building of workplaces) {
    total.set(building.definition.id, (total.get(building.definition.id) ?? 0) + 1);
  }

  for (const building of workplaces) {
    const definition = buildingDefinition(building.definition.id);
    const index = (seen.get(definition.id) ?? 0) + 1;
    seen.set(definition.id, index);

    const name = t(`building.${definition.id}` as MessageKey);
    const numbered = (total.get(definition.id) ?? 1) > 1 ? `${name} ${index}` : name;
    options.push({
      value: String(building.id),
      label: building.isComplete ? numbered : `${numbered} (${t('roster.beingBuilt')})`,
    });
  }

  return options;
}

/** Numbers the houses 1..n in the order they were built. */
function numberTheHouses(simulation: Simulation): Map<number, number> {
  const numbers = new Map<number, number>();
  const houses = [...simulation.world.buildings.all]
    .filter((building) => (building.definition.housing ?? 0) > 0)
    .sort((a, b) => a.id - b.id);

  houses.forEach((house, index) => numbers.set(house.id, index + 1));
  return numbers;
}
