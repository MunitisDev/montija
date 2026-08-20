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
 * - **The clock is paused while it is open, and stays paused after it.** A
 *   settlement quietly starving behind a title card would be a cruel way to
 *   start; and once the card is gone, the player gets as long as they like to
 *   look at the valley before the year begins running.
 * - **"New settlement" does not found a new one.** The world behind the menu is
 *   already new, and re-founding would throw it away to generate an identical
 *   replacement. Beginning again after a settlement dies is the failure
 *   overlay's job, and it already does it.
 *
 * **It is also where a settlement gets its name**, and that is not decoration: a
 * settlement's name is its save file. One file each, written as each year turns,
 * deleted when everybody dies — so the menu is the place the player picks which
 * of their valleys to go back to, and the place the bargain is stated before they
 * accept it. See `simulation/save/settlementName.ts`.
 */

import { suggestedPlaceName } from '@/data/places';
import type { GameContext } from '@/game/Game';
import type { SaveSummary } from '@/simulation/save/SaveGame';
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
  private readonly saveList: HTMLElement;
  private readonly nameForm: HTMLFormElement;
  private readonly nameLabel: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly foundButton: HTMLButtonElement;
  private readonly permadeathNote: HTMLElement;

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
    this.saveList = requireElement(root, '[data-ui="menu-saves"]');
    this.nameForm = requireElement(root, '[data-ui="menu-name"]') as HTMLFormElement;
    this.nameLabel = requireElement(root, '[data-ui="menu-name-label"]');
    this.nameInput = requireElement(root, '[data-ui="menu-name-input"]') as HTMLInputElement;
    this.foundButton = requireElement(root, '[data-ui="menu-found"]') as HTMLButtonElement;
    this.permadeathNote = requireElement(root, '[data-ui="menu-permadeath"]');

    // **A new settlement is named before it is played.** Nothing is written to
    // disk until it has a name, so asking here is the difference between a run
    // the player can come back to and one they cannot.
    this.newButton.addEventListener('click', () => this.askForAName());

    this.nameForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.found();
    });

    this.continueButton.addEventListener('click', () => {
      // Play first and load second: a failed load leaves the player in the new
      // settlement with the HUD's own status line explaining why, which beats
      // being stranded on a menu whose button appears to do nothing.
      const newest = this.saves[0];
      this.startPlaying();
      if (newest) {
        void this.context.loadSettlement(newest.slot);
      }
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

  /** What the store held when the menu was last opened. */
  private saves: readonly SaveSummary[] = [];

  public get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * Shows the menu and stops the clock until the player chooses.
   *
   * `naming` opens straight onto the name box, which is what beginning again
   * after a settlement has died should do: the old file is already gone, and the
   * one thing that has to happen before the new valley can be kept is naming it.
   */
  public open(options: { readonly naming?: boolean } = {}): void {
    this.context.clock.pause();
    this.render();
    this.root.hidden = false;
    document.body.classList.add('is-menu-open');
    if (options.naming === true) {
      this.askForAName();
    } else {
      this.showActions();
    }

    // Offered only when there is genuinely something to continue. Asking the
    // store is asynchronous, so the button starts disabled and enables itself
    // rather than promising something that may not be there.
    this.continueButton.disabled = true;
    this.saveList.replaceChildren();
    void this.context
      .listSettlements()
      .then((saves) => {
        this.saves = saves;
        this.renderSaves();
      })
      .catch(() => {
        // A browser refusing IndexedDB is not a reason to refuse the game.
        this.continueButton.disabled = true;
      });
  }

  /**
   * Draws the newest settlement onto Continue, and the rest underneath.
   *
   * Named on the button — *Continue · Peñalba* — because with one file per
   * settlement the player is not resuming "the game", they are going back to a
   * particular valley, and which one is the only thing worth knowing before they
   * tap it.
   */
  private renderSaves(): void {
    const newest = this.saves[0];
    this.continueButton.disabled = newest === undefined;
    this.continueButton.textContent =
      newest === undefined
        ? this.i18n.t('menu.continue')
        : `${this.i18n.t('menu.continue')} · ${newest.name}`;
    this.note.textContent = newest === undefined ? this.i18n.t('menu.noSave') : '';

    this.saveList.replaceChildren();
    for (const save of this.saves.slice(1)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu__save';

      const name = document.createElement('span');
      name.textContent = save.name;
      const detail = document.createElement('small');
      detail.textContent = `${this.i18n.t('menu.year')} ${save.year} · ${save.population} ${this.i18n.t('menu.people')}`;

      button.append(name, detail);
      button.addEventListener('click', () => {
        this.startPlaying();
        void this.context.loadSettlement(save.slot);
      });
      this.saveList.append(button);
    }
  }

  /**
   * Opens the name box, with a name already in it.
   *
   * The buttons above it stay: a player who taps New settlement and then changes
   * their mind should be able to go back into the valley they were in, and a
   * screen whose only remaining action is *commit* is a screen with a dead end in
   * it. The list of other settlements does go, because those are the thing the
   * box is an alternative to.
   */
  private askForAName(): void {
    this.saveList.hidden = true;
    this.nameForm.hidden = false;
    this.note.textContent = '';
    // Suggested from the seed, so the valley on screen already has a name rather
    // than the player being handed an empty box. See `data/places.ts`.
    this.nameInput.value = suggestedPlaceName(this.context.snapshot().seed);
    this.nameInput.focus();
    this.nameInput.select();
  }

  private showActions(): void {
    this.saveList.hidden = false;
    this.nameForm.hidden = true;
  }

  /**
   * Founds the settlement under the name in the box.
   *
   * The name may come back changed — a second Peñalba is *Peñalba II* — and when
   * it does the player is told, because a settlement quietly filed under a name
   * they did not choose is a settlement they will not find again.
   */
  private async found(): Promise<void> {
    const asked = this.nameInput.value;
    this.foundButton.disabled = true;
    const founded = await this.context.nameSettlement(asked).catch(() => '');
    this.foundButton.disabled = false;

    if (founded === '') {
      this.nameInput.focus();
      return;
    }

    this.startPlaying();
    this.showActions();
    if (founded !== asked.trim()) {
      this.note.textContent = `${this.i18n.t('menu.foundedAs')} ${founded}`;
    }
  }

  /**
   * Puts the player in the world, with the clock still stopped.
   *
   * **Deliberately not `resume()`.** A settlement begins paused: the first thing
   * to do in this game is read the ground — where the river runs, where the rock
   * is, which way the wood lies — and deciding that against a running clock means
   * deciding it badly. The speed buttons are the first thing on the HUD and
   * pressing one is how the year starts.
   */
  private startPlaying(): void {
    this.root.hidden = true;
    document.body.classList.remove('is-menu-open');
  }

  private render(): void {
    if (this.renderedLanguageVersion === this.i18n.changeVersion) {
      return;
    }
    this.renderedLanguageVersion = this.i18n.changeVersion;

    this.tagline.textContent = this.i18n.t('menu.tagline');
    this.continueButton.textContent = this.i18n.t('menu.continue');
    this.nameLabel.textContent = this.i18n.t('menu.nameLabel');
    this.foundButton.textContent = this.i18n.t('menu.found');
    this.permadeathNote.textContent = this.i18n.t('menu.permadeath');
    this.newButton.textContent = this.i18n.t('menu.newSettlement');
    this.guideButton.textContent = this.i18n.t('menu.howToPlay');
    this.languageButton.textContent = this.i18n.language.toUpperCase();
    if (this.saves.length > 0) {
      this.renderSaves();
    } else if (this.note.textContent !== '') {
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
