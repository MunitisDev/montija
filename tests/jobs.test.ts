import { describe, expect, it } from 'vitest';
import { JobPriority, isClaimable } from '@/simulation/jobs/Job';
import { JobManager } from '@/simulation/jobs/JobManager';
import { Simulation } from '@/simulation/Simulation';

function makeManager(): JobManager {
  return new JobManager();
}

describe('JobManager', () => {
  describe('creation', () => {
    it('posts a job as available and unassigned', () => {
      const jobs = makeManager();
      const job = jobs.create({
        type: 'move-to',
        target: { gx: 3, gy: 4 },
        priority: JobPriority.normal,
      });

      expect(job).not.toBeNull();
      expect(job?.state).toBe('available');
      expect(job?.assignedVillager).toBeNull();
      expect(jobs.stats().available).toBe(1);
    });

    it('gives every job a unique id', () => {
      const jobs = makeManager();
      const ids = [1, 2, 3].map(
        (n) =>
          jobs.create({ type: 'move-to', target: { gx: n, gy: 0 }, priority: JobPriority.normal })
            ?.id,
      );

      expect(new Set(ids).size).toBe(3);
    });

    it('sets work time from the job type', () => {
      const jobs = makeManager();
      const chop = jobs.create({
        type: 'chop-tree',
        target: { gx: 0, gy: 0 },
        priority: JobPriority.normal,
        targetEntityId: 1,
      });

      expect(chop?.workRemaining).toBeGreaterThan(0);
    });
  });

  describe('target reservation', () => {
    it('refuses a second job against the same target', () => {
      const jobs = makeManager();
      const first = jobs.create({
        type: 'chop-tree',
        target: { gx: 5, gy: 5 },
        priority: JobPriority.normal,
        targetEntityId: 42,
      });
      const second = jobs.create({
        type: 'chop-tree',
        target: { gx: 5, gy: 5 },
        priority: JobPriority.normal,
        targetEntityId: 42,
      });

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(jobs.stats().total).toBe(1);
    });

    it('allows a job against a different target', () => {
      const jobs = makeManager();
      jobs.create({
        type: 'chop-tree',
        target: { gx: 5, gy: 5 },
        priority: JobPriority.normal,
        targetEntityId: 42,
      });
      const other = jobs.create({
        type: 'chop-tree',
        target: { gx: 6, gy: 5 },
        priority: JobPriority.normal,
        targetEntityId: 43,
      });

      expect(other).not.toBeNull();
    });

    it('does not confuse targets of different job types sharing an id', () => {
      const jobs = makeManager();
      jobs.create({
        type: 'chop-tree',
        target: { gx: 0, gy: 0 },
        priority: JobPriority.normal,
        targetEntityId: 7,
      });
      const moveTo = jobs.create({
        type: 'move-to',
        target: { gx: 1, gy: 1 },
        priority: JobPriority.normal,
        targetEntityId: 7,
      });

      expect(moveTo).not.toBeNull();
    });

    it('frees the target once the job completes', () => {
      const jobs = makeManager();
      const job = jobs.create({
        type: 'chop-tree',
        target: { gx: 0, gy: 0 },
        priority: JobPriority.normal,
        targetEntityId: 9,
      })!;

      jobs.complete(job.id);

      expect(jobs.isTargetReserved('chop-tree', 9)).toBe(false);
    });

    it('frees the target once the job is cancelled', () => {
      const jobs = makeManager();
      const job = jobs.create({
        type: 'chop-tree',
        target: { gx: 0, gy: 0 },
        priority: JobPriority.normal,
        targetEntityId: 9,
      })!;

      jobs.cancel(job.id);

      expect(jobs.isTargetReserved('chop-tree', 9)).toBe(false);
    });
  });

  describe('claiming', () => {
    it('assigns a job exclusively — two villagers never share one', () => {
      const jobs = makeManager();
      jobs.create({ type: 'move-to', target: { gx: 1, gy: 1 }, priority: JobPriority.normal });

      const first = jobs.claimBest(100, { gx: 0, gy: 0 });
      const second = jobs.claimBest(200, { gx: 0, gy: 0 });

      expect(first).not.toBeNull();
      expect(first?.assignedVillager).toBe(100);
      // The only job is taken; the second villager must get nothing.
      expect(second).toBeNull();
    });

    it('gives ten villagers ten distinct jobs', () => {
      const jobs = makeManager();
      for (let i = 0; i < 10; i += 1) {
        jobs.create({
          type: 'chop-tree',
          target: { gx: i, gy: 0 },
          priority: JobPriority.normal,
          targetEntityId: i,
        });
      }

      const claimed = Array.from({ length: 10 }, (_, i) => jobs.claimBest(i, { gx: 0, gy: 0 }));

      expect(claimed.every((job) => job !== null)).toBe(true);
      expect(new Set(claimed.map((job) => job!.id)).size).toBe(10);
      expect(jobs.stats().available).toBe(0);
    });

    it('returns null when there is no work', () => {
      expect(makeManager().claimBest(1, { gx: 0, gy: 0 })).toBeNull();
    });

    it('takes the highest priority first, regardless of distance', () => {
      const jobs = makeManager();
      jobs.create({ type: 'move-to', target: { gx: 1, gy: 0 }, priority: JobPriority.low });
      const urgent = jobs.create({
        type: 'move-to',
        target: { gx: 40, gy: 40 },
        priority: JobPriority.urgent,
      });

      expect(jobs.claimBest(1, { gx: 0, gy: 0 })?.id).toBe(urgent?.id);
    });

    it('breaks priority ties on distance', () => {
      const jobs = makeManager();
      jobs.create({ type: 'move-to', target: { gx: 20, gy: 20 }, priority: JobPriority.normal });
      const near = jobs.create({
        type: 'move-to',
        target: { gx: 1, gy: 1 },
        priority: JobPriority.normal,
      });

      expect(jobs.claimBest(1, { gx: 0, gy: 0 })?.id).toBe(near?.id);
    });

    it('breaks distance ties on job id, so assignment is reproducible', () => {
      const jobs = makeManager();
      // Two jobs equidistant from the origin.
      const first = jobs.create({
        type: 'move-to',
        target: { gx: 3, gy: 0 },
        priority: JobPriority.normal,
      });
      jobs.create({ type: 'move-to', target: { gx: 0, gy: 3 }, priority: JobPriority.normal });

      expect(jobs.claimBest(1, { gx: 0, gy: 0 })?.id).toBe(first?.id);
    });

    it('marks a claimed job as no longer claimable', () => {
      const jobs = makeManager();
      const job = jobs.create({
        type: 'move-to',
        target: { gx: 1, gy: 1 },
        priority: JobPriority.normal,
      })!;

      jobs.claimBest(5, { gx: 0, gy: 0 });

      expect(isClaimable(job)).toBe(false);
      expect(job.state).toBe('reserved');
    });
  });

  describe('lifecycle', () => {
    it('returns a released job to the board', () => {
      const jobs = makeManager();
      const job = jobs.create({
        type: 'move-to',
        target: { gx: 1, gy: 1 },
        priority: JobPriority.normal,
      })!;
      jobs.claimBest(1, { gx: 0, gy: 0 });

      jobs.release(job.id);

      expect(job.state).toBe('available');
      expect(job.assignedVillager).toBeNull();
      expect(jobs.claimBest(2, { gx: 0, gy: 0 })?.id).toBe(job.id);
    });

    it('moves a claimed job into progress when work starts', () => {
      const jobs = makeManager();
      const job = jobs.create({
        type: 'chop-tree',
        target: { gx: 1, gy: 1 },
        priority: JobPriority.normal,
        targetEntityId: 1,
      })!;
      jobs.claimBest(1, { gx: 0, gy: 0 });

      jobs.beginWork(job.id);

      expect(job.state).toBe('inProgress');
    });

    it('drops completed jobs off the board and counts them', () => {
      const jobs = makeManager();
      const job = jobs.create({
        type: 'move-to',
        target: { gx: 1, gy: 1 },
        priority: JobPriority.normal,
      })!;

      jobs.complete(job.id);

      expect(jobs.get(job.id)).toBeNull();
      expect(jobs.stats().completed).toBe(1);
      expect(jobs.stats().total).toBe(0);
    });

    it('ignores operations on unknown job ids', () => {
      const jobs = makeManager();

      expect(() => {
        jobs.complete(999);
        jobs.cancel(999);
        jobs.release(999);
        jobs.beginWork(999);
      }).not.toThrow();
    });

    it('will not release a job that already finished', () => {
      const jobs = makeManager();
      const job = jobs.create({
        type: 'move-to',
        target: { gx: 1, gy: 1 },
        priority: JobPriority.normal,
      })!;
      jobs.complete(job.id);

      jobs.release(job.id);

      expect(job.state).toBe('complete');
    });

    it('finds a live job by its target', () => {
      const jobs = makeManager();
      const job = jobs.create({
        type: 'chop-tree',
        target: { gx: 2, gy: 2 },
        priority: JobPriority.normal,
        targetEntityId: 77,
      })!;

      expect(jobs.findByTarget('chop-tree', 77)?.id).toBe(job.id);
      expect(jobs.findByTarget('chop-tree', 78)).toBeNull();
    });
  });
});

