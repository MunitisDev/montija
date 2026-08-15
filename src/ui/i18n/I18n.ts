/**
 * Language selection and lookup.
 *
 * The language is chosen from the browser, overridable by the player and
 * remembered in localStorage. Changing it re-renders the HUD rather than
 * reloading, because a settlement in progress must not be disturbed by a
 * cosmetic choice.
 *
 * Deliberately not part of the simulation. Text is presentation: the simulation
 * deals in ids like `gatherer-hut`, and only the UI ever turns those into
 * words.
 */

import { EN, ES, type MessageKey, type Messages } from './messages';

export type Language = 'en' | 'es';

export const LANGUAGES: readonly Language[] = ['en', 'es'];

const CATALOGUES: Readonly<Record<Language, Messages>> = { en: EN, es: ES };

const STORAGE_KEY = 'montija.language';

export class I18n {
  private current: Language;
  private version = 0;

  constructor(initial?: Language) {
    this.current = initial ?? detectLanguage();
  }

  public get language(): Language {
    return this.current;
  }

  /** Increments on every change, so the HUD knows to re-render everything. */
  public get changeVersion(): number {
    return this.version;
  }

  public setLanguage(language: Language): void {
    if (language === this.current) {
      return;
    }
    this.current = language;
    this.version += 1;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // A browser refusing storage is not a reason to refuse the language.
    }
    document.documentElement.lang = language;
  }

  /** Looks up a string. Falls back to English rather than showing a raw key. */
  public t(key: MessageKey): string {
    return CATALOGUES[this.current][key] ?? EN[key];
  }
}

function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'es') {
      return stored;
    }
  } catch {
    // Ignore and fall through to browser detection.
  }

  const preferred = typeof navigator === 'undefined' ? '' : navigator.language;
  return preferred.toLowerCase().startsWith('es') ? 'es' : 'en';
}
