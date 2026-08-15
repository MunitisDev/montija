import { describe, expect, it } from 'vitest';
import type { TerrainType } from '@/data/terrain';
import { findPath } from '@/simulation/pathfinding/AStar';
import { NavigationGrid } from '@/simulation/world/NavigationGrid';
import { TerrainGrid } from '@/simulation/world/TerrainGrid';

/**
 * Builds a navigation grid from an ASCII map.
 * `.` grass (open), `f` forest (slow), `#` stone (blocked), `~` water (blocked).
 */
function gridFrom(rows: readonly string[]): NavigationGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const terrain = new TerrainGrid(width, height);

  rows.forEach((row, gy) => {
    [...row].forEach((char, gx) => {
      const type: TerrainType =
        char === '#' ? 'stone' : char === '~' ? 'water' : char === 'f' ? 'forest' : 'grass';
      terrain.set(gx, gy, type);
    });
  });

  return new NavigationGrid(terrain);
}

describe('NavigationGrid', () => {
  it('marks impassable terrain as blocked', () => {
    const grid = gridFrom(['.#', '~.']);

    expect(grid.isWalkable(0, 0)).toBe(true);
    expect(grid.isWalkable(1, 0)).toBe(false);
    expect(grid.isWalkable(0, 1)).toBe(false);
  });

  it('treats everything outside the grid as blocked', () => {
    const grid = gridFrom(['..', '..']);

    expect(grid.isWalkable(-1, 0)).toBe(false);
    expect(grid.isWalkable(2, 0)).toBe(false);
    expect(grid.costAt(-1, 0)).toBe(0);
  });

  it('charges more for slow terrain', () => {
    const grid = gridFrom(['.f']);

    expect(grid.costAt(1, 0)).toBeGreaterThan(grid.costAt(0, 0));
  });

  it('can block a cell at runtime, for buildings', () => {
    const grid = gridFrom(['..', '..']);

    grid.block(1, 1);

    expect(grid.isWalkable(1, 1)).toBe(false);
  });

  describe('nearestWalkable', () => {
    it('returns the origin when it is already walkable', () => {
      const grid = gridFrom(['..', '..']);
      expect(grid.nearestWalkable({ gx: 1, gy: 1 })).toEqual({ gx: 1, gy: 1 });
    });

    it('searches outward when the origin is blocked', () => {
      const grid = gridFrom(['...', '.#.', '...']);
      const found = grid.nearestWalkable({ gx: 1, gy: 1 });

      expect(found).not.toBeNull();
      expect(grid.isWalkable(found!.gx, found!.gy)).toBe(true);
    });

    it('returns null when nothing walkable is in range', () => {
      const grid = gridFrom(['###', '###', '###']);
      expect(grid.nearestWalkable({ gx: 1, gy: 1 })).toBeNull();
    });
  });
});

