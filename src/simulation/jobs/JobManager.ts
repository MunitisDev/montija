/**
 * The job board.
 *
 * Villagers do not decide what to do; they ask here. This will become one of
 * the central systems in the game, so it is built to be inspected: every job
 * has an id, a state and an owner, and the counts are surfaced in the debug
 * overlay.
 *
 * **Reservation is the whole point.** Two villagers must never claim the same
 * tree. Exclusivity is enforced twice over, because getting it wrong produces
 * bugs that only appear under load:
 *
 * - a job can only be claimed while `available`, and claiming assigns it
 *   atomically within the tick;
 * - the *target* is reserved too, so a second job for the same tree cannot even
 *   be created while the first is live.
 */

import type { GridPoint } from '@/shared/types/geometry';
import type { ResourceId } from '@/data/resources';
import { JOB_WORK_TICKS, isClaimable, type HaulSource, type Job, type JobType } from './Job';

export interface JobManagerStats {
  readonly total: number;
  readonly available: number;
  readonly assigned: number;
  readonly completed: number;
  readonly cancelled: number;
}

export interface CreateJobOptions {
  readonly type: JobType;
  readonly target: GridPoint;
  readonly priority: number;
  readonly targetEntityId?: number | null;
  /** Where a hauled load should be delivered. */
  readonly deliverTo?: GridPoint | null;
  /** Overrides the default work time for this job type. */
  readonly workTicks?: number;
  readonly haulSource?: HaulSource;
  readonly haulResource?: ResourceId;
  /** The pile a haul draws from, when the job's target is not that pile. */
  readonly haulPileId?: number;
  /**
   * Which of the target's exclusive posts this job occupies.
   *
   * A tree is one indivisible thing, but a workshop with two worker slots has
   * two, and reserving the building as a whole would leave the second slot
   * permanently empty. Defaults to slot 0, which is what every single-target
   * job wants.
   */
  readonly reservationSlot?: number;
  /** `true` when the player asked for it. Only felling reads it — see `Job`. */
  readonly playerOrdered?: boolean;
  /** The building whose workers own this job. See {@link Job.employerId}. */
  readonly employerId?: number;
}

export class JobManager {
  private readonly jobs = new Map<number, Job>();
  /**
   * Entity ids with a live job against them, keyed `type:id`.
   *
   * Keyed by type as well as id so a tree and a future resource pile sharing
   * the number 7 do not collide.
   */
  private readonly reservedTargets = new Set<string>();
  private nextId = 1;
  private completedCount = 0;
  private cancelledCount = 0;
  /** Bumped whenever the board changes, so renderers can skip diffing it. */
  private changeVersion = 0;

  public get all(): readonly Job[] {
    return [...this.jobs.values()];
  }

  /** Increments on every create, complete and cancel. */
  public get version(): number {
    return this.changeVersion;
  }

  public get(id: number): Job | null {
    return this.jobs.get(id) ?? null;
  }

  public stats(): JobManagerStats {
    let available = 0;
    let assigned = 0;
    for (const job of this.jobs.values()) {
      if (isClaimable(job)) {
        available += 1;
      } else if (job.assignedVillager !== null) {
        assigned += 1;
      }
    }
    return {
      total: this.jobs.size,
      available,
      assigned,
      completed: this.completedCount,
      cancelled: this.cancelledCount,
    };
  }

  /** `true` when something already has a live job against it. */
  public isTargetReserved(type: JobType, entityId: number, slot = 0): boolean {
    return this.reservedTargets.has(targetKey(type, entityId, slot));
  }

  /** How many of a target's slots are currently taken. */
  public reservedSlotCount(type: JobType, entityId: number, slots: number): number {
    let taken = 0;
    for (let slot = 0; slot < slots; slot++) {
      if (this.isTargetReserved(type, entityId, slot)) {
        taken += 1;
      }
    }
    return taken;
  }

  /** The lowest free slot on a target, or `null` when all are taken. */
  public firstFreeSlot(type: JobType, entityId: number, slots: number): number | null {
    for (let slot = 0; slot < slots; slot++) {
      if (!this.isTargetReserved(type, entityId, slot)) {
        return slot;
      }
    }
    return null;
  }

