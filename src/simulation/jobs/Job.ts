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
  | 'plant-tree'
  | 'demolish'
  | 'carry-message';

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
   * Which of the target's exclusive posts this job holds.
   *
   * Almost always 0. A workshop with several worker slots is the exception: its
   * slots are reserved separately so more than one villager can work it.
   */
  reservationSlot: number;
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
  // Setting a sapling. Quick work; the waiting is done by the tree.
  'plant-tree': 15,
  // Corking a bottle and throwing it. The work is the walk to the water, and
  // the walk is most of the point — see `rescue/RescueSystem.ts`.
  'carry-message': 10,
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
