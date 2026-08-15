/**
 * Grid A* pathfinding.
 *
 * Deliberately plain: a binary heap, an octile heuristic, eight-way movement.
 * The brief warns against premature navigation complexity, and A* on a grid is
 * ample for a settlement of a few hundred villagers. Flow fields or hierarchical
 * navigation would be a Phase 11 decision, made against benchmarks.
 *
 * Two properties the rest of the game depends on:
 *
 * - **Deterministic.** Ties in the open set break on insertion order, and
 *   neighbours are always visited in the same fixed order, so the same request
 *   always yields the identical path. A set or map keyed on object identity
 *   here would quietly break save/replay reproducibility.
 * - **Bounded.** Every search has a node budget. An unreachable target across a
 *   large map would otherwise expand the whole grid, and with many villagers
 *   that is a frame-time cliff rather than a slow path.
 */

import type { GridPoint } from '@/shared/types/geometry';
import { COST_SCALE, type NavigationGrid } from '@/simulation/world/NavigationGrid';

/** Diagonal step cost, scaled: sqrt(2) rounded to keep integer arithmetic. */
const DIAGONAL_COST = Math.round(Math.SQRT2 * COST_SCALE);
const STRAIGHT_COST = COST_SCALE;

/**
 * Neighbour offsets, in a fixed order.
 *
 * Straights first, then diagonals — with equal-cost ties broken by insertion
 * order, this biases paths towards axis-aligned movement, which reads more
 * naturally than a staircase.
 */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

export interface PathfindingOptions {
  /** Maximum nodes expanded before giving up. Guards against frame spikes. */
  readonly maxExpandedNodes?: number;
}

const DEFAULT_MAX_NODES = 4000;

/** The result of a search. `null` path means no route was found. */
export interface PathResult {
  readonly path: GridPoint[] | null;
  /** Nodes expanded; surfaced in the debug overlay to spot pathological cases. */
  readonly expandedNodes: number;
  /** `true` when the search hit its node budget rather than finishing. */
  readonly exhausted: boolean;
}

/**
 * Finds a walkable route from `start` to `goal`.
 *
 * The returned path excludes `start` and ends with `goal`, so a villager can
 * simply walk to each entry in turn.
 */
export function findPath(
  grid: NavigationGrid,
  start: GridPoint,
  goal: GridPoint,
  options: PathfindingOptions = {},
): PathResult {
  const maxNodes = options.maxExpandedNodes ?? DEFAULT_MAX_NODES;

  if (!grid.isWalkable(start.gx, start.gy) || !grid.isWalkable(goal.gx, goal.gy)) {
    return { path: null, expandedNodes: 0, exhausted: false };
  }

  const width = grid.width;
  const startIndex = start.gy * width + start.gx;
  const goalIndex = goal.gy * width + goal.gx;

  if (startIndex === goalIndex) {
    return { path: [], expandedNodes: 0, exhausted: false };
  }

  const cellCount = width * grid.height;
  // Typed arrays rather than maps: no allocation per node, no hashing, and the
  // whole search stays in a handful of contiguous buffers.
  const gScore = new Float64Array(cellCount).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(cellCount).fill(-1);
  const closed = new Uint8Array(cellCount);

  const open = new BinaryHeap();
  gScore[startIndex] = 0;
  open.push(startIndex, heuristic(start.gx, start.gy, goal.gx, goal.gy));

  let expandedNodes = 0;

  while (open.size > 0) {
    const current = open.pop();
    if (current === goalIndex) {
      return {
        path: reconstruct(cameFrom, current, width),
        expandedNodes,
        exhausted: false,
      };
    }

    if (closed[current] === 1) {
      continue;
    }
    closed[current] = 1;
    expandedNodes += 1;

    if (expandedNodes >= maxNodes) {
      return { path: null, expandedNodes, exhausted: true };
    }

    const cx = current % width;
    const cy = (current - cx) / width;
    const currentScore = gScore[current] ?? Number.POSITIVE_INFINITY;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;

      const enterCost = grid.costAt(nx, ny);
      if (enterCost === 0) {
        continue;
      }

      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal) {
        // Strict no-corner-cutting: a diagonal step is only legal when *both*
        // orthogonal neighbours it passes between are clear. The looser rule
        // (block only when both are obstructed) lets a villager clip the corner
        // of a building, which reads as walking through the wall. The cost is
        // that a purely diagonal gap is impassable — correct for a settlement
        // where buildings occupy whole cells.
        if (!grid.isWalkable(cx + dx, cy) || !grid.isWalkable(cx, cy + dy)) {
          continue;
        }
      }

      const neighbourIndex = ny * width + nx;
      if (closed[neighbourIndex] === 1) {
        continue;
      }

      // Terrain cost scales the step, so forest is genuinely slower to cross.
      const stepCost = ((diagonal ? DIAGONAL_COST : STRAIGHT_COST) * enterCost) / COST_SCALE;
      const tentative = currentScore + stepCost;

      if (tentative < (gScore[neighbourIndex] ?? Number.POSITIVE_INFINITY)) {
        gScore[neighbourIndex] = tentative;
        cameFrom[neighbourIndex] = current;
        open.push(neighbourIndex, tentative + heuristic(nx, ny, goal.gx, goal.gy));
      }
    }
  }

  return { path: null, expandedNodes, exhausted: false };
}

