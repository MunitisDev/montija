/**
 * The sixteen shapes a road, a bridge or a ditch can take.
 *
 * A road used to be one flat tile whatever stood beside it, so a corner was two
 * overlapping lozenges and a crossroads was four — a scatter of patches rather
 * than a line the settlement had beaten. What replaces it is the oldest trick in
 * tile rendering: a centre, and an arm towards each neighbour carrying the same
 * thing.
 *
 * The drawing itself needs a canvas and is not tested here. What *is* tested is
 * the part that decides which of the sixteen a cell gets, because that is where
 * a wrong answer shows: a road drawn as a dead end where the track plainly
 * carries on.
 */

import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_DIRECTIONS,
  CONNECTOR_MASKS,
  connectorMask,
} from '@/renderer/phaser/terrain/connectors';
import { CONNECTOR_KINDS, TextureKeys } from '@/renderer/phaser/terrain/tileTextures';

describe('which shape a cell takes', () => {
  it('is a lone patch when nothing joins it', () => {
    expect(connectorMask(4, 4, () => false)).toBe(0);
  });

  it('is every arm at once when everything joins it', () => {
    expect(connectorMask(4, 4, () => true)).toBe(CONNECTOR_MASKS - 1);
  });

  it('reads the four neighbours, and only those four', () => {
    const asked: string[] = [];
    connectorMask(5, 7, (gx, gy) => {
      asked.push(`${gx},${gy}`);
      return false;
    });

    expect(asked.sort()).toEqual(['4,7', '5,6', '5,8', '6,7']);
  });

  it('ignores the diagonals', () => {
    // Two roads meeting at a corner are not joined: nothing runs between them,
    // and drawing an arm would claim otherwise.
    const mask = connectorMask(4, 4, (gx, gy) => gx === 5 && gy === 5);
    expect(mask).toBe(0);
  });

  it('gives a straight and a corner different shapes', () => {
    const eastWest = connectorMask(4, 4, (gx, gy) => gy === 4 && (gx === 3 || gx === 5));
    const corner = connectorMask(
      4,
      4,
      (gx, gy) => (gy === 4 && gx === 5) || (gx === 4 && gy === 5),
    );

    expect(eastWest).not.toBe(corner);
    expect(eastWest).toBeGreaterThan(0);
    expect(corner).toBeGreaterThan(0);
  });

  it('gives every combination its own number', () => {
    const seen = new Set<number>();
    for (const first of CONNECTOR_DIRECTIONS) {
      for (const second of CONNECTOR_DIRECTIONS) {
        seen.add(first.bit | second.bit);
      }
    }
    // Four singles and six pairs: ten distinct shapes out of two neighbours.
    expect(seen.size).toBe(10);
  });

  it('never runs off the end of the atlas', () => {
    // Frames are named by mask, so a mask outside 0..15 would ask for a frame
    // that does not exist and draw nothing at all.
    for (const direction of CONNECTOR_DIRECTIONS) {
      expect(direction.bit).toBeLessThan(CONNECTOR_MASKS);
    }
    expect(CONNECTOR_DIRECTIONS.reduce((all, one) => all | one.bit, 0)).toBe(CONNECTOR_MASKS - 1);
  });
});

describe('the atlas the shapes live in', () => {
  it('names a frame for every kind and every shape', () => {
    const names = new Set<string>();
    for (const kind of CONNECTOR_KINDS) {
      for (let mask = 0; mask < CONNECTOR_MASKS; mask += 1) {
        names.add(TextureKeys.connectorFrame(kind, mask));
      }
    }
    expect(names.size).toBe(CONNECTOR_KINDS.length * CONNECTOR_MASKS);
  });

  it('carries the three flat things and the four that stand up', () => {
    // The walls are the odd ones out and share the atlas anyway: the sixteen
    // shapes are the same sixteen, and only the drawing stands up.
    expect([...CONNECTOR_KINDS]).toEqual([
      'road',
      'bridge',
      'ditch',
      'fence',
      'stone-wall',
      'timber-gate',
      'stone-gate',
    ]);
  });
});
