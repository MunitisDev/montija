/**
 * Seasonal colour.
 *
 * The palette is data, and data that is wrong in one cell is invisible until a
 * player reaches that season — a winter with summer's grass would only be found
 * five minutes into a game. These check the properties that make the year read
 * correctly rather than any particular hex value, so retinting stays free.
 */

import { describe, expect, it } from 'vitest';

import { TERRAIN_TYPES } from '@/data/terrain';
import {
  CANOPY_VARIANTS,
  ambientLight,
  canopyColour,
  canopyFullness,
  hasSnow,
  structureTint,
  terrainPalette,
  trunkColour,
} from '@/renderer/phaser/terrain/seasonalPalette';
import { SEASONS } from '@/simulation/seasons/SeasonClock';

/** Perceived lightness, good enough to compare a winter field with a summer one. */
function luminance(colour: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How far a colour is from grey. Winter drains this; summer does not. */
function saturation(colour: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

describe('terrain colour', () => {
  it('covers every terrain type in every season', () => {
    for (const season of SEASONS) {
      for (const type of TERRAIN_TYPES) {
        const palette = terrainPalette(season, type);
        expect(palette, `${season}/${type}`).toBeDefined();
        expect(palette.fill).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every edge darker than its fill, so tiles stay legible', () => {
    for (const season of SEASONS) {
      for (const type of TERRAIN_TYPES) {
        const palette = terrainPalette(season, type);
        expect(luminance(palette.edge), `${season}/${type}`).toBeLessThan(luminance(palette.fill));
      }
    }
  });

  it('drains the colour out of the ground in winter', () => {
    // Cold reads as an absence of colour rather than as blue paint.
    const winter = saturation(terrainPalette('winter', 'grass').fill);
    const summer = saturation(terrainPalette('summer', 'grass').fill);
    expect(winter).toBeLessThan(summer);
  });

  it('makes winter ground paler than any other season', () => {
    const winter = luminance(terrainPalette('winter', 'grass').fill);
    for (const season of ['spring', 'summer', 'autumn'] as const) {
      expect(winter, season).toBeGreaterThan(luminance(terrainPalette(season, 'grass').fill));
    }
  });

  it('gives every season a distinct ground colour', () => {
    const fills = SEASONS.map((season) => terrainPalette(season, 'grass').fill);
    expect(new Set(fills).size).toBe(SEASONS.length);
  });
});

describe('vegetation', () => {
  it('offers a canopy colour for every variant and season', () => {
    for (const season of SEASONS) {
      for (let variant = 0; variant < 6; variant++) {
        expect(canopyColour(season, variant), `${season}/${variant}`).toBeGreaterThan(0);
      }
    }
  });

  it('wraps variants rather than running out of colours', () => {
    expect(canopyColour('summer', CANOPY_VARIANTS)).toBe(canopyColour('summer', 0));
    expect(canopyColour('summer', CANOPY_VARIANTS + 2)).toBe(canopyColour('summer', 2));
  });

  it('strips the canopy through autumn and winter', () => {
    expect(canopyFullness('summer')).toBe(1);
    expect(canopyFullness('autumn')).toBeLessThan(canopyFullness('spring'));
    expect(canopyFullness('winter')).toBeLessThan(canopyFullness('autumn'));
    expect(canopyFullness('winter')).toBeGreaterThan(0);
  });

  it('turns the leaves warm in autumn', () => {
    const autumn = canopyColour('autumn', 0);
    const summer = canopyColour('summer', 0);
    // Red rises above green: the whole point of the season.
    expect((autumn >> 16) & 0xff).toBeGreaterThan((summer >> 16) & 0xff);
  });

  it('has a trunk colour for every season', () => {
    for (const season of SEASONS) {
      expect(trunkColour(season), season).toBeGreaterThan(0);
    }
  });

  it('puts snow on the trees in winter only', () => {
    expect(hasSnow('winter')).toBe(true);
    for (const season of ['spring', 'summer', 'autumn'] as const) {
      expect(hasSnow(season), season).toBe(false);
    }
  });
});

describe('light', () => {
  it('gives every season an ambient wash it can actually see through', () => {
    for (const season of SEASONS) {
      const light = ambientLight(season);
      expect(light.alpha, season).toBeGreaterThan(0);
      // Light, not a colour filter: the art beneath has to stay readable.
      expect(light.alpha, season).toBeLessThan(0.25);
    }
  });

  it('lies heaviest in winter', () => {
    const winter = ambientLight('winter').alpha;
    for (const season of ['spring', 'summer', 'autumn'] as const) {
      expect(winter, season).toBeGreaterThan(ambientLight(season).alpha);
    }
  });

  it('leaves the growing seasons untinted', () => {
    // 0xffffff is Phaser's "no tint": buildings look like themselves in summer.
    expect(structureTint('spring')).toBe(0xffffff);
    expect(structureTint('summer')).toBe(0xffffff);
    expect(structureTint('winter')).not.toBe(0xffffff);
  });

  it('cools the settlement in winter and warms it in autumn', () => {
    const winter = structureTint('winter');
    const autumn = structureTint('autumn');
    // Winter leans blue, autumn leans red. Anything else and the mood inverts.
    expect(winter & 0xff).toBeGreaterThan((winter >> 16) & 0xff);
    expect((autumn >> 16) & 0xff).toBeGreaterThan(autumn & 0xff);
  });
});
