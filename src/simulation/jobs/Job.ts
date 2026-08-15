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

import type { GridPoint } from '@/shared/types/geometry';

export type JobType = 'move-to' | 'chop-tree';

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
}

/** How long each kind of work takes, in ticks. Balance comes later. */
export const JOB_WORK_TICKS: Readonly<Record<JobType, number>> = {
  'move-to': 0,
  'chop-tree': 25,
};

export function isFinished(job: Job): boolean {
  return job.state === 'complete' || job.state === 'cancelled';
}

/** `true` when a villager could pick this job up right now. */
export function isClaimable(job: Job): boolean {
  return job.state === 'available' && job.assignedVillager === null;
}
