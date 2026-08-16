/**
 * The instructions sheet.
 *
 * A thin renderer over {@link buildGuide}: it decides nothing about what the
 * guide says, only how it looks. That split is what lets the content be tested
 * headlessly — see `guideContent.ts` for why.
 *
 * It is a full-screen sheet rather than a side panel because the primary target
 * is a tablet held in landscape, where a panel wide enough to read leaves no
 * room for the settlement anyway. Reading the rules and watching the village
 * are separate activities, so the sheet stops pretending otherwise and takes
 * the screen.
 */

import { type I18n } from '@/ui/i18n/I18n';
import { buildGuide, type GuideSection } from './guideContent';

export class Guide {
  private readonly i18n: I18n;
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private renderedLanguageVersion = -1;
  private onClose: (() => void) | null = null;

  constructor(root: HTMLElement, i18n: I18n) {
    this.i18n = i18n;
    this.root = requireElement(root, '[data-ui="guide"]');
    this.title = requireElement(root, '[data-ui="guide-title"]');
    this.body = requireElement(root, '[data-ui="guide-body"]');
    this.closeButton = requireElement(root, '[data-ui="guide-close"]') as HTMLButtonElement;

    this.closeButton.addEventListener('click', () => this.close());
  }

  public get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * Shows the sheet.
   *
   * `onClose` is how the same sheet serves two callers: opened from the main
   * menu it goes back to the menu, and opened mid-game it hands control back to
   * the settlement. The sheet itself does not need to know which happened.
   */
  public open(options: { readonly closeLabel: string; readonly onClose: () => void }): void {
    this.onClose = options.onClose;
    this.render();
    this.closeButton.textContent = options.closeLabel;
    this.root.hidden = false;
    // Always from the top: a sheet reopened halfway down looks broken.
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

  /** Re-renders if the language changed while the sheet was closed. */
  private render(): void {
    if (this.renderedLanguageVersion === this.i18n.changeVersion) {
      return;
    }
    this.renderedLanguageVersion = this.i18n.changeVersion;

    this.title.textContent = this.i18n.t('guide.title');
    this.body.replaceChildren(
      ...buildGuide((key) => this.i18n.t(key)).map((section) => renderSection(section)),
    );
  }
}

function renderSection(section: GuideSection): HTMLElement {
  const element = document.createElement('section');
  element.className = 'guide__section';
  element.dataset['section'] = section.id;

  const heading = document.createElement('h3');
  heading.className = 'guide__heading';
  heading.textContent = section.title;
  element.append(heading);

  if (section.body) {
    const paragraph = document.createElement('p');
    paragraph.className = 'guide__body';
    paragraph.textContent = section.body;
    element.append(paragraph);
  }

  if (section.entries.length === 0) {
    return element;
  }

  // A definition list, because that is what this is: a term and what it means.
  // Screen readers get the pairing for free, which a stack of divs would lose.
  const list = document.createElement('dl');
  list.className = 'guide__list';

  for (const entry of section.entries) {
    const term = document.createElement('dt');
    term.className = 'guide__term';
    term.textContent = entry.term;

    if (entry.meta) {
      const meta = document.createElement('span');
      meta.className = 'guide__meta';
      meta.textContent = entry.meta;
      term.append(meta);
    }

    const detail = document.createElement('dd');
    detail.className = 'guide__detail';
    detail.textContent = entry.detail;

    list.append(term, detail);
  }

  element.append(list);
  return element;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Guide is missing a required element: ${selector}`);
  }
  return element;
}