  /**
   * Posts a new job.
   *
   * @returns the job, or `null` when its target is already spoken for — which
   *   is the normal answer when a player taps the same tree twice.
   */
  public create(options: CreateJobOptions): Job | null {
    const entityId = options.targetEntityId ?? null;

    const slot = options.reservationSlot ?? 0;

    if (entityId !== null && this.isTargetReserved(options.type, entityId, slot)) {
      return null;
    }

    const job: Job = {
      id: this.nextId,
      type: options.type,
      priority: options.priority,
      target: options.target,
      targetEntityId: entityId,
      assignedVillager: null,
      state: 'available',
      workRemaining: options.workTicks ?? JOB_WORK_TICKS[options.type],
      stage: options.type === 'haul' ? 'collect' : 'work',
      deliverTo: options.deliverTo ?? null,
      haulSource: options.type === 'haul' ? (options.haulSource ?? 'pile') : null,
      haulResource: options.haulResource ?? null,
      ...(options.haulPileId === undefined ? {} : { haulPileId: options.haulPileId }),
      reservationSlot: slot,
      ...(options.playerOrdered === true ? { playerOrdered: true } : {}),
      ...(options.employerId === undefined ? {} : { employerId: options.employerId }),
    };

    this.nextId += 1;
    this.changeVersion += 1;
    this.jobs.set(job.id, job);
    if (entityId !== null) {
      this.reservedTargets.add(targetKey(options.type, entityId, slot));
    }

    return job;
  }

  /**
   * Claims the best available job for a villager.
   *
   * Highest priority wins; ties break on distance, then on job id. That final
   * tiebreak is not cosmetic — without it, two villagers equidistant from two
   * equal jobs could be assigned in an order that depends on iteration, and the
   * simulation would stop being reproducible.
   *
   * @param from where the villager is standing, for the distance tiebreak
   * @returns the claimed job, or `null` when there is no work
   */
  public claimBest(
    villagerId: number,
    from: GridPoint,
    canTake: (job: Job) => boolean = () => true,
  ): Job | null {
    let best: Job | null = null;
    let bestDistance = 0;

    for (const job of this.jobs.values()) {
      if (!isClaimable(job) || !canTake(job)) {
        continue;
      }

      const distance = Math.hypot(job.target.gx - from.gx, job.target.gy - from.gy);

      if (best === null) {
        best = job;
        bestDistance = distance;
        continue;
      }

      if (job.priority !== best.priority) {
        if (job.priority > best.priority) {
          best = job;
          bestDistance = distance;
        }
        continue;
      }

      if (distance < bestDistance || (distance === bestDistance && job.id < best.id)) {
        best = job;
        bestDistance = distance;
      }
    }

    if (!best) {
      return null;
    }

    best.assignedVillager = villagerId;
    best.state = 'reserved';
    return best;
  }

  /** Marks a claimed job as being worked on, rather than travelled to. */
  public beginWork(jobId: number): void {
    const job = this.jobs.get(jobId);
    if (job && job.state === 'reserved') {
      job.state = 'inProgress';
    }
  }

  /**
   * Hands a job back to the board.
   *
   * Used when a villager cannot reach it, or dies mid-task. The job stays on
   * the board so someone else can try, rather than vanishing silently.
   */
  public release(jobId: number): void {
    const job = this.jobs.get(jobId);
    if (!job || job.state === 'complete' || job.state === 'cancelled') {
      return;
    }
    job.assignedVillager = null;
    job.state = 'available';
  }

  public complete(jobId: number): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    job.state = 'complete';
    job.assignedVillager = null;
    this.completedCount += 1;
    this.forget(job);
  }

  /** Abandons a job, e.g. when the player cancels a designation. */
  public cancel(jobId: number): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    job.state = 'cancelled';
    job.assignedVillager = null;
    this.cancelledCount += 1;
    this.forget(job);
  }

  /** The live job against an entity, if any. */
  public findByTarget(type: JobType, entityId: number): Job | null {
    for (const job of this.jobs.values()) {
      if (job.type === type && job.targetEntityId === entityId) {
        return job;
      }
    }
    return null;
  }

  /** Replaces the whole board from a save. */
  public restore(jobs: readonly Job[]): void {
    this.jobs.clear();
    this.reservedTargets.clear();
    this.nextId = 1;

    for (const job of jobs) {
      // Saves written before workshops had per-slot reservations carry no slot.
      const restored: Job = { ...job, reservationSlot: job.reservationSlot ?? 0 };
      this.jobs.set(restored.id, restored);
      this.nextId = Math.max(this.nextId, restored.id + 1);
      if (restored.targetEntityId !== null) {
        this.reservedTargets.add(
          targetKey(restored.type, restored.targetEntityId, restored.reservationSlot),
        );
      }
    }
    this.changeVersion += 1;
  }

  /** Drops a finished job from the board and frees its target. */
  private forget(job: Job): void {
    this.changeVersion += 1;
    this.jobs.delete(job.id);
    if (job.targetEntityId !== null) {
      this.reservedTargets.delete(targetKey(job.type, job.targetEntityId, job.reservationSlot));
    }
  }
}

function targetKey(type: JobType, entityId: number, slot: number): string {
  return `${type}:${entityId}:${slot}`;
}
