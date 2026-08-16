/**
 * The screen the game opens on.
 *
 * Before this, the game began mid-simulation with no title, no explanation and
 * no way back to a saved settlement other than a button in the corner of a HUD
 * the player had not yet learned to read. A player who did not already know
 * what Montija was had nowhere to find out.
 *
 * Three deliberate choices:
 *
 * - **The world is already there behind it.** The menu is an overlay over a
 *   founded settlement rather than a separate screen, so choosing to play costs
 *   no load and the first thing anyone sees is the game rather than a colour.
 * - **The clock is paused while it is open.** A settlement quietly starving
 *   behind a title card would be a cruel way to start.
 * - **"New settlement" does not found a new one.** The world behind the menu is
 *   already new, and re-founding would throw it away to generate an identical
 *   replacement. Beginning again after a settlement dies is the failure
 *   overlay's job, and it already does it.
 */

import type { GameContext } from '@/game/Game';
import type { Guide } from '@/ui/guide/Guide';
import { LANGUAGES, type I18n } from '@/ui/i18n/I18n';

export class MainMenu {
  private readonly context: GameContext;
  private readonly i18n: I18n;
  private readonly guide: Guide;

  private readonly root: HTMLElement;
  private readonly tagline: HTMLElement;
  private readonly note: HTMLElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly newButton: HTMLButtonElement;
  private readonly guideButton: HTMLButtonElement;
  private readonly languageButton: HTMLButtonElement;

  private renderedLanguageVersion = -1;

  constructor(root: HTMLElement, context: GameContext, i18n: I18n, guide: Guide) {
    this.context = context;
    this.i18n = i18n;
    this.guide = guide;

    this.root = requireElement(root, '[data-ui="menu"]');
    this.tagline = requireElement(root, '[data-ui="menu-tagline"]');
    this.note = requireElement(root, '[data-ui="menu-note"]');
    this.continueButton = requireElement(root, '[data-ui="menu-continue"]') as HTMLButtonElement;
    this.newButton = requireElement(root, '[data-ui="menu-new"]') as HTMLButtonElement;
    this.guideButton = requireElement(root, '[data-ui="menu-guide"]') as HTMLButtonElement;
    this.languageButton = requireElement(root, '[data-ui="menu-language"]') as HTMLButtonElement;

    this.newButton.addEventListener('click', () => this.startPlaying());

    this.continueButton.addEventListener('click', () => {
      // Play first and load second: a failed load leaves the player in the new
      // settlement with the HUD's own status line explaining why, which beats
      // being stranded on a menu whose button appears to do nothing.
      this.startPlaying();
      void this.context.load();
    });

    this.guideButton.addEventListener('click', () => {
      this.root.hidden = true;
      this.guide.open({
        closeLabel: this.i18n.t('menu.back'),
        onClose: () => {
          this.root.hidden = false;
        },
      });
    });

    this.languageButton.addEventListener('click', () => {
      const next = LANGUAGES[(LANGUAGES.indexOf(this.i18n.language) + 1) % LANGUAGES.length];
      if (next) {
        this.i18n.setLanguage(next);
      }
      this.render();
    });
  }

  public get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Shows the menu and stops the clock until the player chooses. */
  public open(): void {
    this.context.clock.pause();
    this.render();
    this.root.hidden = false;
    document.body.classList.add('is-menu-open');

    // Offered only when there is genuinely something to continue. Asking the
    // store is asynchronous, so the button starts disabled and enables itself
    // rather than promising something that may not be there.
    this.continueButton.disabled = true;
    void this.context
      .hasSave()
      .then((exists) => {
        this.continueButton.disabled = !exists;
        this.note.textContent = exists ? '' : this.i18n.t('menu.noSave');
      })
      .catch(() => {
        // A browser refusing IndexedDB is not a reason to refuse the game.
        this.continueButton.disabled = true;
      });
  }

  private startPlaying(): void {
    this.root.hidden = true;
    document.body.classList.remove('is-menu-open');
    this.context.clock.resume();
  }

  private render(): void {
    if (this.renderedLanguageVersion === this.i18n.changeVersion) {
      return;
    }
    this.renderedLanguageVersion = this.i18n.changeVersion;

    this.tagline.textContent = this.i18n.t('menu.tagline');
    this.continueButton.textContent = this.i18n.t('menu.continue');
    this.newButton.textContent = this.i18n.t('menu.newSettlement');
    this.guideButton.textContent = this.i18n.t('menu.howToPlay');
    this.languageButton.textContent = this.i18n.language.toUpperCase();
    if (this.note.textContent !== '') {
      this.note.textContent = this.i18n.t('menu.noSave');
    }
  }
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Main menu is missing a required element: ${selector}`);
  }
  return element;
}
