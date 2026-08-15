/**
 * Ground and tree artwork.
 *
 * Only the pure parts are testable without a GPU — which is exactly the parts
 * worth testing. The drawing itself is reviewed by looking at it; what a test
 * can protect is the contract the drawing depends on: that a cell always picks
 * the same variant, that the variant is always in range, and that the pattern
 * of variants does not line up into the grid the brief asks the terrain to
 * hide.
 */

import { describe, expect, it } from 'vitest';
import { TERRAIN_VARIANTS, tileVariant } from '@/renderer/phaser/terrain/groundArt';
import { TREE_SHAPES } from '@/renderer/phaser/terrain/treeArt';
import { CANOPY_VARIANTS, groundDetail } from '@/renderer/phaser/terrain/seasonalPalette';
import { SEASONS } from '@/simulation/seasons/SeasonClock';
import { TERRAIN_TYPES } from '@/data/terrain';

describe('tile variants', () => {
  it('always picks a variant that exists', () => {
    for (let gy = 0; gy < 40; gy += 1) {
      for (let gx = 0; gx < 40; gx += 1) {
        const variant = tileVariant(gx, gy);
        expect(variant, `${gx},${gy}`).toBeGreaterThanOrEqual(0);
        expect(variant, `${gx},${gy}`).toBeLessThan(TERRAIN_VARIANTS);
        expect(Number.isInteger(variant)).toBe(true);
      }
    }
  });

  it('gives a cell the same variant every time it is asked', () => {
    // The whole point of hashing the coordinates rather than storing a field:
    // a season change, a repaint after felling, and a reload must all agree, or
    // tiles visibly change texture when something unrelated happens.
    for (const [gx, gy] of [
      [0, 0],
      [7, 13],
      [95, 95],
    ] as const) {
      expect(tileVariant(gx, gy)).toBe(tileVariant(gx, gy));
    }
  });

  it('handles the far corner of a large map', () => {
    expect(tileVariant(255, 255)).toBeLessThan(TERRAIN_VARIANTS);
    expect(tileVariant(1023, 4)).toBeLessThan(TERRAIN_VARIANTS);
  });

  it('uses every variant, roughly evenly', () => {
    const counts = new Array<number>(TERRAIN_VARIANTS).fill(0);
    for (let gy = 0; gy < 96; gy += 1) {
      for (let gx = 0; gx < 96; gx += 1) {
        counts[tileVariant(gx, gy)] = (counts[tileVariant(gx, gy)] ?? 0) + 1;
      }
    }

    const total = 96 * 96;
    for (const count of counts) {
      expect(count).toBeGreaterThan(0);
      // Nowhere near uniform is fine; one variant taking most of the map is not.
      expect(count).toBeLessThan(total * 0.6);
    }
  });

  it('does not lay the variants out in diagonal stripes', () => {
    // `(gx + gy) % n` is the obvious hash and produces stripes running along the
    // isometric axis — the single most visible way to turn ground detail into a
    // rendering of the grid. Cells on one such diagonal must not all match.
    const diagonal = new Set<number>();
    for (let step = 0; step < 24; step += 1) {
      diagonal.add(tileVariant(step, 24 - step));
    }
    expect(diagonal.size).toBeGreaterThan(1);

    // Same again along a row and a column.
    const row = new Set<number>();
    const column = new Set<number>();
    for (let step = 0; step < 24; step += 1) {
      row.add(tileVariant(step, 5));
      column.add(tileVariant(5, step));
    }
    expect(row.size).toBeGreaterThan(1);
    expect(column.size).toBeGreaterThan(1);
  });
});

describe('ground detail colours', () => {
  it('offers detail for every terrain type in every season', () => {
    for (const season of SEASONS) {
      for (const type of TERRAIN_TYPES) {
        const detail = groundDetail(season, type);
        for (const value of [detail.tuft, detail.soil, detail.highlight]) {
          expect(value, `${season}/${type}`).toBeGreaterThan(0);
          expect(value, `${season}/${type}`).toBeLessThanOrEqual(0xffffff);
        }
      }
    }
  });

  it('gives water its own highlight, so ripples are not grass-coloured', () => {
    for (const season of SEASONS) {
      expect(groundDetail(season, 'water').highlight, season).not.toBe(
        groundDetail(season, 'grass').highlight,
      );
    }
  });
});

describe('tree shapes', () => {
  it('has a canopy colour for every shape it can draw', () => {
    // The renderer takes every variant modulo this, so a mismatch would silently
    // draw two different shapes in the same colour rather than crash.
    expect(TREE_SHAPES).toBe(CANOPY_VARIANTS);
  });

  it('draws both conifers and broadleaves', () => {
    // The split is at three; anything less than six shapes would quietly mean a
    // wood of one kind of tree again.
    expect(TREE_SHAPES).toBeGreaterThanOrEqual(6);
  });
});
