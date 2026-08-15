import { describe, expect, it } from 'vitest';
import { VILLAGER_WALK_SPEED } from '@/data/villagers';
import { SeededRandom } from '@/shared/math/random';
import { Simulation } from '@/simulation/Simulation';
import { Villager } from '@/simulation/villagers/Villager';
import { VillagerSystem } from '@/simulation/villagers/VillagerSystem';
import { NavigationGrid } from '@/simulation/world/NavigationGrid';
import { TerrainGrid } from '@/simulation/world/TerrainGrid';

const TICK_SECONDS = 0.1;

function openGrid(size = 32): NavigationGrid {
  return new NavigationGrid(new TerrainGrid(size, size, 'grass'));
}

function makeSystem(size = 32, seed = 1): VillagerSystem {
  return new VillagerSystem(openGrid(size), new SeededRandom(seed));
}

describe('Villager', () => {
  it('reports the cell it is standing in', () => {
    const villager = new Villager({ id: 1, name: 'Test', age: 20, position: { wx: 3.5, wy: 4.9 } });
    expect(villager.cell).toEqual({ gx: 3, gy: 4 });
  });

  it('starts idle and stationary', () => {
    const villager = new Villager({ id: 1, name: 'Test', age: 20, position: { wx: 0.5, wy: 0.5 } });

    expect(villager.isMoving).toBe(false);
    expect(villager.activity).toBe('idle');
  });

  it('starts with full needs, which stay inert until Phase 8', () => {
    const villager = new Villager({ id: 1, name: 'Test', age: 20, position: { wx: 0.5, wy: 0.5 } });

    expect(villager.needs).toEqual({ hunger: 100, warmth: 100, health: 100 });
  });

  it('clears its route on demand', () => {
    const villager = new Villager({ id: 1, name: 'Test', age: 20, position: { wx: 0.5, wy: 0.5 } });
    villager.path = [{ gx: 1, gy: 0 }];
    villager.destination = { gx: 1, gy: 0 };

    villager.clearPath();

    expect(villager.isMoving).toBe(false);
    expect(villager.destination).toBeNull();
  });
});

