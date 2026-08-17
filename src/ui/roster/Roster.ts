/**
 * The people panel.
 *
 * A thin renderer over {@link buildRoster}, which decides everything about what
 * the panel *says*; this file only decides how it looks and what happens when
 * the player changes somebody's work.
 *
 * It reuses the instructions sheet's chrome — same full-screen shell, same
 * scrolling body — because it is the same kind of thing: something you open,
 * read, act on and close, on a screen that has no room to show it beside the
 * settlement.
 *
 * **Rebuilt on open and after a change, not every frame.** A settlement of
 * three hundred is three hundred rows with a `<select>` each, and rebuilding
 * that at 60fps next to a WebGL canvas would cost more than the whole
 * simulation. Nothing here is urgent enough to need live numbers: the clock is
 * paused while it is open.
 */

import type { GameContext } from '@/game/Game';
import type { I18n } from '@/ui/i18n/I18n';
import type { MessageKey } from '@/ui/i18n/messages';
import { SPIRIT_NEUTRAL } from '@/simulation/seasons/SurvivalSystem';
import {
  buildRoster,
  workPreferenceFrom,
  type RosterHousehold,
  type RosterPerson,
  type RosterView,
} from './rosterModel';

export class Roster {
  private readonly context: GameContext;
  private readonly i18n: I18n;
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private onClose: (() => void) | null = null;

  constructor(root: HTMLElement, context: GameContext, i18n: I18n) {
    this.context = context;
    this.i18n = i18n;
    this.root = requireElement(root, '[data-ui="roster"]');
    this.title = requireElement(root, '[data-ui="roster-title"]');
    this.body = requireElement(root, '[data-ui="roster-body"]');
    this.closeButton = requireElement(root, '[data-ui="roster-close"]') as HTMLButtonElement;

    this.closeButton.addEventListener('click', () => this.close());
  }

  public get isOpen(): boolean {
    return !this.root.hidden;
  }

