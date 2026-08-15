/**
 * Translation table tests.
 *
 * The `Messages` type already makes a *missing* Spanish key a compile error, so
 * these tests deliberately do not re-check that. What the compiler cannot see
 * is the other half of the problem: several call sites build keys at runtime
 * (`building.${id}`, `hud.${resource}`, `season.${season}`) and cast the result
 * to `MessageKey`. A cast is a promise to the compiler, not a check — adding a
 * sixth building would silently produce a blank button.
 *
 * So these tests walk the real data tables and assert a string exists for every
 * id the game can actually produce.
 */

import { describe, expect, it } from 'vitest';

import { BUILDING_IDS } from '@/data/buildings';
import { RESOURCE_IDS } from '@/data/resources';
import { SEASONS } from '@/simulation/seasons/SeasonClock';
import { EN, ES, type MessageKey } from '@/ui/i18n/messages';

const CATALOGUES = { en: EN, es: ES } as const;
const LANGUAGES = ['en', 'es'] as const;

function lookup(language: (typeof LANGUAGES)[number], key: string): string | undefined {
  return (CATALOGUES[language] as Record<string, string | undefined>)[key];
}

describe('translation catalogues', () => {
  it.each(LANGUAGES)('%s has no blank strings', (language) => {
    for (const [key, value] of Object.entries(CATALOGUES[language])) {
      expect(value.trim(), `${language}:${key}`).not.toBe('');
    }
  });

  it('Spanish has no leftover English strings for translatable words', () => {
    // 'd' (day) and a handful of names are legitimately identical; anything
    // else being identical usually means a row was copied and not translated.
    const allowedIdentical = new Set<MessageKey>(['time.dayShort']);

    for (const key of Object.keys(EN) as MessageKey[]) {
      if (allowedIdentical.has(key)) {
        continue;
      }
      expect(ES[key], `${key} looks untranslated`).not.toBe(EN[key]);
    }
  });
});

describe('runtime-built keys', () => {
  it.each(LANGUAGES)('%s names every building and describes it', (language) => {
    for (const id of BUILDING_IDS) {
      expect(lookup(language, `building.${id}`), `building.${id}`).toBeTruthy();
      expect(lookup(language, `building.${id}.description`), `${id} description`).toBeTruthy();
    }
  });

  it.each(LANGUAGES)('%s names every resource shown in the HUD', (language) => {
    for (const id of RESOURCE_IDS) {
      expect(lookup(language, `hud.${id}`), `hud.${id}`).toBeTruthy();
    }
  });

  it.each(LANGUAGES)('%s names every season', (language) => {
    for (const season of SEASONS) {
      expect(lookup(language, `season.${season}`), `season.${season}`).toBeTruthy();
    }
  });

  it.each(LANGUAGES)('%s names every villager activity', (language) => {
    // Mirrors VillagerActivity. Listed literally rather than imported, because
    // the point is to notice when the union grows.
    for (const activity of ['idle', 'walking', 'working', 'hauling']) {
      expect(lookup(language, `villager.${activity}`), `villager.${activity}`).toBeTruthy();
    }
  });

  it.each(LANGUAGES)('%s has a warning for every piece of advice', (language) => {
    for (const advice of ['starving', 'foodLow', 'firewoodLow']) {
      expect(lookup(language, `warning.${advice}`), `warning.${advice}`).toBeTruthy();
    }
  });
});
