/**
 * Who works where.
 *
 * Until this existed every villager was a generalist: a produce job at a hut
 * went to whoever happened to be nearest, so a "worker slot" described nothing
 * a player could act on. Somebody could walk half the map to spend forty ticks
 * foraging and walk back, and the settlement had no way to say *fewer people in
 * the woods, more carrying things*.
 *
 * The model is employment rather than a profession field:
 *
 * - A villager assigned to a building is **employed** there, and only its
 *   employees may work it.
 * - Everybody else is a **labourer** — felling, mining, paving, hauling and
 *   building, which is all the work that belongs to the settlement rather than
 *   to a workshop.
 *
 * That is a better fit than a profession list because the buildings already
 * carry the trades: adding a workshop adds a trade, and nothing here has to
 * learn its name. A villager's profession is simply the building they answer
 * to, and the display name comes from the building definition.
 *
 * **The lever this gives the player is the important part.** Each building has
 * a desired number of workers, which they can turn down to zero. A settlement
 * that is starving does not need three people splitting firewood, and until now
 * there was no way to say so.
 */

import type { Building } from '@/simulation/buildings/Building';
import type { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import type { Villager } from '@/simulation/villagers/Villager';

export interface EmploymentReport {
  /** Villagers who took a post this pass. */
  readonly hired: number;
  /** Villagers who lost one — the building went, or its quota came down. */
  readonly released: number;
  /** Adults answering to no building, and so available for everything else. */
  readonly labourers: number;
  /** Posts the settlement wants filled and cannot fill. */
  readonly vacancies: number;
}

export const NO_EMPLOYMENT_CHANGE: EmploymentReport = {
  hired: 0,
  released: 0,
  labourers: 0,
  vacancies: 0,
};

/**
 * Reconciles every villager against every post.
 *
 * Deliberately a full reconciliation rather than an event: a villager can leave
 * a post for four unrelated reasons — they died, they were a child who is no
 * longer relevant, the building was never finished, the player turned the quota
 * down — and a system that hooks each of those separately is a system that
 * misses the fifth.
 *
 * Deterministic: vacancies are filled nearest-first, and ties break on the
 * villager's id, so a settlement replayed from its seed employs the same people.
 */
export function runEmployment(
  villagers: readonly Villager[],
  buildings: BuildingRegistry,
): EmploymentReport {
  const posts = new Map<number, Building>();
  for (const building of buildings.all) {
    if (building.isComplete && building.definition.workerSlots > 0) {
      posts.set(building.id, building);
    }
  }

  let released = 0;

  // Every building recounts its staff from the villagers themselves. The
  // building's own list is a cache of this, and rebuilding it here is what
  // stops the two disagreeing after a death, a save or a demolished quota.
  const staff = new Map<number, Villager[]>();
  for (const villager of villagers) {
    if (villager.employerId === null) {
      continue;
    }

    const building = posts.get(villager.employerId);
    if (!building || !villager.isAdult) {
      villager.employerId = null;
      released += 1;
      continue;
    }

    const list = staff.get(building.id);
    if (list) {
      list.push(villager);
    } else {
      staff.set(building.id, [villager]);
    }
  }

  // Trim anyone over quota, newest first — the longest-serving villager keeps
  // the post, which is both the least disruptive choice and a stable one.
  for (const [buildingId, list] of staff) {
    const building = posts.get(buildingId);
    if (!building) {
      continue;
    }
    const wanted = building.hiringTarget;
    if (list.length <= wanted) {
      continue;
    }
    list.sort((a, b) => a.id - b.id);
    for (const villager of list.splice(wanted)) {
      villager.employerId = null;
      released += 1;
    }
  }

  const unemployed = villagers.filter(
    (villager) => villager.isAdult && villager.employerId === null,
  );

  let hired = 0;
  let vacancies = 0;

  // Buildings in id order, so an older workshop is staffed before a newer one
  // when there are not enough people for both. A settlement short of hands
  // should keep running what it already had.
  for (const building of [...posts.values()].sort((a, b) => a.id - b.id)) {
    const list = staff.get(building.id) ?? [];
    let short = building.hiringTarget - list.length;

    while (short > 0) {
      const nearest = nearestFree(unemployed, building);
      if (!nearest) {
        vacancies += short;
        break;
      }
      nearest.employerId = building.id;
      list.push(nearest);
      unemployed.splice(unemployed.indexOf(nearest), 1);
      hired += 1;
      short -= 1;
    }

    staff.set(building.id, list);
  }

  for (const building of buildings.all) {
    building.workers.length = 0;
    building.workers.push(...(staff.get(building.id) ?? []).map((villager) => villager.id));
  }

  return { hired, released, labourers: unemployed.length, vacancies };
}

/** The unemployed adult closest to a building's door. Ties break on id. */
function nearestFree(unemployed: readonly Villager[], building: Building): Villager | null {
  let best: Villager | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const villager of unemployed) {
    const dx = villager.position.wx - building.accessCell.gx;
    const dy = villager.position.wy - building.accessCell.gy;
    const distance = dx * dx + dy * dy;
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && villager.id < best.id)
    ) {
      best = villager;
      bestDistance = distance;
    }
  }

  return best;
}