  public open(options: { readonly closeLabel: string; readonly onClose: () => void }): void {
    this.onClose = options.onClose;
    this.closeButton.textContent = options.closeLabel;
    this.render();
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

  private render(): void {
    const t = (key: MessageKey): string => this.i18n.t(key);
    const view = buildRoster(this.context.simulation, t);

    this.title.textContent = t('roster.title');
    this.body.replaceChildren(
      this.renderSummary(view),
      ...(view.households.length === 0
        ? [emptyNotice(t('roster.empty'))]
        : view.households.map((household) => this.renderHousehold(household, view))),
    );
  }

  private renderSummary(view: RosterView): HTMLElement {
    const t = (key: MessageKey): string => this.i18n.t(key);
    const section = document.createElement('section');
    section.className = 'roster__summary';

    const counts: [string, string][] = [
      [t('roster.people'), String(view.summary.people)],
      [t('roster.adults'), `${view.summary.adults} / ${view.summary.children}`],
      [t('roster.labourers'), String(view.summary.labourers)],
      [t('roster.vacancies'), String(view.summary.vacancies)],
      [t('roster.ill'), String(view.summary.ill)],
      [t('roster.homeless'), String(view.summary.homeless)],
      [t('roster.toolCoverage'), percent(view.summary.toolCoverage)],
      [t('roster.clothingCoverage'), percent(view.summary.clothingCoverage)],
    ];

    for (const [label, value] of counts) {
      const item = document.createElement('div');
      item.className = 'roster__stat';
      const name = document.createElement('span');
      name.className = 'roster__stat-label';
      name.textContent = label;
      const figure = document.createElement('span');
      figure.className = 'roster__stat-value';
      figure.textContent = value;
      item.append(name, figure);
      section.append(item);
    }

    // Said out loud rather than implied by a column: tools and coats are a
    // shared pool, and a reader who assumed otherwise would misread every row.
    const note = document.createElement('p');
    note.className = 'roster__note';
    note.textContent = t('roster.suppliesNote');
    section.append(note);

    return section;
  }

  private renderHousehold(household: RosterHousehold, view: RosterView): HTMLElement {
    const section = document.createElement('section');
    section.className = 'roster__household';
    if (household.homeId === null) {
      section.classList.add('is-roofless');
    }

    const heading = document.createElement('h3');
    heading.className = 'roster__heading';
    heading.textContent = household.title;
    section.append(heading);

    for (const person of household.people) {
      section.append(this.renderPerson(person, view));
    }

    return section;
  }

  private renderPerson(person: RosterPerson, view: RosterView): HTMLElement {
    const t = (key: MessageKey): string => this.i18n.t(key);
    const row = document.createElement('article');
    row.className = 'roster__person';
    if (person.isIll) {
      row.classList.add('is-ill');
    }

    const identity = document.createElement('div');
    identity.className = 'roster__identity';

    const name = document.createElement('span');
    name.className = 'roster__name';
    name.textContent = person.name;
    identity.append(name);

    const age = document.createElement('span');
    age.className = 'roster__age';
    age.textContent = person.isChild
      ? `${person.age} ${t('roster.years')} · ${t('roster.child')}`
      : `${person.age} ${t('roster.years')}`;
    identity.append(age);

    const doing = document.createElement('span');
    doing.className = 'roster__doing';
    doing.textContent = person.isIll ? t('villager.ill') : `${person.job} · ${person.activity}`;
    identity.append(doing);

    row.append(identity);
    row.append(this.renderNeeds(person));
    row.append(this.renderFamily(person));

    // Children take no work, so offering them a job picker would be offering a
    // control that does nothing.
    row.append(
      person.isChild ? document.createElement('div') : this.renderWorkPicker(person, view),
    );

    return row;
  }

  private renderNeeds(person: RosterPerson): HTMLElement {
    const t = (key: MessageKey): string => this.i18n.t(key);
    const needs = document.createElement('div');
    needs.className = 'roster__needs';

    /**
     * Three needs and one bonus, which do not read the same way.
     *
     * Hunger, warmth and health are **requirements**: low is bad and is
     * coloured as such. Spirit is a **bonus** that sits at neutral by default
     * — colouring 50 red would tell the player something is wrong with a
     * settlement that is playing exactly the game it always did. So it only
     * ever colours upwards.
     */
    const bars: { label: string; value: number; bonus?: true }[] = [
      { label: t('roster.hunger'), value: person.needs.hunger },
      { label: t('roster.warmth'), value: person.needs.warmth },
      { label: t('roster.health'), value: person.needs.health },
      { label: t('need.spirit'), value: person.needs.spirit, bonus: true },
    ];

    for (const { label, value, bonus } of bars) {
      const meter = document.createElement('div');
      meter.className = 'roster__meter';
      // Real semantics rather than a coloured div: a screen reader gets the
      // number, and the value is legible without the colour.
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-label', label);
      meter.setAttribute('aria-valuenow', String(value));
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      meter.title = `${label} ${value}%`;
      if (bonus) {
        if (value > SPIRIT_NEUTRAL) {
          meter.classList.add('is-thriving');
        }
      } else if (value <= 25) {
        meter.classList.add('is-critical');
      } else if (value <= 55) {
        meter.classList.add('is-low');
      }

      const fill = document.createElement('span');
      fill.className = 'roster__meter-fill';
      fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
      meter.append(fill);

      const caption = document.createElement('span');
      caption.className = 'roster__meter-label';
      caption.textContent = label;

      const wrapper = document.createElement('div');
      wrapper.className = 'roster__meter-row';
      wrapper.append(caption, meter);
      needs.append(wrapper);
    }

    return needs;
  }

  private renderFamily(person: RosterPerson): HTMLElement {
    const t = (key: MessageKey): string => this.i18n.t(key);
    const family = document.createElement('div');
    family.className = 'roster__family';

    const lines: [MessageKey, string | null][] = [
      ['roster.partner', person.partner],
      ['roster.parents', person.parents],
      ['roster.children', person.children.length > 0 ? person.children.join(', ') : null],
      // "Woodcutter (master, 6 years)". Only drawn when they have learned
      // something: a row that says "none" says a villager has a trade and then
      // takes it back.
      [
        'roster.trades',
        person.trades.length > 0
          ? person.trades
              .map(
                (entry) =>
                  `${entry.trade} (${entry.level}, ${entry.years}\u00a0${t('roster.years')})`,
              )
              .join(', ')
          : null,
      ],
      ['roster.carrying', person.carrying],
    ];

    for (const [key, value] of lines) {
      if (value === null) {
        continue;
      }
      const line = document.createElement('span');
      line.className = 'roster__fact';
      const label = document.createElement('span');
      label.className = 'roster__fact-label';
      label.textContent = t(key);
      line.append(label, document.createTextNode(` ${value}`));
      family.append(line);
    }

    return family;
  }

  private renderWorkPicker(person: RosterPerson, view: RosterView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'roster__work';

    const label = document.createElement('label');
    label.className = 'roster__work-label';
    label.textContent = this.i18n.t('roster.work');
    label.htmlFor = `roster-work-${person.id}`;

    const select = document.createElement('select');
    select.className = 'roster__select';
    select.id = `roster-work-${person.id}`;

    for (const option of view.options) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      element.selected = option.value === person.work;
      select.append(element);
    }

    select.addEventListener('change', () => {
      this.context.setWorkPreference(person.id, workPreferenceFrom(select.value));
      // Re-read rather than trust the picker: employment decides what actually
      // happens, and a settlement with no spare hands may leave somebody where
      // they were. Showing the request as though it had been carried out would
      // be the panel telling the player something untrue.
      this.render();
    });

    wrapper.append(label, select);
    return wrapper;
  }
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function emptyNotice(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'roster__note';
  element.textContent = text;
  return element;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Roster is missing a required element: ${selector}`);
  }
  return element;
}
