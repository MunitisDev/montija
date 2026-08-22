/**
 * Job definitions.
 *
 * A job is **plain data**, not an object with behaviour. Behaviour lives in the
 * system that executes it, keyed by {@link JobType}. That is a deliberate
 * choice for Phase 9: a job carrying closures or subclass identity cannot be
 * written to a save and read back, whereas this serialises as-is.
 *
 * It is also what keeps villager logic out of one giant conditional. A villager
 * does not ask "am I chopping? am I hauling?" — it asks the job manager for
 * work and runs whatever it is handed.
 */

import type { ResourceId } from '@/data/resources';
import type { GridPoint } from '@/shared/types/geometry';

/**
 * Where a haul picks its load up from.
 *
 * Both exist because the two directions of the economy are different: gathered
 * resources come off the ground into a yard, and construction materials come
 * out of a yard to a site.
 */
export type HaulSource = 'pile' | 'storage';

export type JobType =
  | 'move-to'
  | 'chop-tree'
  | 'gather-stone'
  | 'haul'
  | 'build'
  | 'produce'
  | 'pave-road'
  | 'dig-ditch'
  | 'raise-fence'
  | 'demolish';

/**
 * Which leg of a multi-stage job is being done.
 *
 * Hauling is two journeys, not one: fetch the pile, then deliver it. Modelling
 * that as a field rather than as two separate jobs keeps the reservation on the
 * pile intact for the whole round trip — splitting it would let a second
 * villager claim the pile the moment the first picked it up.
 */
export type JobStage = 'work' | 'collect' | 'deliver';

/**
 * Where a job is in its lifecycle.
 *
 * ```text
 * available ──claim──▶ reserved ──arrive──▶ inProgress ──finish──▶ complete
 *     ▲                    │                     │
 *     └──────release───────┴─────────────────────┘
 * ```
 */
export type JobState = 'available' | 'reserved' | 'inProgress' | 'complete' | 'cancelled';

/**
 * Higher runs first. Left as plain numbers rather than an enum so future
 * content can slot priorities between existing ones without renumbering.
 */
export const JobPriority = {
  low: 10,
  normal: 20,
  high: 30,
  urgent: 40,
  /**
   * Above a workshop's own work, which nothing else is.
   *
   * Reserved for goods that have been lying on the ground so long that making
   * more of them is worse than useless. A workshop's produce job is `urgent`, so
   * this is the one thing in the game that will take a forager out of her hut —
   * and it is her own harvest she is being sent to carry. See
   * `Simulation.haulWorth`.
   */
  overdue: 50,
} as const;

export interface Job {
  readonly id: number;
  readonly type: JobType;
  priority: number;
  /** Where the work happens. */
  readonly target: GridPoint;
  /**
   * The thing being worked on, when the job needs exclusive access to one —
   * a tree, and later a resource pile or a construction site. `null` for jobs
   * that only involve a location.
   */
  readonly targetEntityId: number | null;
  assignedVillager: number | null;
  state: JobState;
  /** Simulation ticks of work left once the villager is in position. */
  workRemaining: number;
  /** Which leg of the job is current. `work` for single-stage jobs. */
  stage: JobStage;
  /** Where a hauled load is going. `null` for jobs that deliver nothing. */
  deliverTo: GridPoint | null;
  /** Where a haul collects from. `null` for jobs that carry nothing. */
  haulSource: HaulSource | null;
  /** Which resource a storage-sourced haul should take. */
  haulResource: ResourceId | null;
  /**
   * Which pile a haul is drawing from, when that is not the job's own target.
   *
   * An ordinary haul reserves the pile it is emptying, so the pile's id *is* the
   * target id. A delivery to a building site reserves "this site's next load of
   * stone" instead — one run per material at a time — and so needs somewhere else
   * to record which pile on the ground it is fetching. Optional, so a save
   * written before sites could be built out of the ground still loads.
   */
  haulPileId?: number;
  /**
   * Which of the target's exclusive posts this job holds.
   *
   * Almost always 0. A workshop with several worker slots is the exception: its
   * slots are reserved separately so more than one villager can work it.
   */
  reservationSlot: number;
  /**
   * `true` when the player asked for this work rather than a building.
   *
   * Only felling reads it, and it decides whether the ground grows back: a tree
   * the player marked was marked to clear ground, and cleared ground stays
   * cleared. See `world/Woodland.ts`. Optional so an older save loads with every
   * standing order treated as a workshop's, which is the harmless reading.
   */
  playerOrdered?: boolean;
  /**
   * The building whose own workers this job belongs to.
   *
   * **Set so that felling can be somebody's trade rather than everybody's
   * chore.** Ordinary work is open to anyone, and priority decides what gets
   * done first — which is right for hauling and building, and was wrong for
   * felling: a settlement with a hundred loads on the ground always has
   * something more urgent than cutting a tree, so the timber never came in and
   * the wood pile never grew. Felling posted by a Feller's Hut is that hut's
   * work, at the priority its own workshop's work gets, and nobody else's.
   *
   * Optional so a save written before there were fellers loads with every
   * standing order open to anyone, which is what it was.
   */
  employerId?: number;
}

/** How long each kind of work takes, in ticks. Balance comes later. */
export const JOB_WORK_TICKS: Readonly<Record<JobType, number>> = {
  'move-to': 0,
  'chop-tree': 25,
  'gather-stone': 30,
  // Hauling costs travel, not labour: picking up and setting down are instant.
  haul: 0,
  // Overridden per building from its definition when the job is created.
  build: 100,
  // Overridden per recipe.
  produce: 40,
  // Clearing and beating a track flat. Short, because a road is only worth
  // laying if a settlement can afford to lay a line of them.
  'pave-road': 20,
  // Digging a channel and letting the water in.
  //
  // **Two days of one person's work**, which is the point of it. A ditch is how a
  // settlement decides where its orchards can be, and a decision that costs an
  // afternoon is not a decision — it is a tap. Compare a road at 20: beating a
  // track flat is an errand, cutting a channel is an undertaking.
  'dig-ditch': 120,
  // Driving one cell's worth of stakes into the ground.
  //
  // **Half a day**, which is a third of a ditch and twice a road. A palisade is
  // paid for in timber rather than in time — see `FenceGrid` — so the work is the
  // smaller half of the decision: what makes a player think twice about fencing
  // the whole settlement is the log a cell costs, not the afternoon.
  'raise-fence': 30,
  // Pulling a building down and stacking what is worth keeping. Slower than
  // raising a wall is fast, but far quicker than building it — tearing down is
  // always easier than putting up.
  demolish: 45,
};

export function isFinished(job: Job): boolean {
  return job.state === 'complete' || job.state === 'cancelled';
}

/** `true` when a villager could pick this job up right now. */
export function isClaimable(job: Job): boolean {
  return job.state === 'available' && job.assignedVillager === null;
}
