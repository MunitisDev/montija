/**
 * The build menu, arranged for a thumb.
 *
 * Pure: a snapshot and a translator in, plain groups out. No DOM, so what the
 * menu *contains* can be tested headlessly and cannot quietly drift out of step
 * with `data/buildings.ts` — which is the whole point of the buildings being
 * data in the first place.
 *
 * **Why groups rather than one strip.** Seventeen buttons in a horizontal
 * scroller meant swiping sideways to find a House, which is the most-built
 * thing in the game, and the strip only gets longer. Five groups of two to four
 * fit on every screen this project targets without scrolling at all, and they
 * keep fitting.
 *
 * **Why the cost is on the card.** "Can I build this yet" is the question a
 * player asks before every placement, and until now the only way to answer it
 * was to start placing and read the bar. A resource the settlement has *none*
 * of is marked, because that is the difference between "nearly" and "not until
 * you have found iron".
 */

import {
  BUILDING_CATEGORIES,
  BUILDING_IDS,
  buildingDefinition,
  type BuildingCategory,
  type BuildingId,
} from '@/data/buildings';
import type { ResourceId } from '@/data/resources';
import type { MessageKey } from '@/ui/i18n/messages';

export type Translate = (key: MessageKey) => string;

/** One line of a building's price, as it appears on the card. */
export interface CostPart {
  readonly resource: ResourceId;
  readonly amount: number;
  readonly text: string;
  /**
   * `true` when the settlement has none of this at all.
   *
   * Not "cannot afford": materials are hauled to a site as they arrive, so a
   * site can quite reasonably be started short. Having *none* is different —
   * it usually means a building the settlement has not unlocked the economy
   * for yet, and saying so is the difference between "nearly" and "not yet".
   */
  readonly missing: boolean;
}

export interface BuildOption {
  readonly id: BuildingId;
  readonly name: string;
  readonly description: string;
  readonly cost: readonly CostPart[];
  /** `true` when nothing in the settlement's stores covers any of the cost. */
  readonly outOfReach: boolean;
}

export interface BuildGroup {
  readonly id: BuildingCategory;
  readonly title: string;
  readonly options: readonly BuildOption[];
}

/** What the settlement holds, for marking a cost it cannot begin to meet. */
export type Stores = Readonly<Record<ResourceId, number>>;

export function buildMenuGroups(stores: Stores, t: Translate): readonly BuildGroup[] {
  const byCategory = new Map<BuildingCategory, BuildOption[]>();
  for (const category of BUILDING_CATEGORIES) {
    byCategory.set(category, []);
  }

  // Walked in `BUILDING_IDS` order rather than by grouping the map, so the
  // order inside a group is the one deliberately chosen in the data.
  for (const id of BUILDING_IDS) {
    const definition = buildingDefinition(id);
    // A bridge is offered on the panel for the cell of river it spans, not here.
    // See `BuildingDefinition.placement`.
    if (definition.placement === 'cell') {
      continue;
    }
    const cost = definition.constructionCost.map((entry) => ({
      resource: entry.resource,
      amount: entry.amount,
      text: `${entry.amount} ${t(`hud.${entry.resource}` as MessageKey)}`,
      missing: (stores[entry.resource] ?? 0) <= 0,
    }));

    byCategory.get(definition.category)?.push({
      id,
      name: t(`building.${id}` as MessageKey),
      description: t(`building.${id}.description` as MessageKey),
      cost,
      outOfReach: cost.length > 0 && cost.every((part) => part.missing),
    });
  }

  return BUILDING_CATEGORIES.map((category) => ({
    id: category,
    title: t(`build.${category}` as MessageKey),
    options: byCategory.get(category) ?? [],
  }));
}