/**
 * Octile distance: the exact cost of an unobstructed eight-way walk.
 *
 * Admissible (never overestimates), so A* still returns optimal paths, but far
 * better informed than Manhattan on a grid that allows diagonals.
 */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return STRAIGHT_COST * (dx + dy) + (DIAGONAL_COST - 2 * STRAIGHT_COST) * Math.min(dx, dy);
}

function reconstruct(cameFrom: Int32Array, goalIndex: number, width: number): GridPoint[] {
  const path: GridPoint[] = [];
  let current = goalIndex;

  while (current !== -1) {
    const gx = current % width;
    path.push({ gx, gy: (current - gx) / width });
    current = cameFrom[current] ?? -1;
  }

  path.pop(); // Drop the start; the villager is already standing there.
  path.reverse();
  return path;
}

/**
 * Minimal binary min-heap over cell indices.
 *
 * Written here rather than pulled in as a dependency: it is thirty lines, it
 * avoids a package in the hot loop, and it lets ties break on insertion order,
 * which is what keeps pathfinding deterministic.
 */
class BinaryHeap {
  private readonly indices: number[] = [];
  private readonly scores: number[] = [];
  /** Monotonic counter used purely to break score ties reproducibly. */
  private readonly order: number[] = [];
  private counter = 0;

  public get size(): number {
    return this.indices.length;
  }

  public push(index: number, score: number): void {
    this.indices.push(index);
    this.scores.push(score);
    this.order.push(this.counter);
    this.counter += 1;
    this.bubbleUp(this.indices.length - 1);
  }

  public pop(): number {
    const top = this.indices[0] ?? -1;
    const lastIndex = this.indices.pop();
    const lastScore = this.scores.pop();
    const lastOrder = this.order.pop();

    if (this.indices.length > 0 && lastIndex !== undefined && lastScore !== undefined) {
      this.indices[0] = lastIndex;
      this.scores[0] = lastScore;
      this.order[0] = lastOrder ?? 0;
      this.sinkDown(0);
    }

    return top;
  }

  /** `true` when `a` should sit above `b`. */
  private isHigher(a: number, b: number): boolean {
    const scoreA = this.scores[a] ?? Number.POSITIVE_INFINITY;
    const scoreB = this.scores[b] ?? Number.POSITIVE_INFINITY;
    if (scoreA !== scoreB) {
      return scoreA < scoreB;
    }
    return (this.order[a] ?? 0) < (this.order[b] ?? 0);
  }

  private swap(a: number, b: number): void {
    [this.indices[a], this.indices[b]] = [this.indices[b] as number, this.indices[a] as number];
    [this.scores[a], this.scores[b]] = [this.scores[b] as number, this.scores[a] as number];
    [this.order[a], this.order[b]] = [this.order[b] as number, this.order[a] as number];
  }

  private bubbleUp(start: number): void {
    let node = start;
    while (node > 0) {
      const parent = (node - 1) >> 1;
      if (!this.isHigher(node, parent)) {
        break;
      }
      this.swap(node, parent);
      node = parent;
    }
  }

  private sinkDown(start: number): void {
    let node = start;
    const length = this.indices.length;

    for (;;) {
      const left = node * 2 + 1;
      const right = left + 1;
      let best = node;

      if (left < length && this.isHigher(left, best)) {
        best = left;
      }
      if (right < length && this.isHigher(right, best)) {
        best = right;
      }
      if (best === node) {
        break;
      }

      this.swap(node, best);
      node = best;
    }
  }
}
