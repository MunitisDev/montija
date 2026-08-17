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

import { BUILDING_IDS, buildingDefinition, type BuildingDefinition } from '@/data/buildings';
import { RESOURCE_IDS } from '@/data/resources';
import { SEASONS } from '@/simulation/seasons/SeasonClock';
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
}

export interface GuideSection {
  readonly id: string;
  readonly title: string;
  /** An opening paragraph, for the sections that are prose rather than a list. */
  readonly body: string | null;
  readonly entries: readonly GuideEntry[];
}

/** The order the guide reads in. Answers "what am I doing?" before "how?". */
export const SECTION_IDS = [
  'objective',
  'loop',
  'controls',
  'seasons',
  'needs',
  'hardship',
  'resources',
  'buildings',
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
      })),
    }),
    section('controls', t, {
      entries: CONTROLS.map((control) => ({
        term: t(`guide.control.${control}` as MessageKey),
        detail: t(`guide.control.${control}.detail` as MessageKey),
        meta: null,
      })),
    }),
    section('seasons', t, {
      entries: SEASONS.map((season) => ({
        term: t(`season.${season}` as MessageKey),
        detail: t(`guide.season.${season}` as MessageKey),
        meta: null,
      })),
    }),
    section('needs', t, {
      entries: NEEDS.map((need) => ({
        term: t(`need.${need}` as MessageKey),
        detail: t(`guide.need.${need}` as MessageKey),
        meta: null,
      })),
    }),
    section('hardship', t, {
      entries: HARDSHIPS.map((cause) => ({
        term: t(`guide.hardship.${cause}` as MessageKey),
        detail: t(`guide.hardship.${cause}.detail` as MessageKey),
        meta: null,
      })),
    }),
    section('resources', t, {
      entries: RESOURCE_IDS.map((resource) => ({
        term: t(`hud.${resource}` as MessageKey),
        detail: t(`resource.${resource}.purpose` as MessageKey),
        meta: null,
      })),
    }),
    section('buildings', t, {
      // In build-menu order, so reading the guide and scanning the toolbar are
      // the same act. A guide sorted its own way makes the player translate
      // between two orderings for no gain.
      entries: BUILDING_IDS.map((id) => {
        const definition = buildingDefinition(id);
        return {
          term: t(`building.${id}` as MessageKey),
          detail: t(`building.${id}.description` as MessageKey),
          meta: describeBuilding(definition, t),
        };
      }),
    }),
  ];
}

function section(
  id: SectionId,
  t: Translate,
  parts: { body?: string; entries?: readonly GuideEntry[] },
): GuideSection {
  return {
    id,
    title: t(`guide.${id}` as MessageKey),
    body: parts.body ?? null,
    entries: parts.entries ?? [],
  };
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

  return parts.join(' · ');
}

function describeCost(definition: BuildingDefinition, t: Translate): string {
  if (definition.constructionCost.length === 0) {
    return t('guide.free');
  }
  return definition.constructionCost
    .map((entry) => `${entry.amount} ${t(`hud.${entry.resource}` as MessageKey)}`)
    .join(', ');
}
