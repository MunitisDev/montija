/**
 * Everything that is not the settlement.
 *
 * The HUD had grown a row of buttons that had nothing to do with playing — the
 * rules, full screen, language — and a save/load pair taking a corner of the
 * bottom bar. On a phone held upright that pushed the top strip to three rows
 * and cost a band of the world on both edges, to show controls a player touches
 * once a session.
 *
 * So they live behind one cog. The rule for what belongs here: **if it is not
 * about the settlement, it is not on the screen.** Resources, the calendar, the
 * build bar, the speed controls and the contextual panels are the game; the
 * rest is housekeeping.
 *
 * The one exception to "housekeeping only" is beginning again, which is here
 * because there is nowhere else for it: a player who wants a different valley
 * should not have to lose this one first, and the main menu is behind a refresh.
 *
 * Audio will land here when there is any. Deliberately no control for it yet:
 * a volume slider that adjusts nothing is worse than no slider at all.
 */

import { bindFullscreenButton } from '@/ui/Fullscreen';
import type { GameContext } from '@/game/Game';
import type { Guide } from '@/ui/guide/Guide';
import { LANGUAGES, type I18n } from '@/ui/i18n/I18n';

export class SettingsMenu {
  private readonly context: GameContext;
  private readonly i18n: I18n;
  private readonly guide: Guide;

  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly gameHeading: HTMLElement;
  private readonly displayHeading: HTMLElement;
  private readonly guideButton: HTMLButtonElement;
  private readonly languageButton: HTMLButtonElement;
  private readonly restartButton: HTMLButtonElement;
  private readonly restartNote: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly fullscreenButton: HTMLButtonElement | null;

  private renderedLanguageVersion = -1;
  /** `true` once the restart button has been pressed and is asking. */
  private restartArmed = false;
  private renderedSaveVersion = -1;
  private isFullscreen = false;
  private onClose: (() => void) | null = null;

  constructor(options: {
    readonly root: HTMLElement;
    readonly context: GameContext;
    readonly i18n: I18n;
    readonly guide: Guide;
    /** The element fullscreen applies to — the whole game, not the canvas. */
    readonly fullscreenTarget: HTMLElement;
    /** Told when full screen changes, so the HUD layout can respond. */
    readonly onFullscreenChange?: (active: boolean) => void;
    /**
     * Called after the player throws this settlement away for a new one.
     *
     * The shell uses it to ask for a name: the old file goes with the old
     * settlement, and a valley nobody names is a valley nobody can come back to.
     */
    readonly onSettlementReplaced?: () => void;
  }) {
    this.context = options.context;
    this.i18n = options.i18n;
    this.guide = options.guide;

    const root = options.root;
    this.root = requireElement(root, '[data-ui="settings"]');
    this.title = requireElement(root, '[data-ui="settings-title"]');
    this.gameHeading = requireElement(root, '[data-ui="settings-game"]');
    this.displayHeading = requireElement(root, '[data-ui="settings-display"]');
    this.guideButton = requireElement(root, '[data-ui="settings-guide"]') as HTMLButtonElement;
    this.languageButton = requireElement(
      root,
      '[data-ui="settings-language"]',
    ) as HTMLButtonElement;
    this.restartButton = requireElement(root, '[data-ui="settings-restart"]') as HTMLButtonElement;
    this.restartNote = requireElement(root, '[data-ui="settings-restart-note"]');
    this.closeButton = requireElement(root, '[data-ui="settings-close"]') as HTMLButtonElement;
    this.saveButton = requireElement(root, '[data-hud="save"]') as HTMLButtonElement;
    this.loadButton = requireElement(root, '[data-hud="load"]') as HTMLButtonElement;
    this.status = requireElement(root, '[data-hud="save-status"]');
    this.fullscreenButton = root.querySelector<HTMLButtonElement>('[data-hud="fullscreen"]');

    this.closeButton.addEventListener('click', () => this.close());

    // Opening the rules from here closes this and comes back to it afterwards,
    // so the player lands where they left rather than back in the settlement.
    this.guideButton.addEventListener('click', () => {
      this.root.hidden = true;
      this.guide.open({
        closeLabel: this.i18n.t('menu.back'),
        onClose: () => {
          this.root.hidden = false;
          this.render();
        },
      });
    });

    // **Asks once, in place.** Beginning again throws away a settlement somebody
    // has spent an hour on, and a single tap next to "Full screen" is too cheap
    // for that. The button becomes the question and the second press answers it,
    // which needs no dialog, no extra sheet and no blocking browser prompt — and
    // closing the sheet forgets it was ever asked.
    this.restartButton.addEventListener('click', () => {
      if (!this.restartArmed) {
        this.restartArmed = true;
        this.labelRestart();
        return;
      }
      this.restartArmed = false;
      // A new seed, so it is a new valley rather than this one again.
      this.context.startNewSettlement();
      this.close();
      options.onSettlementReplaced?.();
    });

    this.languageButton.addEventListener('click', () => {
      const next = LANGUAGES[(LANGUAGES.indexOf(this.i18n.language) + 1) % LANGUAGES.length];
      if (next) {
        this.i18n.setLanguage(next);
      }
      this.render();
    });

    // Both disable themselves while running, so an impatient double-tap cannot
    // start two writes at once.
    this.saveButton.addEventListener('click', () => {
      void this.run(this.saveButton, () => this.context.save());
    });
    this.loadButton.addEventListener('click', () => {
      void this.run(this.loadButton, () => this.context.load());
    });

    if (this.fullscreenButton) {
      bindFullscreenButton({
        button: this.fullscreenButton,
        target: options.fullscreenTarget,
        onChange: (active) => {
          this.isFullscreen = active;
          this.labelFullscreen();
          options.onFullscreenChange?.(active);
        },
      });
    }
  }

