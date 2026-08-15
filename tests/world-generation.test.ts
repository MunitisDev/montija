import { describe, expect, it } from 'vitest';
import { TERRAIN_TYPES, terrainDefinition, type TerrainType } from '@/data/terrain';
import { TerrainGrid } from '@/simulation/world/TerrainGrid';
import { generateWorld, TREE_VARIANTS } from '@/simulation/world/WorldGenerator';
import { World } from '@/simulation/world/World';
import { ValueNoise2D } from '@/shared/math/noise';
import { SeededRandom } from '@/shared/math/random';

const SIZE = 48;

describe('TerrainGrid', () => {
  it('starts filled with the requested terrain', () => {
    const grid = new TerrainGrid(4, 4, 'water');
    expect(grid.get(0, 0)).toBe('water');
    expect(grid.count('water')).toBe(16);
  });

  it('stores and reads back a cell', () => {
    const grid = new TerrainGrid(4, 4);
    grid.set(2, 3, 'stone');
    expect(grid.get(2, 3)).toBe('stone');
    expect(grid.get(3, 2)).toBe('grass');
  });

  it('does not confuse x and y', () => {
    // A transposed index bug passes most tests on a square grid, so use a
    // rectangular one and a cell that only exists in one orientation.
    const grid = new TerrainGrid(8, 3);
    grid.set(7, 2, 'stone');
    expect(grid.get(7, 2)).toBe('stone');
    expect(grid.count('stone')).toBe(1);
  });

  it('reports out-of-bounds cells as impassable water', () => {
    const grid = new TerrainGrid(4, 4);
    expect(grid.contains(-1, 0)).toBe(false);
    expect(grid.get(-1, 0)).toBe('water');
    expect(grid.get(4, 0)).toBe('water');
  });

  it('ignores writes outside the grid', () => {
    const grid = new TerrainGrid(4, 4);
    grid.set(99, 99, 'stone');
    expect(grid.count('stone')).toBe(0);
  });

  it('visits every cell exactly once', () => {
    const grid = new TerrainGrid(5, 3);
    const seen: string[] = [];
    grid.forEach((gx, gy) => seen.push(`${gx},${gy}`));

    expect(seen).toHaveLength(15);
    expect(new Set(seen).size).toBe(15);
  });

  it('round-trips through a save buffer', () => {
    const grid = new TerrainGrid(6, 6);
    grid.set(1, 1, 'stone');
    grid.set(4, 2, 'water');

    const restored = new TerrainGrid(6, 6);
    restored.loadBuffer(grid.toBuffer());

    expect(restored.get(1, 1)).toBe('stone');
    expect(restored.get(4, 2)).toBe('water');
  });

  it('rejects a buffer of the wrong size', () => {
    const grid = new TerrainGrid(6, 6);
    expect(() => grid.loadBuffer(new Uint8Array(4))).toThrow(/expected 36/);
  });

  it('hands out a copy of its buffer, not its own storage', () => {
    const grid = new TerrainGrid(4, 4);
    const buffer = grid.toBuffer();
    buffer[0] = 4;
    expect(grid.get(0, 0)).toBe('grass');
  });
});

