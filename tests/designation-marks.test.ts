/**
 * Where the mark on an ordered job sits.
 *
 * **A player reported the cross on a stone deposit floating too high, "as if it
 * were a tree", and it was literally that**: the mark table gave `gather-stone`
 * the same 34-pixel lift as `chop-tree`. A tree is a 96-pixel sprite standing on
 * its cell and its mark has to be up in the canopy to read as being on it. A
 * deposit is not a sprite at all — it is a few low boulders drawn into the ground
 * tile — so the cross hung in empty air above the rock, over whatever stood
 * behind it.
 *
 * The lift is now derived from the boulder art itself, which is the part worth a
 * test: retuning the rocks has to move the mark with them rather than silently
 * leaving it wrong again.
 */

import { describe, expect, it } from 'vitest';

import { MARK_LIFT } from '@/renderer/phaser/entities/DesignationRenderer';
import { ROCK_PEAK_LIFT } from '@/renderer/phaser/terrain/groundArt';
import { TILE_HEIGHT } from '@/shared/math/isometric';

describe('how high a boulder stands', () => {
  it('is a real height, and a low one', () => {
    // Within half a tile: the blocks are drawn inside the diamond, so anything
    // taller than this would mean the art had grown out of its own tile.
    expect(ROCK_PEAK_LIFT).toBeGreaterThan(0);
    expect(ROCK_PEAK_LIFT).toBeLessThanOrEqual(TILE_HEIGHT / 2);
  });

  it('is a whole number of pixels', () => {
    // Half-pixel offsets on a mark that never moves are just a blurred cross.
    expect(Number.isInteger(ROCK_PEAK_LIFT)).toBe(true);
  });
});

describe('the marks the player put there', () => {
  it('lifts a mining mark to the top of the rock and no further', () => {
    expect(MARK_LIFT['gather-stone']).toBe(ROCK_PEAK_LIFT);
  });

  it('keeps a felling mark far higher, up in the canopy', () => {
    // The regression in one line: these two were the same number, and a rock is
    // nothing like a tree.
    const tree = MARK_LIFT['chop-tree'] ?? 0;
    expect(tree).toBeGreaterThan(2 * ROCK_PEAK_LIFT);
  });

  it('leaves a road order flat on the ground it refers to', () => {
    // Lifting this one would leave it hovering over the cell in front.
    expect(MARK_LIFT['pave-road']).toBe(0);
  });
});