  public get isOpen(): boolean {
    return !this.root.hidden;
  }

  public open(options: { readonly onClose: () => void }): void {
    this.onClose = options.onClose;
    this.restartArmed = false;
    this.render();
    this.root.hidden = false;
    this.closeButton.focus();
  }

  public close(): void {
    if (!this.isOpen) {
      return;
    }
    this.root.hidden = true;
    this.restartArmed = false;
    const callback = this.onClose;
    this.onClose = null;
    callback?.();
  }

  /**
   * Keeps the save status current while the sheet is open.
   *
   * Only the status needs a pulse: everything else here changes when the player
   * presses something, and a save finishes on its own some time after.
   */
  public update(): void {
    if (!this.isOpen || this.renderedSaveVersion === this.context.saveVersion) {
      return;
    }
    this.renderedSaveVersion = this.context.saveVersion;
    this.status.textContent = this.context.saveStatus;
  }

  private async run(button: HTMLButtonElement, action: () => Promise<boolean>): Promise<void> {
    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
      this.update();
    }
  }

  private render(): void {
    this.status.textContent = this.context.saveStatus;
    this.renderedSaveVersion = this.context.saveVersion;

    if (this.renderedLanguageVersion === this.i18n.changeVersion) {
      return;
    }
    this.renderedLanguageVersion = this.i18n.changeVersion;

    this.title.textContent = this.i18n.t('settings.title');
    this.gameHeading.textContent = this.i18n.t('settings.game');
    this.displayHeading.textContent = this.i18n.t('settings.display');
    this.guideButton.textContent = this.i18n.t('menu.howToPlay');
    this.closeButton.textContent = this.i18n.t('menu.close');
    this.saveButton.textContent = this.i18n.t('action.save');
    this.loadButton.textContent = this.i18n.t('action.load');
    this.languageButton.textContent = `${this.i18n.t('settings.language')}: ${this.i18n.language.toUpperCase()}`;
    this.restartNote.textContent = this.i18n.t('settings.restartNote');
    this.labelRestart();
    this.labelFullscreen();
  }

  private labelRestart(): void {
    const key = this.restartArmed ? 'settings.restartConfirm' : 'settings.restart';
    const label = this.i18n.t(key);
    if (this.restartButton.textContent !== label) {
      this.restartButton.textContent = label;
    }
    this.restartButton.dataset.armed = this.restartArmed ? 'true' : 'false';
  }

  private labelFullscreen(): void {
    if (!this.fullscreenButton) {
      return;
    }
    this.fullscreenButton.textContent = this.i18n.t(
      this.isFullscreen ? 'action.exitFullscreen' : 'action.fullscreen',
    );
  }
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Settings is missing a required element: ${selector}`);
  }
  return element;
}