describe('VillagerSystem', () => {
  describe('spawning', () => {
    it('places the requested number of villagers', () => {
      const system = makeSystem();
      expect(system.spawnNear({ gx: 16, gy: 16 }, 10)).toBe(10);
      expect(system.count).toBe(10);
    });

    it('only places villagers on walkable ground', () => {
      const terrain = new TerrainGrid(24, 24, 'water');
      // A single small island of walkable land.
      for (let gy = 10; gy < 14; gy += 1) {
        for (let gx = 10; gx < 14; gx += 1) {
          terrain.set(gx, gy, 'grass');
        }
      }
      const navigation = new NavigationGrid(terrain);
      const system = new VillagerSystem(navigation, new SeededRandom(3));

      system.spawnNear({ gx: 12, gy: 12 }, 10);

      for (const villager of system.all) {
        const cell = villager.cell;
        expect(navigation.isWalkable(cell.gx, cell.gy)).toBe(true);
      }
    });

    it('reports how many it actually placed when there is no room', () => {
      const navigation = new NavigationGrid(new TerrainGrid(8, 8, 'water'));
      const system = new VillagerSystem(navigation, new SeededRandom(1));

      expect(system.spawnNear({ gx: 4, gy: 4 }, 10)).toBe(0);
      expect(system.count).toBe(0);
    });

    it('gives every villager a unique id', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 12);

      expect(new Set(system.all.map((v) => v.id)).size).toBe(12);
    });

    it('gives every villager a name and an adult age', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 10);

      for (const villager of system.all) {
        expect(villager.name.length).toBeGreaterThan(0);
        expect(villager.age).toBeGreaterThanOrEqual(18);
        expect(villager.age).toBeLessThan(46);
      }
    });

    it('spawns identically for the same seed', () => {
      const a = makeSystem(32, 42);
      const b = makeSystem(32, 42);
      a.spawnNear({ gx: 16, gy: 16 }, 8);
      b.spawnNear({ gx: 16, gy: 16 }, 8);

      expect(a.all.map((v) => `${v.name}@${v.position.wx},${v.position.wy}`)).toEqual(
        b.all.map((v) => `${v.name}@${v.position.wx},${v.position.wy}`),
      );
    });
  });

  describe('movement', () => {
    it('walks towards its waypoint at the configured speed', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 1);
      const villager = system.all[0]!;
      const start = villager.position;

      villager.path = [{ gx: villager.cell.gx + 5, gy: villager.cell.gy }];
      system.update(TICK_SECONDS);

      const travelled = Math.hypot(
        villager.position.wx - start.wx,
        villager.position.wy - start.wy,
      );
      expect(travelled).toBeCloseTo(VILLAGER_WALK_SPEED * TICK_SECONDS, 5);
    });

    it('records the previous position each tick, for render interpolation', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 1);
      const villager = system.all[0]!;
      villager.path = [{ gx: villager.cell.gx + 5, gy: villager.cell.gy }];

      system.update(TICK_SECONDS);
      const afterFirst = villager.position;
      system.update(TICK_SECONDS);

      expect(villager.previousPosition).toEqual(afterFirst);
      expect(villager.position).not.toEqual(afterFirst);
    });

    it('arrives at its destination and stops', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 1);
      const villager = system.all[0]!;
      const target = { gx: villager.cell.gx + 2, gy: villager.cell.gy };
      villager.path = [target];

      for (let i = 0; i < 60 && villager.isMoving; i += 1) {
        system.update(TICK_SECONDS);
      }

      expect(villager.isMoving).toBe(false);
      expect(villager.cell).toEqual(target);
    });

    it('consumes several waypoints in one tick when it is fast enough', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 1);
      const villager = system.all[0]!;
      const { gx, gy } = villager.cell;
      villager.path = [
        { gx: gx + 1, gy },
        { gx: gx + 2, gy },
        { gx: gx + 3, gy },
      ];

      // A long tick covers more than one cell of travel.
      system.update(2);

      expect(villager.path).toHaveLength(0);
    });

    it('marks a moving villager as walking and a stopped one as idle', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 1);
      const villager = system.all[0]!;
      villager.path = [{ gx: villager.cell.gx + 4, gy: villager.cell.gy }];

      system.update(TICK_SECONDS);
      expect(villager.activity).toBe('walking');

      villager.clearPath();
      villager.idleTicks = 5;
      system.update(TICK_SECONDS);
      expect(villager.activity).toBe('idle');
    });
  });

  describe('wandering', () => {
    it('sends idle villagers walking on their own', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 10);

      // Long enough for the per-tick path budget to reach everyone.
      let anyMoved = false;
      for (let tick = 0; tick < 200; tick += 1) {
        system.update(TICK_SECONDS);
        if (system.stats().walking > 0) {
          anyMoved = true;
        }
      }

      expect(anyMoved).toBe(true);
      expect(system.stats().pathRequests).toBeGreaterThan(0);
    });

    it('moves villagers to genuinely different places', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 10);
      const startPositions = system.all.map((v) => `${v.position.wx},${v.position.wy}`);

      for (let tick = 0; tick < 300; tick += 1) {
        system.update(TICK_SECONDS);
      }

      const endPositions = system.all.map((v) => `${v.position.wx},${v.position.wy}`);
      const moved = endPositions.filter((p, i) => p !== startPositions[i]).length;
      expect(moved).toBeGreaterThan(5);
    });

    it('budgets path requests so one tick cannot search for everyone', () => {
      const system = makeSystem(64);
      system.spawnNear({ gx: 32, gy: 32 }, 40);

      system.update(TICK_SECONDS);

      // The budget is 4 per tick; a failed target may retry within one call,
      // so assert it is far below the 40 villagers rather than exactly 4.
      expect(system.stats().pathRequests).toBeLessThanOrEqual(8);
    });

    it('keeps every villager on walkable ground', () => {
      const navigation = openGrid(32);
      const system = new VillagerSystem(navigation, new SeededRandom(9));
      system.spawnNear({ gx: 16, gy: 16 }, 10);

      for (let tick = 0; tick < 400; tick += 1) {
        system.update(TICK_SECONDS);
        for (const villager of system.all) {
          const cell = villager.cell;
          expect(navigation.isWalkable(cell.gx, cell.gy)).toBe(true);
        }
      }
    });
  });

  describe('selection', () => {
    it('finds the villager standing on a cell', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 1);
      const villager = system.all[0]!;

      expect(system.findNear(villager.cell)?.id).toBe(villager.id);
    });

    it('returns null when nobody is nearby', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 1);

      expect(system.findNear({ gx: 0, gy: 0 })).toBeNull();
    });

    it('looks up a villager by id', () => {
      const system = makeSystem();
      system.spawnNear({ gx: 16, gy: 16 }, 3);

      expect(system.findById(2)?.id).toBe(2);
      expect(system.findById(999)).toBeNull();
    });
  });
});

describe('Simulation with villagers', () => {
  const options = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

  it('starts with the founding population', () => {
    const simulation = new Simulation(options);
    expect(simulation.snapshot().villagerCount).toBe(10);
  });

  it('advances villagers on ticks', () => {
    const simulation = new Simulation(options);
    const before = simulation.villagers.all.map((v) => `${v.position.wx},${v.position.wy}`);

    for (let tick = 1; tick <= 300; tick += 1) {
      simulation.update(tick, TICK_SECONDS);
    }

    const after = simulation.villagers.all.map((v) => `${v.position.wx},${v.position.wy}`);
    expect(after).not.toEqual(before);
  });

  it('runs identically for the same seed', () => {
    const a = new Simulation(options);
    const b = new Simulation(options);

    for (let tick = 1; tick <= 200; tick += 1) {
      a.update(tick, TICK_SECONDS);
      b.update(tick, TICK_SECONDS);
    }

    expect(a.villagers.all.map((v) => `${v.id}:${v.position.wx},${v.position.wy}`)).toEqual(
      b.villagers.all.map((v) => `${v.id}:${v.position.wx},${v.position.wy}`),
    );
  });

  it('spawns villagers on walkable land in a generated world', () => {
    const simulation = new Simulation(options);

    for (const villager of simulation.villagers.all) {
      expect(simulation.world.isWalkable(villager.cell)).toBe(true);
    }
  });
});
