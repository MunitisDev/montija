/**
 * The full stores, one tap under the resource strip.
 *
 * The strip carries the four a settlement lives or dies by. Everything else —
 * iron, tools, hides, coats, herbs, and whatever the game learns to make later
 * — lives here. Nine numbers across a phone held upright is two lines of world
 * given up to figures a player checks occasionally, and the list only grows.
 *
 * **Not a sheet, and it does not pause.** Glancing at the stores is not
 * stopping to read: the drawer hangs under the bar, the settlement carries on
 * behind it, and a tap anywhere else puts it away. That is the whole difference
 * between this and the ledger, which is where the same numbers go when the
 * player actually wants to sit and think about them.
 *
 * Each row carries what is stored, what is still lying in the field, and the net
 * over a season at the current staffing — which is the answer to "have we got
 * enough coats", the question the raw total cannot answer on its own. A season
 * rather than a day because a day's net is a fraction; see `@/ui/format/rates`.
 */

import { RESOURCE_IDS, type ResourceId } from '@/data/resources';
import type { GameContext } from '@/game/Game';
import { signedSeason } from '@/ui/format/rates';
import type { I18n } from '@/ui/i18n/I18n';
import type { MessageKey } from '@/ui/i18n/messages';
import { estimateFlows, totalDemand } from '@/ui/ledger/ledgerModel';

/**
 * The four that are always listed, whatever the settlement has.
 *
 * The same four the strip carries. A drawer that claims to be the whole store
 * and then omits stone because there is none teaches the player that stone is
 * not in the game — which is the opposite of what a zero is for.
 */
const ALWAYS_LISTED: ReadonlySet<ResourceId> = new Set<ResourceId>([
  'food',
  'logs',
  'firewood',
  'stone',
]);

/** Everything else appears the first time the settlement meets it, and stays. */
function hasMet(resource: ResourceId, stored: number, loose: number, flow: number): boolean {
  return ALWAYS_LISTED.has(resource) || stored > 0 || loose > 0 || flow > 0;
}

export class StockDrawer {
  private readonly context: GameContext;
  private readonly i18n: I18n;

  private readonly toggle: HTMLButtonElement;
  private readonly drawer: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly rows = new Map<
    ResourceId,
    { row: HTMLElement; value: HTMLElement; note: HTMLElement }
  >();

  private renderedLanguageVersion = -1;

  constructor(root: HTMLElement, context: GameContext, i18n: I18n) {
    this.context = context;
    this.i18n = i18n;
    this.toggle = requireElement(root, '[data-ui="stock-toggle"]') as HTMLButtonElement;
    this.drawer = requireElement(root, '[data-ui="stock-drawer"]');
    this.foot = requireElement(root, '[data-ui="stock-foot"]');

    for (const resource of RESOURCE_IDS) {
      const row = root.querySelector<HTMLElement>(`[data-stock="${resource}"]`);
      const value = root.querySelector<HTMLElement>(`[data-drawer="${resource}"]`);
      const note = root.querySelector<HTMLElement>(`[data-drawer-note="${resource}"]`);
      if (row && value && note) {
        this.rows.set(resource, { row, value, note });
      }
    }

    this.toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(!this.isOpen);
    });

    // A tap on the world puts it away. Captured on the document rather than on
    // an invisible backdrop, because a backdrop over the settlement would eat
    // the very pan gesture the player is most likely to make next.
    document.addEventListener('pointerdown', (event) => {
      if (!this.isOpen) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && this.drawer.contains(target)) {
        return;
      }
      this.setOpen(false);
    });
  }

  public get isOpen(): boolean {
    return !this.drawer.hidden;
  }

  public setOpen(open: boolean): void {
    if (open === this.isOpen) {
      return;
    }
    this.drawer.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    this.toggle.classList.toggle('is-open', open);
    if (open) {
      this.update();
    }
  }

  /** Refreshes the rows. Cheap when shut, because it does nothing at all. */
  public update(): void {
    if (this.i18n.changeVersion !== this.renderedLanguageVersion) {
      this.renderedLanguageVersion = this.i18n.changeVersion;
      this.toggle.setAttribute('aria-label', this.i18n.t('hud.stores'));
    }
    if (!this.isOpen) {
      return;
    }

    // How full the buildings are, above the caveat. "Have I room for this
    // harvest" is a question about the shed, and there was nowhere on screen
    // that answered it — a settlement whose larder is full stops carrying food
    // in and says nothing about why.
    // The larder line only once one is built: before that the founding yard is
    // both, and the same figure twice under two names is noise.
    const fills = [this.describeFill('logs', 'stock.yards')];
    if (this.context.simulation.storages.hasLarder) {
      fills.push(this.describeFill('food', 'stock.larders'));
    }
    this.foot.textContent = `${fills.join(' · ')} — ${this.i18n.t('stock.foot')}`;

    const snapshot = this.context.snapshot();
    const flows = estimateFlows(this.context.simulation);

    for (const [resource, elements] of this.rows) {
      const stored = snapshot.stored[resource];
      const loose = snapshot.loose[resource];
      const made = flows.production.get(resource) ?? 0;
      const spent = totalDemand(flows, resource);

      // A good the settlement has never seen is not "0", it is not part of the
      // game yet. Hiding the row keeps the drawer a list of what exists.
      elements.row.hidden = !hasMet(resource, stored, loose, made + spent);
      elements.value.textContent = String(stored);

      const parts: string[] = [];
      if (loose > 0) {
        parts.push(`+${loose} ${this.i18n.t('stock.loose')}`);
      }
      if (made > 0 || spent > 0) {
        parts.push(`${signedSeason(made - spent)}${this.i18n.t('stock.perSeason')}`);
      }
      elements.note.textContent = parts.join(' · ');
      elements.note.classList.toggle('is-bad', spent > made);
    }
  }

  /**
   * One store's fill, as `Yards 26% (520/2000)`.
   *
   * "None built" rather than a percentage when there is nowhere at all: nought
   * of nought is not empty, and a settlement with no larder is in a different
   * kind of trouble from one with an empty larder.
   */
  private describeFill(resource: ResourceId, label: MessageKey): string {
    const { used, capacity } = this.context.simulation.storages.fill(resource);
    const name = this.i18n.t(label);
    if (capacity <= 0) {
      return `${name} ${this.i18n.t('stock.none')}`;
    }
    return `${name} ${Math.round((used / capacity) * 100)}% (${used}/${capacity})`;
  }
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Stock drawer is missing a required element: ${selector}`);
  }
  return element;
}
