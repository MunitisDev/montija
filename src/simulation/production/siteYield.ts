/**
 * What a building's neighbours are worth to it.
 *
 * The first rule in the game about *where* something is built rather than
 * whether it is built at all. An orchard beside a larder brings in far more
 * fruit than one on its own, because fruit is the one harvest that will not
 * wait: baskets standing in an autumn field are half spoiled by the time a
 * hauler reaches them, and somewhere cool a few paces away changes the whole
 * economics of the tree.
 *
 * Pure, and shared by the three places that need it — the villagers who
 * actually produce the goods, the panel that quotes a building's ceiling, and
 * the ledger that forecasts the settlement's flows. A bonus the simulation
 * applies and the panel does not know about is a panel that lies.
 */

import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';

/** The buildings a bonus can be measured against. */
export interface SiteNeighbours {
  readonly all: Iterable<Building>;
}

/**
 * The multiplier a building's surroundings give it. `1` when they give nothing.
 *
 * Distance is measured between plots rather than between centres, so a bigger
 * store does not have to be further away to count. Chebyshev, because a
 * settlement laid out on a grid does not care whether the larder is diagonal.
 */
export function siteYield(neighbours: SiteNeighbours, building: Building): number {
  const wanted = building.definition.nearby;
  if (!wanted) {
    return 1;
  }
  return hasNeighbour(neighbours, building, wanted.building, wanted.radius)
    ? wanted.yieldMultiplier
    : 1;
}

/** `true` when a finished building of that kind stands within reach. */
export function hasNeighbour(
  neighbours: SiteNeighbours,
  building: Building,
  wanted: BuildingId,
  radius: number,
): boolean {
  for (const other of neighbours.all) {
    if (other.id === building.id || !other.isComplete || other.definition.id !== wanted) {
      continue;
    }
    if (plotDistance(building, other) <= radius) {
      return true;
    }
  }
  return false;
}

/** Cells between the nearest edges of two plots; `0` when they touch. */
function plotDistance(a: Building, b: Building): number {
  const gapX = axisGap(
    a.origin.gx,
    a.definition.footprint.width,
    b.origin.gx,
    b.definition.footprint.width,
  );
  const gapY = axisGap(
    a.origin.gy,
    a.definition.footprint.height,
    b.origin.gy,
    b.definition.footprint.height,
  );
  return Math.max(gapX, gapY);
}

function axisGap(aStart: number, aSize: number, bStart: number, bSize: number): number {
  if (aStart + aSize <= bStart) {
    return bStart - (aStart + aSize) + 1;
  }
  if (bStart + bSize <= aStart) {
    return aStart - (bStart + bSize) + 1;
  }
  return 0;
}
