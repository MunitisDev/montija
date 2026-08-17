/**
 * The labour panel.
 *
 * A thin renderer over {@link buildLabour}, which decides everything the page
 * *says*. This file decides how it looks, and what a press does.
 *
 * It reuses the sheet chrome the rules and the people panel use, because it is
 * the same kind of thing: open, read, act, close. The clock is stopped while it
 * is open, which is what makes reassigning six people at once a decision rather
 * than a race.
 *
 * **Rebuilt on every press rather than diffed.** A quota change re-runs
 * employment immediately, so a press can move somebody at a different building —
 * fill a vacancy, or take a specialist back — and a panel that only updated the
 * row under the thumb would be showing a settlement that no longer exists. Two
 * dozen rows is nothing to rebuild next to a paused simulation.
 */

import type { GameContext } from '@/game/Game';
import type { I18n } from '@/ui/i18n/I18n';
import type { MessageKey } from '@/ui/i18n/messages';
import { buildLabour, type LabourPost, type LabourView } from './labourModel';

export class Labour {
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
    this.root = requireElement(root, '[data-ui="labour"]');
    this.title = requireElement(root, '[data-ui="labour-title"]');
    this.body = requireElement(root, '[data-ui="labour-body"]');
    this.closeButton = requireElement(root, '[data-ui="labour-close"]') as HTMLButtonElement;

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
    const view = buildLabour(this.context.simulation, t);

    this.title.textContent = t('labour.title');
    this.body.replaceChildren(
      this.renderSummary(view),
      ...(view.posts.length === 0
        ? [notice(t('labour.none'))]
        : view.posts.map((post) => this.renderPost(post))),
    );
  }

  private renderSummary(view: LabourView): HTMLElement {
    const t = (key: MessageKey): string => this.i18n.t(key);
    const section = document.createElement('section');
    section.className = 'roster__summary';

    const counts: [string, string, boolean][] = [
      [t('labour.labourers'), String(view.summary.labourers), false],
      [t('labour.employed'), String(view.summary.employed), false],
      [t('labour.workforce'), String(view.summary.workforce), false],
      [t('labour.vacancies'), String(view.summary.vacancies), view.summary.vacancies > 0],
    ];

    for (const [label, value, warn] of counts) {
      const item = document.createElement('div');
      item.className = 'roster__stat';
      const name = document.createElement('span');
      name.className = 'roster__stat-label';
      name.textContent = label;
      const figure = document.createElement('span');
      figure.className = warn ? 'roster__stat-value is-short' : 'roster__stat-value';
      figure.textContent = value;
      item.append(name, figure);
      section.append(item);
    }

    const note = document.createElement('p');
    note.className = 'roster__note';
    note.textContent = t('labour.note');
    section.append(note);

    return section;
  }

  private renderPost(post: LabourPost): HTMLElement {
    const t = (key: MessageKey): string => this.i18n.t(key);
    const row = document.createElement('article');
    row.className = 'labour__post';

    const identity = document.createElement('div');
    identity.className = 'labour__identity';

    const name = document.createElement('span');
    name.className = 'labour__name';
    name.textContent = post.name;
    identity.append(name);

    // Who is actually there, and what they are worth at it. A post asking for
    // three and holding one says so here rather than in the quota.
    const staff = document.createElement('span');
    staff.className = post.short ? 'labour__staff is-short' : 'labour__staff';
    staff.textContent =
      post.workers.length === 0
        ? t('labour.nobody')
        : post.workers
            .map((worker) => (worker.level ? `${worker.name} (${worker.level})` : worker.name))
            .join(' · ');
    identity.append(staff);

    row.append(identity);

    const control = document.createElement('div');
    control.className = 'labour__control';
    control.append(
      this.stepper(post, -1, t('labour.fewer')),
      count(`${post.staffed}/${post.desired}`, post.short),
      this.stepper(post, 1, t('labour.more')),
    );

    const slots = document.createElement('span');
    slots.className = 'labour__slots';
    slots.textContent = `${post.slots} ${t(post.slots === 1 ? 'labour.slots.one' : 'labour.slots.many')}`;

    const stack = document.createElement('div');
    stack.className = 'labour__controls';
    stack.append(control, slots);
    row.append(stack);

    return row;
  }

  private stepper(post: LabourPost, delta: number, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'labour__step';
    button.textContent = delta > 0 ? '+' : '–';
    button.setAttribute('aria-label', `${label}: ${post.name}`);
    button.disabled = delta > 0 ? !post.canAdd : !post.canRemove;
    button.addEventListener('click', () => {
      if (this.context.adjustWorkersAt(post.buildingId, delta)) {
        // The whole page: one press can move somebody at another building.
        this.render();
      }
    });
    return button;
  }
}

function count(text: string, short: boolean): HTMLElement {
  const element = document.createElement('span');
  element.className = short ? 'labour__count is-short' : 'labour__count';
  element.textContent = text;
  return element;
}

function notice(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'roster__note';
  element.textContent = text;
  return element;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Labour panel is missing a required element: ${selector}`);
  }
  return element;
}