describe('A* pathfinding', () => {
  it('finds a straight route across open ground', () => {
    const grid = gridFrom(['.....']);
    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 4, gy: 0 });

    expect(result.path).not.toBeNull();
    expect(result.path).toHaveLength(4);
    expect(result.path?.at(-1)).toEqual({ gx: 4, gy: 0 });
  });

  it('excludes the start and ends on the goal', () => {
    const grid = gridFrom(['...']);
    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 2, gy: 0 });

    expect(result.path?.[0]).toEqual({ gx: 1, gy: 0 });
    expect(result.path?.at(-1)).toEqual({ gx: 2, gy: 0 });
  });

  it('returns an empty path when already at the goal', () => {
    const grid = gridFrom(['...']);
    const result = findPath(grid, { gx: 1, gy: 0 }, { gx: 1, gy: 0 });

    expect(result.path).toEqual([]);
  });

  it('walks around a wall', () => {
    const grid = gridFrom(['.....', '.###.', '.....']);
    const result = findPath(grid, { gx: 2, gy: 0 }, { gx: 2, gy: 2 });

    expect(result.path).not.toBeNull();
    for (const step of result.path ?? []) {
      expect(grid.isWalkable(step.gx, step.gy)).toBe(true);
    }
  });

  it('never routes through blocked terrain', () => {
    const grid = gridFrom(['..~..', '..~..', '.....']);
    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 4, gy: 0 });

    expect(result.path).not.toBeNull();
    for (const step of result.path ?? []) {
      expect(grid.isWalkable(step.gx, step.gy)).toBe(true);
    }
  });

  it('reports no path when the goal is walled off', () => {
    const grid = gridFrom(['...#...', '...#...', '...#...']);
    const result = findPath(grid, { gx: 0, gy: 1 }, { gx: 6, gy: 1 });

    expect(result.path).toBeNull();
    expect(result.exhausted).toBe(false);
  });

  it('rejects an unwalkable start or goal outright', () => {
    const grid = gridFrom(['.#.']);

    expect(findPath(grid, { gx: 1, gy: 0 }, { gx: 2, gy: 0 }).path).toBeNull();
    expect(findPath(grid, { gx: 0, gy: 0 }, { gx: 1, gy: 0 }).path).toBeNull();
    // Rejected before any search runs at all.
    expect(findPath(grid, { gx: 0, gy: 0 }, { gx: 1, gy: 0 }).expandedNodes).toBe(0);
  });

  it('refuses a diagonal squeezed between two blocked cells', () => {
    // Moving diagonally from (0,0) to (1,1) would pass between the two rocks,
    // which looks like walking through a wall.
    const grid = gridFrom(['.#', '#.']);
    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 1, gy: 1 });

    expect(result.path).toBeNull();
  });

  it('refuses a diagonal that clips a single obstacle corner', () => {
    // Strict no-corner-cutting: both orthogonal neighbours must be clear, so
    // the route goes around rather than shaving the corner. A villager
    // clipping the corner of a house reads as walking through it.
    const grid = gridFrom(['.#', '..']);
    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 1, gy: 1 });

    expect(result.path).toEqual([
      { gx: 0, gy: 1 },
      { gx: 1, gy: 1 },
    ]);
  });

  it('takes a diagonal freely when both sides are clear', () => {
    const grid = gridFrom(['..', '..']);
    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 1, gy: 1 });

    expect(result.path).toEqual([{ gx: 1, gy: 1 }]);
  });

  it('uses diagonals rather than a staircase on open ground', () => {
    const grid = gridFrom(['....', '....', '....', '....']);
    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 3, gy: 3 });

    // Three diagonal steps, not six axis-aligned ones.
    expect(result.path).toHaveLength(3);
  });

  it('prefers open ground over slow forest when it is cheaper', () => {
    // A straight line through forest, versus a slightly longer clear detour.
    const grid = gridFrom(['..........', '.ffffffff.', '..........']);
    const result = findPath(grid, { gx: 0, gy: 1 }, { gx: 9, gy: 1 });

    const forestSteps = (result.path ?? []).filter(
      (step) => step.gy === 1 && step.gx > 0 && step.gx < 9,
    );
    expect(forestSteps.length).toBeLessThan(4);
  });

  it('is deterministic — the same request yields the identical path', () => {
    const rows = ['..........', '..##..##..', '..........', '..##..##..', '..........'];
    const grid = gridFrom(rows);

    const a = findPath(grid, { gx: 0, gy: 0 }, { gx: 9, gy: 4 });
    const b = findPath(grid, { gx: 0, gy: 0 }, { gx: 9, gy: 4 });

    expect(a.path).toEqual(b.path);
    expect(a.expandedNodes).toBe(b.expandedNodes);
  });

  it('produces a contiguous path with no teleporting', () => {
    const grid = gridFrom(['..........', '..##..##..', '..........', '..##..##..', '..........']);
    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 9, gy: 4 });

    const path = result.path ?? [];
    let previous = { gx: 0, gy: 0 };
    for (const step of path) {
      expect(Math.abs(step.gx - previous.gx)).toBeLessThanOrEqual(1);
      expect(Math.abs(step.gy - previous.gy)).toBeLessThanOrEqual(1);
      previous = step;
    }
  });

  it('gives up within its node budget instead of expanding the whole map', () => {
    const rows = Array.from({ length: 60 }, () => '.'.repeat(60));
    // Wall the goal off completely, so the search can never succeed.
    rows[30] = '#'.repeat(60);
    const grid = gridFrom(rows);

    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 59, gy: 59 }, { maxExpandedNodes: 200 });

    expect(result.path).toBeNull();
    expect(result.exhausted).toBe(true);
    expect(result.expandedNodes).toBeLessThanOrEqual(201);
  });

  it('finds long routes when the budget allows', () => {
    const rows = Array.from({ length: 40 }, () => '.'.repeat(40));
    const grid = gridFrom(rows);

    const result = findPath(grid, { gx: 0, gy: 0 }, { gx: 39, gy: 39 });

    expect(result.path).not.toBeNull();
    expect(result.exhausted).toBe(false);
  });
});
