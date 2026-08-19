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
import { buildingThumbnail } from './buildingThumbnail';
import { buildGuide, type GuideEntry, type GuideSection, type GuideTable } from './guideContent';

/**
 * How big a building's picture is in the guide, in CSS pixels.
 *
 * Wide enough to tell a Storage Yard from a House at a glance, which is the
 * whole job, and small enough that twenty-one of them do not turn the buildings
 * section into a gallery the reader has to scroll past to reach the words. The
 * canvas is drawn at twice this and scaled down, so it stays sharp on a tablet.
 */
const THUMBNAIL = { width: 76, height: 52 } as const;

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

  // A definition list, because that is what this is: a term and what it means.
  // Screen readers get the pairing for free, which a stack of divs would lose.
  const list = document.createElement('dl');
  list.className = 'guide__list';

  for (const entry of section.entries) {
    const term = renderTerm(entry);
    const detail = document.createElement('dd');
    detail.className = 'guide__detail';
    detail.textContent = entry.detail;

    list.append(term, detail);
  }

  if (section.entries.length > 0) {
    element.append(list);
  }
  for (const table of section.tables) {
    element.append(renderTable(table));
  }
  return element;
}

/**
 * The name of a thing, its figures, and — for a building — a picture of it.
 *
 * **The picture was asked for, and the worry was that it would be a lot of
 * trouble.** It is one call: the building art draws onto a plain canvas as
 * happily as onto a Phaser scene, so the guide shows the *same* building the map
 * does rather than an illustration of it that could fall out of date.
 *
 * The words keep their own column beside it. A picture above a name would make
 * every row twice as tall, and the buildings section is twenty-one rows long.
 */
function renderTerm(entry: GuideEntry): HTMLElement {
  const term = document.createElement('dt');
  term.className = 'guide__term';

  const words = document.createElement('span');
  words.className = 'guide__words';
  words.append(span('guide__name', entry.term));

  if (entry.meta) {
    words.append(span('guide__meta', entry.meta));
  }

  // Its own line under the cost, and a shade brighter: what a building makes is
  // the reason to build it, and it should not read as more small print.
  if (entry.output) {
    words.append(span('guide__meta guide__meta--output', entry.output));
  }

  if (entry.art === null) {
    term.append(words);
    return term;
  }

  term.classList.add('guide__term--illustrated');
  const source = buildingThumbnail(entry.art, THUMBNAIL);
  if (source !== '') {
    const image = document.createElement('img');
    image.className = 'guide__thumb';
    image.src = source;
    image.width = THUMBNAIL.width;
    image.height = THUMBNAIL.height;
    // The name beside it says what it is; the picture repeating that is noise to
    // anybody listening to the page rather than looking at it.
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    term.append(image);
  }
  term.append(words);
  return term;
}

function span(className: string, text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * A block of figures, as a real table.
 *
 * A `<table>` rather than a grid of divs because it *is* tabular data: the
 * column a cell belongs to is part of its meaning, and a screen reader reading
 * "12" without "firewood, a year" has been told nothing. `scope` on the headings
 * is what buys that, and it costs one attribute.
 *
 * The wrapper scrolls sideways on a narrow phone rather than squeezing four
 * columns into three hundred pixels. `touch-action` has to grant the horizontal
 * pan back explicitly: the sheet grants only `pan-y`, so without this a table
 * wider than the screen could not be reached on the device the game is aimed at.
 */
function renderTable(table: GuideTable): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'guide__table-wrap';
  wrapper.dataset['table'] = table.id;

  const element = document.createElement('table');
  element.className = 'guide__table';

  const caption = document.createElement('caption');
  caption.className = 'guide__caption';
  caption.textContent = table.caption;
  element.append(caption);

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const [index, column] of table.columns.entries()) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    // Everything after the first column is a figure or a short phrase; the
    // first is what the row is about, and reads better left.
    if (index > 0) {
      cell.className = 'guide__cell--figure';
    }
    cell.textContent = column;
    headRow.append(cell);
  }
  head.append(headRow);
  element.append(head);

  const body = document.createElement('tbody');
  for (const row of table.rows) {
    const line = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row';
    label.className = 'guide__cell--label';
    label.textContent = row.label;
    line.append(label);

    for (const value of row.values) {
      const cell = document.createElement('td');
      cell.className = 'guide__cell--figure';
      cell.textContent = value;
      line.append(cell);
    }
    body.append(line);
  }
  element.append(body);
  wrapper.append(element);

  if (table.note) {
    const note = document.createElement('p');
    note.className = 'guide__note';
    note.textContent = table.note;
    wrapper.append(note);
  }

  return wrapper;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Guide is missing a required element: ${selector}`);
  }
  return element;
}
