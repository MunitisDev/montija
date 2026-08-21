/**
 * The version on the start screen is the version in the manifest.
 *
 * **Two places holding the same string is one place holding a lie**, eventually.
 * `package.json` said `0.1.0` through sixty-five phases of work — true on the
 * first afternoon and wrong ever after — because nothing ever read it and nothing
 * ever checked it.
 *
 * The alternative to this test is plumbing the manifest's version through both
 * Vite configs as a build-time define, or bundling `package.json` into the game
 * to read one field off it. A test that fails the moment the two disagree is
 * cheaper than either and catches the same mistake.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { GAME_VERSION } from '@/app/config';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version?: unknown;
};

describe('the version the player is shown', () => {
  it('is the version in package.json', () => {
    expect(manifest.version).toBe(GAME_VERSION);
  });

  it('reads as major.minor.patch, so each number can mean something', () => {
    // See `app/config.ts`: a major is a different game, a minor is a feature, a
    // patch is a fix. A version that did not parse would make all three mean
    // nothing.
    expect(GAME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is not the placeholder any more', () => {
    expect(GAME_VERSION).not.toBe('0.0.0');
    expect(GAME_VERSION).not.toBe('0.1.0');
  });
});
