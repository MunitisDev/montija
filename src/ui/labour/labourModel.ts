/**
 * Where the settlement's hands are, on one page.
 *
 * **The question this answers could not be asked before.** A player with nine
 * workshops and a settlement that has stopped growing wants to know one thing:
 * *who is working where, and who is spare*. The only way to find out was to tap
 * each building in turn and read its panel, and the only way to move somebody was
 * to tap the building they should leave, then the building they should join —
 * with the map in between. On a tablet that is a dozen taps to make one decision.
 *
 * So: every workplace listed at once, each with what it wants, what it has got,
 * and a pair of buttons. The labourers — the people on no payroll, who fell,
 * haul and build — are counted at the top, because every post filled is one of
 * them gone and that trade is the whole decision.
 *
 * **The quota is what the buttons move, and the staff is what came of it.** They
 * are different numbers and the panel shows both: a workshop can ask for three
 * and have one, because there is nobody spare, or because the two it had were
 * needed at a hut that asked first. Hiding that behind a single figure would make
 * the panel lie on exactly the settlements that need it.
 *
 * Pure, like the roster and the ledger: simulation and a translator in, plain
 * rows out. What a press *does* belongs to the renderer, and what it does to the
 * settlement belongs to `Simulation.setDesiredWorkers`.
 */

import { skillLevelOf } from '@/data/skills';
import type { Building } from '@/simulation/buildings/Building';
import type { Simulation } from '@/simulation/Simulation';
import type { Villager } from '@/simulation/villagers/Villager';
import type { MessageKey } from '@/ui/i18n/messages';

export type Translate = (key: MessageKey) => string;

/** One person at a post, as the row names them. */
export interface LabourWorker {
  readonly id: number;
  readonly name: string;
  /** Their level at *this* trade, translated, or `''` below apprentice. */
  readonly level: string;
  /** `true` for expert and master — the hands worth keeping where they are. */
  readonly isSpecialist: boolean;
}

/** One workplace. */
export interface LabourPost {
  readonly buildingId: number;
  readonly name: string;
  /** How many the player has asked for. This is what the buttons move. */
  readonly desired: number;
  /** How many are actually posted there right now. */
  readonly staffed: number;
  readonly slots: number;
  readonly canAdd: boolean;
  readonly canRemove: boolean;
  /**
   * `true` when the settlement could not fill what was asked for.
   *
   * Not an error, and not always a problem — a settlement with nobody spare is
   * simply full — but it is the thing the player opened this panel to find.
   */
  readonly short: boolean;
  readonly workers: readonly LabourWorker[];
}

export interface LabourView {
  readonly posts: readonly LabourPost[];
  readonly summary: {
    /** People of working age: fourteen to sixty. Nobody else can be posted. */
    readonly workforce: number;
    readonly employed: number;
    /** Free to fell, haul and build. The pool every post draws from. */
    readonly labourers: number;
    /** Posts asked for and not filled. */
    readonly vacancies: number;
  };
}

export function buildLabour(simulation: Simulation, t: Translate): LabourView {
  const byId = new Map(simulation.villagers.all.map((villager) => [villager.id, villager]));

  const posts: LabourPost[] = [];
  for (const building of simulation.world.buildings.all) {
    if (!building.isComplete || building.definition.workerSlots <= 0) {
      // A site still going up has no posts to offer, and a house is not a job.
      continue;
    }
    posts.push(describe(building, byId, t));
  }

  // Grouped by trade, then by the order they were raised: two Gatherer Huts
  // belong next to each other, and within a trade the oldest first is the order
  // the player built them in.
  posts.sort((a, b) => a.name.localeCompare(b.name) || a.buildingId - b.buildingId);

  numberTheDuplicates(posts);

  const snapshot = simulation.snapshot();
  const workforce = simulation.villagers.all.filter((villager) => villager.canWork).length;

  return {
    posts,
    summary: {
      workforce,
      employed: posts.reduce((total, post) => total + post.staffed, 0),
      labourers: snapshot.employment.labourers,
      vacancies: snapshot.employment.vacancies,
    },
  };
}

/**
 * Numbers the workshops a settlement has more than one of.
 *
 * Two rows both saying "Gatherer Hut" leave the player choosing between two
 * things they cannot tell apart. Numbered in the order they were built, so the
 * first hut stays the first hut for the life of the settlement — and a trade with
 * only one workshop keeps its plain name, because "Woodcutter 1" is a number
 * about nothing.
 */
function numberTheDuplicates(posts: LabourPost[]): void {
  const totals = new Map<string, number>();
  for (const post of posts) {
    totals.set(post.name, (totals.get(post.name) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  posts.forEach((post, index) => {
    if ((totals.get(post.name) ?? 0) < 2) {
      return;
    }
    const nth = (seen.get(post.name) ?? 0) + 1;
    seen.set(post.name, nth);
    posts[index] = { ...post, name: `${post.name} ${nth}` };
  });
}

function describe(
  building: Building,
  byId: ReadonlyMap<number, Villager>,
  t: Translate,
): LabourPost {
  const trade = building.definition.id;
  const workers: LabourWorker[] = [];
  for (const id of building.workers) {
    const villager = byId.get(id);
    if (!villager) {
      continue;
    }
    const level = skillLevelOf(villager.experienceAt(trade));
    workers.push({
      id,
      name: villager.name,
      level: level === 'none' ? '' : t(`skill.${level}` as MessageKey),
      isSpecialist: level === 'expert' || level === 'master',
    });
  }

  const desired = building.hiringTarget;
  return {
    buildingId: building.id,
    name: t(`building.${trade}` as MessageKey),
    desired,
    staffed: workers.length,
    slots: building.definition.workerSlots,
    canAdd: desired < building.definition.workerSlots,
    canRemove: desired > 0,
    short: workers.length < desired,
    // The specialists first: they are why this post is worth the hands it has,
    // and on a long row they are what the player is looking for.
    workers: workers.sort(
      (a, b) => Number(b.isSpecialist) - Number(a.isSpecialist) || a.name.localeCompare(b.name),
    ),
  };
}
