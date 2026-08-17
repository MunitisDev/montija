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
 * **The levers this gives the player are the important part.** Each building has
 * a desired number of workers, which they can turn down to zero. A settlement
 * that is starving does not need three people splitting firewood, and until now
 * there was no way to say so.
 *
 * On top of that, a villager may be **posted** to a particular building, or
 * kept off the workshops as a labourer. Quotas say how many; a posting says
 * *who*. They are different questions, and only the first had an answer before:
 * a player who wanted their strongest hauler to stay a hauler, or wanted this
 * specific person at the new forge, had to turn quotas down all over the
 * settlement and hope the nearest-first rule picked the right body.
 *
 * Postings are honoured before automatic hiring and never override a quota. A
 * building wanting two people gets two, whoever asked for them.
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
    // Somebody the player has posted elsewhere, or deliberately kept as a
    // labourer, gives up the post they are holding — otherwise the instruction
    // would only take effect the next time they happened to be released.
    if (
      villager.employerId !== null &&
      villager.workPreference !== null &&
      villager.workPreference !== villager.employerId
    ) {
      villager.employerId = null;
      released += 1;
      continue;
    }

    if (villager.employerId === null) {
      continue;
    }

    const building = posts.get(villager.employerId);
    // Retiring at sixty releases the post as surely as dying does.
    if (!building || !villager.canWork) {
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

  // Make room for the people the player named.
  //
  // Without this a posting silently did nothing whenever the workshop was
  // already full — which is most of the time, because automatic employment
  // fills everything it can. The control would have looked broken: you name
  // somebody for the forge, and nothing happens, for reasons the game never
  // explains. A posting displaces somebody the settlement merely *placed*
  // there, never somebody else the player posted.
  for (const building of posts.values()) {
    const list = staff.get(building.id);
    if (!list || list.length === 0) {
      continue;
    }

    const waiting = villagers.filter(
      (villager) =>
        villager.canWork && villager.employerId === null && villager.workPreference === building.id,
    ).length;
    if (waiting === 0) {
      continue;
    }

    // Newest first, so the longest-serving of the automatic staff is the last
    // to be moved on — the same stability rule the quota trim below follows.
    const automatic = list
      .filter((villager) => villager.workPreference !== building.id)
      .sort((a, b) => b.id - a.id);

    for (const villager of automatic.slice(0, waiting)) {
      villager.employerId = null;
      list.splice(list.indexOf(villager), 1);
      released += 1;
    }
  }

  // Trim anyone over quota. Villagers posted here by the player keep their
  // place ahead of anyone the settlement merely put here, and among equals the
  // longest-serving stays — the least disruptive choice, and a stable one.
  for (const [buildingId, list] of staff) {
    const building = posts.get(buildingId);
    if (!building) {
      continue;
    }
    const wanted = building.hiringTarget;
    if (list.length <= wanted) {
      continue;
    }
    list.sort((a, b) => {
      const byPosting =
        Number(b.workPreference === buildingId) - Number(a.workPreference === buildingId);
      return byPosting !== 0 ? byPosting : a.id - b.id;
    });
    for (const villager of list.splice(wanted)) {
      villager.employerId = null;
      released += 1;
    }
  }

  const unemployed = villagers.filter(
    (villager) => villager.canWork && villager.employerId === null,
  );

  let hired = 0;
  let vacancies = 0;

  const take = (villager: Villager, building: Building, list: Villager[]): void => {
    villager.employerId = building.id;
    list.push(villager);
    unemployed.splice(unemployed.indexOf(villager), 1);
    hired += 1;
  };

  // Buildings in id order, so an older workshop is staffed before a newer one
  // when there are not enough people for both. A settlement short of hands
  // should keep running what it already had.
  for (const building of [...posts.values()].sort((a, b) => a.id - b.id)) {
    const list = staff.get(building.id) ?? [];
    let short = building.hiringTarget - list.length;

    // Anyone posted here comes first, however far away they are. The player
    // asked for this person by name; walking is their problem.
    while (short > 0) {
      const posted = unemployed.find((villager) => villager.workPreference === building.id);
      if (!posted) {
        break;
      }
      take(posted, building, list);
      short -= 1;
    }

    // **Then the specialist, and only then whoever is nearest.**
    //
    // A settlement that has spent five years making a master woodcutter and then
    // hands the woodcutter's post to whoever happened to be standing closer has
    // thrown those five years away, and the player has no way to see it happen.
    // Experience at *this* trade wins; among equals — which is everybody, most
    // of the time — the nearest still wins, so nothing changes for a village that
    // has not specialised yet.
    //
    // Only from those who have not been spoken for: somebody posted to another
    // workshop is waiting for it, and somebody kept as a labourer stays one.
    const trade = building.definition.id;
    while (short > 0) {
      const free = unemployed.filter((villager) => villager.workPreference === null);
      const bestExperience = free.reduce(
        (most, villager) => Math.max(most, villager.experienceAt(trade)),
        0,
      );
      const candidates =
        bestExperience > 0
          ? free.filter((villager) => villager.experienceAt(trade) === bestExperience)
          : free;

      const chosen = nearestFree(candidates, building);
      if (!chosen) {
        vacancies += short;
        break;
      }
      take(chosen, building, list);
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
