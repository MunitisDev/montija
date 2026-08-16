/**
 * The ledger sheet.
 *
 * A thin renderer over {@link buildLedger}: it decides nothing about what the
 * figures say, only how they look. Same split as the guide and the people
 * panel, and for the same reason — the arithmetic is the part worth testing.
 *
 * Tabs rather than one long page because the four views answer four different
 * questions, and a player asking "can we feed everyone" should not have to
 * scroll past a building census to find out. The chosen tab is remembered while
 * the sheet is closed: somebody watching their food balance through a winter
 * reopens on the food balance.
 */

import type { GameContext } from '@/game/Game';
import type { I18n } from '@/ui/i18n/I18n';
import {
  LEDGER_TABS,
  buildLedger,
  type LedgerRow,
  type LedgerSection,
  type LedgerTab,
  type LedgerTabId,
} from './ledgerModel';

export class Ledger {
  private readonly context: GameContext;
  private readonly i18n: I18n;

  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly tabStrip: HTMLElement;
  private readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;

  private readonly tabButtons = new Map<LedgerTabId, HTMLButtonElement>();
  private active: LedgerTabId = 'people';
  private onClose: (() => void) | null = null;

  constructor(root: HTMLElement, context: GameContext, i18n: I18n) {
    this.context = context;
    this.i18n = i18n;
    this.root = requireElement(root, '[data-ui="ledger"]');
    this.title = requireElement(root, '[data-ui="ledger-title"]');
    this.tabStrip = requireElement(root, '[data-ui="ledger-tabs"]');
    this.body = requireElement(root, '[data-ui="ledger-body"]');
    this.closeButton = requireElement(root, '[data-ui="ledger-close"]') as HTMLButtonElement;

    this.closeButton.addEventListener('click', () => this.close());

    for (const id of LEDGER_TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ledger__tab';
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => {
        this.active = id;
        this.render();
      });
      this.tabButtons.set(id, button);
      this.tabStrip.append(button);
    }
  }

  public get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * Shows the sheet.
   *
   * Takes `closeLabel` it does not vary, so the shared `openPaused` helper can
   * drive this the same way it drives the guide and the people panel.
   */
  public open(options: { readonly closeLabel: string; readonly onClose: () => void }): void {
    this.onClose = options.onClose;
    this.render();
    this.closeButton.textContent = options.closeLabel;
    this.root.hidden = false;
    this.body.scrollTop = 0;
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

  /**
   * Rebuilds the sheet from the simulation.
   *
   * Unconditional rather than diffed: the sheet only exists while it is open,
   * the game is paused behind it, and it is redrawn on a tab press rather than
   * every frame. There is nothing here to be clever about.
   */
  private render(): void {
    const tabs = buildLedger(this.context.simulation, (key) => this.i18n.t(key));
    this.title.textContent = this.i18n.t('ledger.title');

    for (const tab of tabs) {
      const button = this.tabButtons.get(tab.id);
      if (!button) {
        continue;
      }
      button.textContent = tab.title;
      const active = tab.id === this.active;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }

    const current = tabs.find((tab) => tab.id === this.active) ?? tabs[0];
    this.body.replaceChildren(...(current ? renderTab(current) : []));
  }
}

function renderTab(tab: LedgerTab): HTMLElement[] {
  const nodes: HTMLElement[] = [];

  if (tab.note) {
    const note = document.createElement('p');
    note.className = 'ledger__note';
    note.textContent = tab.note;
    nodes.push(note);
  }

  for (const section of tab.sections) {
    nodes.push(renderSection(section));
  }
  return nodes;
}

function renderSection(section: LedgerSection): HTMLElement {
  const element = document.createElement('section');
  element.className = 'ledger__section';
  element.dataset['section'] = section.id;

  const heading = document.createElement('h3');
  heading.className = 'ledger__heading';
  heading.textContent = section.title;
  element.append(heading);

  if (section.rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ledger__empty';
    empty.textContent = section.empty ?? '';
    element.append(empty);
    return element;
  }

  for (const row of section.rows) {
    element.append(renderRow(row));
  }
  return element;
}

function renderRow(row: LedgerRow): HTMLElement {
  const element = document.createElement('div');
  element.className = 'ledger__row';

  const label = document.createElement('span');
  label.className = 'ledger__label';
  label.textContent = row.label;

  const value = document.createElement('span');
  value.className = 'ledger__value';
  if (row.tone) {
    value.classList.add(`is-${row.tone}`);
  }
  value.textContent = row.value;

  element.append(label, value);

  if (row.detail) {
    const detail = document.createElement('span');
    detail.className = 'ledger__detail';
    detail.textContent = row.detail;
    element.append(detail);
  }
  return element;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Ledger is missing a required element: ${selector}`);
  }
  return element;
}