describe('Simulation job integration', () => {
  const options = { seed: 20260815, worldWidth: 48, worldHeight: 48, startingVillagers: 10 };
  const TICK = 0.1;

  function firstTreeCell(simulation: Simulation) {
    const tree = [...simulation.world.trees.all][0]!;
    return { gx: tree.gx, gy: tree.gy };
  }

  it('designates a tree for felling', () => {
    const simulation = new Simulation(options);
    const cell = firstTreeCell(simulation);

    expect(simulation.designateTreeForFelling(cell)).toBe(true);
    expect(simulation.isTreeDesignated(cell)).toBe(true);
    expect(simulation.snapshot().jobsAvailable).toBe(1);
  });

  it('refuses to designate the same tree twice', () => {
    const simulation = new Simulation(options);
    const cell = firstTreeCell(simulation);

    simulation.designateTreeForFelling(cell);

    expect(simulation.designateTreeForFelling(cell)).toBe(false);
    expect(simulation.snapshot().jobsAvailable).toBe(1);
  });

  it('refuses to designate an empty cell', () => {
    const simulation = new Simulation(options);
    const cell = firstTreeCell(simulation);
    simulation.world.fellTree(simulation.world.trees.getAt(cell)!.id);

    expect(simulation.designateTreeForFelling(cell)).toBe(false);
  });

  it('cancels a designation and frees the tree', () => {
    const simulation = new Simulation(options);
    const cell = firstTreeCell(simulation);
    simulation.designateTreeForFelling(cell);

    expect(simulation.cancelTreeDesignation(cell)).toBe(true);
    expect(simulation.isTreeDesignated(cell)).toBe(false);
    // Free again, so it can be re-designated.
    expect(simulation.designateTreeForFelling(cell)).toBe(true);
  });

  it('sends a villager to fell a designated tree', () => {
    const simulation = new Simulation(options);
    const cell = firstTreeCell(simulation);
    const treeId = simulation.world.trees.getAt(cell)!.id;

    simulation.designateTreeForFelling(cell);

    for (let tick = 1; tick <= 4000 && simulation.world.trees.getById(treeId); tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.world.trees.getById(treeId)).toBeNull();
    expect(simulation.snapshot().jobsCompleted).toBe(1);
  });

  it('clears the ground where a tree stood, so it can be built on', () => {
    const simulation = new Simulation(options);
    const cell = firstTreeCell(simulation);
    expect(simulation.world.isBuildable(cell)).toBe(false);

    simulation.world.fellTree(simulation.world.trees.getAt(cell)!.id);

    expect(simulation.world.terrainAt(cell)).toBe('grass');
    expect(simulation.world.isBuildable(cell)).toBe(true);
  });

  it('never assigns two villagers to the same tree', () => {
    const simulation = new Simulation(options);
    const trees = [...simulation.world.trees.all].slice(0, 20);
    for (const tree of trees) {
      simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
    }

    for (let tick = 1; tick <= 600; tick += 1) {
      simulation.update(tick, TICK);

      const held = simulation.villagers.all
        .map((villager) => villager.currentJobId)
        .filter((id): id is number => id !== null);

      expect(new Set(held).size, `tick ${tick} had a shared job`).toBe(held.length);
    }
  });

  it('works through a backlog of designations', () => {
    const simulation = new Simulation(options);
    const trees = [...simulation.world.trees.all].slice(0, 12);
    for (const tree of trees) {
      simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
    }
    const before = simulation.world.trees.count;

    for (let tick = 1; tick <= 6000; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.world.trees.count).toBeLessThan(before);
    expect(simulation.snapshot().jobsCompleted).toBeGreaterThan(0);
  });

  it('stays deterministic with jobs in play', () => {
    const run = (): string => {
      const simulation = new Simulation(options);
      for (const tree of [...simulation.world.trees.all].slice(0, 8)) {
        simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
      }
      for (let tick = 1; tick <= 800; tick += 1) {
        simulation.update(tick, TICK);
      }
      return simulation.villagers.all
        .map(
          (v) =>
            `${v.id}:${v.position.wx.toFixed(4)},${v.position.wy.toFixed(4)}:${v.currentJobId}`,
        )
        .join('|');
    };

    expect(run()).toBe(run());
  });

  it('frees villagers when their designation is cancelled', () => {
    const simulation = new Simulation(options);
    const cell = firstTreeCell(simulation);
    simulation.designateTreeForFelling(cell);

    for (let tick = 1; tick <= 40; tick += 1) {
      simulation.update(tick, TICK);
    }
    simulation.cancelTreeDesignation(cell);

    for (const villager of simulation.villagers.all) {
      expect(villager.currentJobId).toBeNull();
    }
  });
});