describe('ValueNoise2D', () => {
  it('is deterministic for a given seed', () => {
    const a = new ValueNoise2D(new SeededRandom(7), 8);
    const b = new ValueNoise2D(new SeededRandom(7), 8);
    expect(a.sample(1.3, 2.7)).toBe(b.sample(1.3, 2.7));
    expect(a.fractal(1.3, 2.7)).toBe(b.fractal(1.3, 2.7));
  });

  it('stays within [0, 1]', () => {
    const noise = new ValueNoise2D(new SeededRandom(3), 8);
    for (let i = 0; i < 400; i += 1) {
      const value = noise.fractal(i * 0.13, i * 0.29);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous — nearby samples do not jump', () => {
    const noise = new ValueNoise2D(new SeededRandom(11), 8);
    for (let i = 0; i < 100; i += 1) {
      const x = i * 0.07;
      expect(Math.abs(noise.sample(x, 1) - noise.sample(x + 0.001, 1))).toBeLessThan(0.02);
    }
  });

  it('actually varies across the field', () => {
    const noise = new ValueNoise2D(new SeededRandom(5), 8);
    const values = new Set<number>();
    for (let i = 0; i < 50; i += 1) {
      values.add(Math.round(noise.fractal(i * 0.4, i * 0.7) * 100));
    }
    expect(values.size).toBeGreaterThan(5);
  });
});

describe('world generation', () => {
  it('produces an identical map for the same seed', () => {
    const a = generateWorld({ width: SIZE, height: SIZE, seed: 1234 });
    const b = generateWorld({ width: SIZE, height: SIZE, seed: 1234 });

    expect(Array.from(a.terrain.toBuffer())).toEqual(Array.from(b.terrain.toBuffer()));
    expect(a.trees).toEqual(b.trees);
  });

  it('produces a different map for a different seed', () => {
    const a = generateWorld({ width: SIZE, height: SIZE, seed: 1 });
    const b = generateWorld({ width: SIZE, height: SIZE, seed: 2 });

    expect(Array.from(a.terrain.toBuffer())).not.toEqual(Array.from(b.terrain.toBuffer()));
  });

  it('fills the whole grid with valid terrain', () => {
    const { terrain } = generateWorld({ width: SIZE, height: SIZE, seed: 99 });

    terrain.forEach((_gx, _gy, type) => {
      expect(TERRAIN_TYPES).toContain(type);
    });
  });

  it('generates every terrain kind the brief calls for', () => {
    // Grass, forest, water and stone must all appear, or the map is not a
    // wilderness worth settling.
    const { terrain } = generateWorld({ width: 128, height: 128, seed: 20260815 });

    for (const type of ['grass', 'forest', 'water', 'stone'] as TerrainType[]) {
      expect(terrain.count(type), `expected some ${type}`).toBeGreaterThan(0);
    }
  });

  it('leaves every seed playable, not just the default one', () => {
    // Terrain mix varies a lot between seeds — measured water ranges from 2%
    // to 35%. A map that is mostly water or rock is technically deterministic
    // and completely unplayable, so the invariant is checked across seeds
    // rather than on the one that happened to look good.
    const seeds = [20260815, 1, 2, 777, 31337, 99999];
    const total = 96 * 96;

    for (const seed of seeds) {
      const { terrain, trees } = generateWorld({ width: 96, height: 96, seed });
      const walkable = terrain.count('grass') + terrain.count('meadow') + terrain.count('forest');

      expect(walkable / total, `seed ${seed} is not habitable enough`).toBeGreaterThan(0.5);
      // The MVP needs wood and stone to exist at all, on every map.
      expect(terrain.count('forest'), `seed ${seed} has no forest`).toBeGreaterThan(0);
      expect(terrain.count('stone'), `seed ${seed} has no stone`).toBeGreaterThan(0);
      expect(trees.length, `seed ${seed} has no trees`).toBeGreaterThan(0);
    }
  });

  it('only places trees on forest tiles', () => {
    const { terrain, trees } = generateWorld({ width: SIZE, height: SIZE, seed: 42 });

    expect(trees.length).toBeGreaterThan(0);
    for (const tree of trees) {
      expect(terrain.get(tree.gx, tree.gy)).toBe('forest');
    }
  });

  it('gives every tree a unique id', () => {
    const { trees } = generateWorld({ width: SIZE, height: SIZE, seed: 8 });
    expect(new Set(trees.map((tree) => tree.id)).size).toBe(trees.length);
  });

  it('keeps tree variants and scales in range', () => {
    const { trees } = generateWorld({ width: SIZE, height: SIZE, seed: 8 });

    for (const tree of trees) {
      expect(tree.variant).toBeGreaterThanOrEqual(0);
      expect(tree.variant).toBeLessThan(TREE_VARIANTS);
      expect(tree.scale).toBeGreaterThanOrEqual(0.85);
      expect(tree.scale).toBeLessThan(1.15);
    }
  });

  it('handles a non-square map without transposing it', () => {
    const { terrain } = generateWorld({ width: 40, height: 20, seed: 3 });
    expect(terrain.width).toBe(40);
    expect(terrain.height).toBe(20);
    expect(terrain.contains(39, 19)).toBe(true);
    expect(terrain.contains(20, 39)).toBe(false);
  });
});

describe('World', () => {
  it('exposes scene bounds covering the projected map', () => {
    const world = new World({ width: 32, height: 32, seed: 5 });
    const bounds = world.sceneBounds;

    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    expect(bounds.maxY).toBeGreaterThan(bounds.minY);
  });

  it('agrees with the terrain definitions on walkability', () => {
    const world = new World({ width: SIZE, height: SIZE, seed: 77 });

    world.terrain.forEach((gx, gy, type) => {
      expect(world.isWalkable({ gx, gy })).toBe(terrainDefinition(type).walkable);
      expect(world.isBuildable({ gx, gy })).toBe(terrainDefinition(type).buildable);
    });
  });

  it('treats everything outside the map as unusable', () => {
    const world = new World({ width: 16, height: 16, seed: 1 });

    expect(world.isWalkable({ gx: -1, gy: 0 })).toBe(false);
    expect(world.isBuildable({ gx: 16, gy: 0 })).toBe(false);
  });

  it('never lets a building sit on water or rock', () => {
    const world = new World({ width: SIZE, height: SIZE, seed: 21 });

    world.terrain.forEach((gx, gy, type) => {
      if (type === 'water' || type === 'stone') {
        expect(world.isBuildable({ gx, gy })).toBe(false);
      }
    });
  });
});
