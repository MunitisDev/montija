import { describe, expect, it } from 'vitest';
import {
  TILE_HEIGHT,
  TILE_WIDTH,
  gridBoundsToScene,
  gridToScene,
  gridToWorld,
  isInsideGrid,
  sceneToGrid,
  sceneToWorld,
  worldToGrid,
  worldToScene,
} from '@/shared/math/isometric';

describe('isometric projection', () => {
  describe('grid <-> world', () => {
    it('places a cell centre at the middle of its cell', () => {
      expect(gridToWorld({ gx: 3, gy: 2 })).toEqual({ wx: 3.5, wy: 2.5 });
    });

    it('resolves a world position to its containing cell', () => {
      expect(worldToGrid({ wx: 3.5, wy: 2.5 })).toEqual({ gx: 3, gy: 2 });
      expect(worldToGrid({ wx: 3.0, wy: 2.0 })).toEqual({ gx: 3, gy: 2 });
      expect(worldToGrid({ wx: 3.99, wy: 2.99 })).toEqual({ gx: 3, gy: 2 });
    });

    it('floors towards negative infinity outside the map', () => {
      // -0.5 belongs to cell -1, not cell 0. Truncation would put it in 0 and
      // make off-map picks silently land on the first tile.
      expect(worldToGrid({ wx: -0.5, wy: -0.1 })).toEqual({ gx: -1, gy: -1 });
    });

    it('round-trips a cell through world space', () => {
      for (let gx = 0; gx < 8; gx += 1) {
        for (let gy = 0; gy < 8; gy += 1) {
          expect(worldToGrid(gridToWorld({ gx, gy }))).toEqual({ gx, gy });
        }
      }
    });
  });

  describe('world <-> scene', () => {
    it('puts the world origin at the scene origin', () => {
      expect(worldToScene({ wx: 0, wy: 0 })).toEqual({ px: 0, py: 0 });
    });

    it('sends +x right and down by half a tile', () => {
      expect(worldToScene({ wx: 1, wy: 0 })).toEqual({
        px: TILE_WIDTH / 2,
        py: TILE_HEIGHT / 2,
      });
    });

    it('sends +y left and down by half a tile', () => {
      expect(worldToScene({ wx: 0, wy: 1 })).toEqual({
        px: -TILE_WIDTH / 2,
        py: TILE_HEIGHT / 2,
      });
    });

    it('keeps the diagonal on the vertical axis', () => {
      // Equal x and y means straight down the screen: the defining property of
      // this projection.
      expect(worldToScene({ wx: 5, wy: 5 }).px).toBe(0);
    });

    it('is 2:1 — a tile is twice as wide as it is tall', () => {
      expect(TILE_WIDTH).toBe(TILE_HEIGHT * 2);
    });

    it('round-trips world -> scene -> world', () => {
      const samples = [
        { wx: 0, wy: 0 },
        { wx: 1.5, wy: 0.25 },
        { wx: 12.75, wy: 43.125 },
        { wx: -4.5, wy: 9.5 },
      ];

      for (const original of samples) {
        const back = sceneToWorld(worldToScene(original));
        expect(back.wx).toBeCloseTo(original.wx, 9);
        expect(back.wy).toBeCloseTo(original.wy, 9);
      }
    });

    it('round-trips scene -> world -> scene', () => {
      const original = { px: 137.5, py: 82.25 };
      const back = worldToScene(sceneToWorld(original));

      expect(back.px).toBeCloseTo(original.px, 9);
      expect(back.py).toBeCloseTo(original.py, 9);
    });
  });

  describe('grid <-> scene', () => {
    it('resolves a scene point back to the cell it came from', () => {
      // The critical property for tapping: every cell centre must pick itself.
      for (let gx = 0; gx < 24; gx += 1) {
        for (let gy = 0; gy < 24; gy += 1) {
          expect(sceneToGrid(gridToScene({ gx, gy }))).toEqual({ gx, gy });
        }
      }
    });

    it('picks the right cell from anywhere inside the diamond', () => {
      const cell = { gx: 6, gy: 4 };
      const centre = gridToScene(cell);
      // Points well inside the diamond, short of its corners.
      const offsets = [
        { px: 0, py: 0 },
        { px: 12, py: 0 },
        { px: -12, py: 0 },
        { px: 0, py: 6 },
        { px: 0, py: -6 },
      ];

      for (const offset of offsets) {
        expect(sceneToGrid({ px: centre.px + offset.px, py: centre.py + offset.py })).toEqual(cell);
      }
    });

    it('distinguishes neighbouring cells', () => {
      expect(gridToScene({ gx: 5, gy: 5 })).not.toEqual(gridToScene({ gx: 6, gy: 5 }));
      expect(gridToScene({ gx: 5, gy: 5 })).not.toEqual(gridToScene({ gx: 5, gy: 6 }));
    });
  });

  describe('gridBoundsToScene', () => {
    it('spans the full projected diamond, not just one edge', () => {
      const bounds = gridBoundsToScene(10, 10);

      // West corner is at -height half-widths; east corner at +width.
      expect(bounds.minX).toBe(-10 * (TILE_WIDTH / 2));
      expect(bounds.maxX).toBe(10 * (TILE_WIDTH / 2));
      expect(bounds.minY).toBe(0);
      expect(bounds.maxY).toBe(20 * (TILE_HEIGHT / 2));
    });

    it('contains every cell of the grid', () => {
      const width = 12;
      const height = 9;
      const bounds = gridBoundsToScene(width, height);

      for (let gx = 0; gx < width; gx += 1) {
        for (let gy = 0; gy < height; gy += 1) {
          const point = gridToScene({ gx, gy });
          expect(point.px).toBeGreaterThanOrEqual(bounds.minX);
          expect(point.px).toBeLessThanOrEqual(bounds.maxX);
          expect(point.py).toBeGreaterThanOrEqual(bounds.minY);
          expect(point.py).toBeLessThanOrEqual(bounds.maxY);
        }
      }
    });

    it('handles non-square maps', () => {
      const bounds = gridBoundsToScene(20, 5);
      expect(bounds.minX).toBe(-5 * (TILE_WIDTH / 2));
      expect(bounds.maxX).toBe(20 * (TILE_WIDTH / 2));
    });
  });

  describe('isInsideGrid', () => {
    it('accepts cells within the bounds', () => {
      expect(isInsideGrid({ gx: 0, gy: 0 }, 10, 10)).toBe(true);
      expect(isInsideGrid({ gx: 9, gy: 9 }, 10, 10)).toBe(true);
    });

    it('rejects cells outside the bounds', () => {
      expect(isInsideGrid({ gx: -1, gy: 0 }, 10, 10)).toBe(false);
      expect(isInsideGrid({ gx: 0, gy: -1 }, 10, 10)).toBe(false);
      expect(isInsideGrid({ gx: 10, gy: 0 }, 10, 10)).toBe(false);
      expect(isInsideGrid({ gx: 0, gy: 10 }, 10, 10)).toBe(false);
    });
  });
});
