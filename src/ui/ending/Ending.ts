/**
 * The sheet that opens when the ship lands.
 *
 * A thin renderer over {@link buildEnding}, like every other panel in the game.
 *
 * Two decisions worth knowing about.
 *
 * **It opens itself, once.** The player is not going to be looking at a menu
 * when the ship arrives after decades of settlement time, so waiting for them
 * to press something would let the moment pass unmarked. It shows on the tick
 * the ship lands and never again, tracked by the arrival tick rather than by a
 * bare boolean so that reloading a rescued settlement does not reopen it.
 *
 * **Closing it leaves the game running.** This is not a failure overlay: the
 * settlement is still standing, and a player who wants to keep it going after
 * the ship has been is welcome to. That is why the close button says "stay a
 * while longer" rather than "close".
 */

import type { GameContext } from '@/game/Game';
import type { I18n } from '@/ui/i18n/I18n';
import type { LedgerRow } from '@/ui/ledger/ledgerModel';
import { buildEnding } from './endingModel';

export class Ending {
  private readonly context: GameContext;
  private readonly i18n: I18n;

  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lede: HTMLElement;
  private readonly figures: HTMLElement;
  private readonly closeButton: HTMLButtonElement;

  /** The arrival this sheet has already shown, so it shows each one once. */
  private shownArrival: number | null = null;
  private onClose: (() => void) | null = null;

  constructor(root: HTMLElement, context: GameContext, i18n: I18n) {
    this.context = context;
    this.i18n = i18n;
    this.root = requireElement(root, '[data-ui="ending"]');
    this.title = requireElement(root, '[data-ui="ending-title"]');
    this.lede = requireElement(root, '[data-ui="ending-lede"]');
    this.figures = requireElement(root, '[data-ui="ending-figures"]');
    this.closeButton = requireElement(root, '[data-ui="ending-close"]') as HTMLButtonElement;

    this.closeButton.addEventListener('click', () => this.close());
  }

  public get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * `true` when the ship has landed and this arrival has not been shown yet.
   *
   * A query rather than a self-opening update, so the caller pauses the clock
   * through the same helper it uses for every other sheet — one place that
   * knows how a sheet takes over, rather than two that must agree.
   */
  public get isPending(): boolean {
    const arrived = this.context.simulation.rescueTicks.arrivedTick;
    return arrived !== null && arrived !== this.shownArrival;
  }

  /**
   * Marks an already-rescued settlement as seen without showing the sheet.
   *
   * Loading a save from after the ship came should not replay the ending — the
   * player has had it. Called by the loader rather than inferred here, because
   * from inside this class a restored arrival and a fresh one look identical.
   */
  public markSeen(): void {
    this.shownArrival = this.context.simulation.rescueTicks.arrivedTick;
  }

  /**
   * Shows the sheet.
   *
   * Takes a `closeLabel` it deliberately ignores, so the shared `openPaused`
   * helper can drive this exactly as it drives the guide and the ledger. This
   * one sheet names its own close button: "stay a while longer" is the whole
   * difference between an ending and a dismissal.
   */
  public open(options?: { readonly closeLabel?: string; readonly onClose: () => void }): void {
    this.onClose = options?.onClose ?? null;
    this.markSeen();
    this.render();
    this.root.hidden = false;
    this.figures.scrollTop = 0;
    this.closeButton.focus();
  }

  public close(): void {
    if (!this.isOpen) {
      return;
    }
    this.root.hidden = true;
    const callback = this.onClose;
    this.onClose = null;
    callback?.();
  }

  private render(): void {
    const view = buildEnding(this.context.simulation, (key) => this.i18n.t(key));
    this.title.textContent = view.title;
    this.lede.textContent = view.lede;
    this.closeButton.textContent = this.i18n.t('ending.close');
    this.figures.replaceChildren(...view.figures.map((figure) => renderFigure(figure)));
  }
}

function renderFigure(figure: LedgerRow): HTMLElement {
  const element = document.createElement('div');
  element.className = 'ledger__row';

  const label = document.createElement('span');
  label.className = 'ledger__label';
  label.textContent = figure.label;

  const value = document.createElement('span');
  value.className = 'ledger__value';
  if (figure.tone) {
    value.classList.add(`is-${figure.tone}`);
  }
  value.textContent = figure.value;

  element.append(label, value);
  return element;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Ending is missing a required element: ${selector}`);
  }
  return element;
}
