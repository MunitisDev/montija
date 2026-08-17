/**
 * The HUD.
 *
 * Deliberately plain DOM: the overlay is HTML/CSS so it can use safe-area
 * insets, scale text properly on tablets and stay accessible, while the world
 * itself stays entirely inside the WebGL canvas.
 *
 * Status: speed controls, the tile panel and the resource readouts are wired.
 * Everything it shows is now live.
 *
 * The resource numbers are a **cached summary** of what the storage yards hold,
 * never the authority. A small `+n` marks units still lying in the field.
 */

import { buildingDefinition, type BuildingId } from '@/data/buildings';
import type { ResourceId } from '@/data/resources';

/**
 * The readouts that stay on the strip.
 *
 * Everything else lives in the drawer a tap below — see `StockDrawer`. Nine
 * numbers across a phone held upright is two lines of world given up to figures
 * a player checks occasionally, and the list only grows as the settlement
 * learns to make more.
 *
 * These four are the ones a settlement lives or dies by from day one, so they
 * are always there and a zero against any of them is information rather than
 * clutter.
 */
const STRIP_RESOURCES: readonly ResourceId[] = ['food', 'logs', 'firewood', 'stone'];
import type { GameContext } from '@/game/Game';
import { hidesGroundPanel } from '@/game/selection';
import { buildEndGame, type EndGameStat } from '@/ui/endgame/endGameModel';
import { cardsFor, type PersonCard } from './cardModel';
import { perSeason } from '@/ui/format/rates';
import { productionSummary, type ProductionRate } from './productionModel';
import type { SimulationSnapshot } from '@/simulation/Simulation';
import { SIMULATION_SPEEDS, type SimulationSpeed } from '@/simulation/SimulationClock';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { I18n } from '@/ui/i18n/I18n';
import type { MessageKey } from '@/ui/i18n/messages';

/** Elements the HUD binds to, looked up once. */
interface HudElements {
  readonly population: HTMLElement;
  /** Only the strip's few — the rest of the stores belong to the drawer. */
  readonly resources: ReadonlyMap<ResourceId, HTMLElement>;
  readonly selection: HTMLElement;
  readonly selectionTerrain: HTMLElement;
  readonly selectionCell: HTMLElement;
  readonly selectionFlags: HTMLElement;
  readonly selectionAction: HTMLButtonElement;
  readonly selectionRoad: HTMLButtonElement;
  readonly season: HTMLElement;
  readonly temperature: HTMLElement;
  readonly advice: HTMLElement;
  readonly events: HTMLElement;
  readonly building: HTMLElement;
  readonly buildingName: HTMLElement;
  readonly buildingState: HTMLElement;
  readonly buildingDetail: HTMLElement;
  readonly buildingCards: HTMLElement;
  readonly workerControl: HTMLElement;
  readonly workerCount: HTMLElement;
  readonly workerLabel: HTMLElement;
  readonly demolish: HTMLButtonElement;
  readonly tradeControl: HTMLElement;
  readonly tradeSell: HTMLButtonElement;
  readonly tradeBuy: HTMLButtonElement;
  readonly workerFewer: HTMLButtonElement;
  readonly workerMore: HTMLButtonElement;
  readonly failure: HTMLElement;
  readonly failureSurvived: HTMLElement;
  readonly failureStats: HTMLElement;
  readonly failureCauses: HTMLElement;
  readonly failureRollTitle: HTMLElement;
  readonly failureRoll: HTMLElement;
  readonly failureIll: HTMLElement;
  readonly failureRestart: HTMLButtonElement;
  readonly speedButton: HTMLButtonElement;
  readonly speedLabel: HTMLElement;
}

export class Hud {
  private readonly context: GameContext;
  private readonly i18n: I18n;
  private readonly root: HTMLElement;
  private renderedLanguageVersion = -1;
  private readonly elements: HudElements;
  private lastRenderedSpeed: SimulationSpeed | null = null;
  private lastRenderedPopulation = -1;
  private lastRenderedSelection = -1;
  /** Stored totals last written to the DOM, so unchanged values are skipped. */
  private readonly lastRenderedTotals = new Map<ResourceId, number>();
  /** Loose totals last written, tracked apart from stored ones. */
  private readonly lastRenderedLoose = new Map<ResourceId, number>();
  private lastRenderedAdvice: string | null | undefined;
  private lastRenderedFailure: string | null | undefined;
  /** The last day whose events were announced, so each is announced once. */
  private lastAnnouncedDay = -1;
  private lastRenderedSeason = '';
  private lastRenderedTemperature = Number.NaN;

  constructor(root: HTMLElement, context: GameContext, i18n: I18n) {
    this.context = context;
    this.i18n = i18n;
    this.root = root;
    this.elements = collectElements(root);
    this.bindSpeedButtons();
    this.bindSelectionAction();
    this.bindRoadAction();
    this.bindWorkerControl();
    this.elements.demolish.addEventListener('click', () => {
      this.context.toggleSelectedDemolition();
      this.update();
    });
    this.elements.tradeSell.addEventListener('click', () => {
      this.context.cycleTradeChoice('sell');
      this.update();
    });
    this.elements.tradeBuy.addEventListener('click', () => {
      this.context.cycleTradeChoice('buy');
      this.update();
    });
    this.elements.failureRestart.addEventListener('click', () => {
      this.context.startNewSettlement();
      // `undefined` means "not yet drawn". `null` is a real value here — it is
      // what "the settlement is fine" looks like — so using it as the reset
      // sentinel left the panel on screen over the new settlement.
      this.lastRenderedFailure = undefined;
      this.update();
    });
    this.update();
  }

  /**
   * Refreshes the readouts.
   *
   * Called once per animation frame but writes to the DOM only when a value
   * actually changed — layout thrash next to a WebGL canvas is expensive.
   */
  public update(): void {
    const snapshot = this.context.snapshot();
    const speed = this.context.clock.speed;

    // A language change invalidates every string, so force a full redraw
    // rather than trying to work out which labels happen to differ.
    if (this.i18n.changeVersion !== this.renderedLanguageVersion) {
      this.renderedLanguageVersion = this.i18n.changeVersion;
      this.applyStaticText();
      this.invalidateAll();
    }

    if (snapshot.villagerCount !== this.lastRenderedPopulation) {
      this.elements.population.textContent = String(snapshot.villagerCount);
      this.lastRenderedPopulation = snapshot.villagerCount;
    }

    // Population is read outside the resource loop below, so it needs its own
    // naming — otherwise it is the one icon with nothing to say for itself.
    const populationLabel = this.i18n.t('hud.population');
    const populationRow = this.elements.population.parentElement;
    if (populationRow && populationRow.title !== populationLabel) {
      populationRow.title = populationLabel;
    }

    // The HUD shows what the yards physically hold. Resources still lying on
    // the ground are excluded on purpose: felling a tree must not move the
    // counter until somebody has actually carried the logs in.
    for (const [resource, element] of this.elements.resources) {
      const stored = snapshot.stored[resource];
      const loose = snapshot.loose[resource];

      if (this.lastRenderedTotals.get(resource) !== stored) {
        element.textContent = String(stored);
        this.lastRenderedTotals.set(resource, stored);
      }

      // Tracked separately: the amount lying in the field changes on its own,
      // and tying it to the stored total left a stale "+n" on screen after the
      // last load had already been carried in.
      // The caption is hidden on very short screens, where five bare numbers
      // are otherwise a guessing game. The title survives that.
      const label = this.i18n.t(`hud.${resource}` as MessageKey);
      if (element.parentElement && element.parentElement.title !== label) {
        element.parentElement.title = label;
      }

      if (this.lastRenderedLoose.get(resource) !== loose) {
        element.dataset['loose'] = loose > 0 ? `+${loose}` : '';
        // Said in words as well as symbols: "Food 0 +50" is alarming until you
        // know the 50 is real and merely still in the field.
        element.title = loose > 0 ? `${label}: +${loose} ${this.i18n.t('hud.looseHint')}` : '';
        this.lastRenderedLoose.set(resource, loose);
      }
    }

    const seasonLabel = [
      this.i18n.t(`season.${snapshot.season}` as MessageKey),
      `${this.i18n.t('time.yearShort')}${snapshot.year}`,
      `${this.i18n.t('time.dayShort')}${snapshot.dayOfSeason}`,
    ].join(' · ');
    if (seasonLabel !== this.lastRenderedSeason) {
      this.elements.season.textContent = seasonLabel;
      this.lastRenderedSeason = seasonLabel;
    }

    if (snapshot.temperature !== this.lastRenderedTemperature) {
      this.elements.temperature.textContent = `${snapshot.temperature.toFixed(0)}°`;
      // Below freezing the settlement burns firewood, so the colour is a
      // warning rather than decoration.
      this.elements.temperature.classList.toggle('is-freezing', snapshot.temperature < 2);
      this.lastRenderedTemperature = snapshot.temperature;
    }

    if (speed !== this.lastRenderedSpeed) {
      this.renderSpeed(speed);
      this.lastRenderedSpeed = speed;
    }

    const advice = snapshot.advice;
    if (advice !== this.lastRenderedAdvice) {
      this.elements.advice.hidden = advice === null;
      if (advice) {
        const text = this.i18n.t(`warning.${advice}` as MessageKey);
        // The stalled-site warning is the one that has to name a noun: "work
        // has stopped" without saying *what for* sends the player looking.
        this.elements.advice.textContent =
          advice === 'siteStalled' && snapshot.stalledMaterial
            ? `${text} ${this.i18n.t(`hud.${snapshot.stalledMaterial}` as MessageKey)}`
            : text;
      }
      this.lastRenderedAdvice = advice;
    }

    this.announceEvents(snapshot);

    // The settlement is over. Said plainly, with the only action left.
    const failureKey = snapshot.hasFailed
      ? `${snapshot.year}-${snapshot.season}-${snapshot.dayOfSeason}`
      : null;
    if (failureKey !== this.lastRenderedFailure) {
      this.elements.failure.hidden = !snapshot.hasFailed;
      if (snapshot.hasFailed) {
        this.renderEndGame();
      }
      this.lastRenderedFailure = failureKey;
    }

    if (this.context.selectionVersion !== this.lastRenderedSelection) {
      this.renderSelection();
      this.lastRenderedSelection = this.context.selectionVersion;
    }
  }

  /**
   * Announces what happened overnight.
   *
   * The population moves for four different reasons and, until this existed,
   * the only sign of any of them was a number quietly changing in the corner —
   * so a settlement could gain two people or bury one and the player would have
   * no idea which had happened, or why.
   *
   * Once a day, and only for days that actually brought news.
   */
  private announceEvents(snapshot: SimulationSnapshot): void {
    const day = Math.floor(snapshot.tick / TICKS_PER_DAY);
    if (day === this.lastAnnouncedDay) {
      return;
    }
    // A restart winds the clock back; announcing the whole first day again is
    // better than going silent until the settlement catches up.
    const isFirstLook = this.lastAnnouncedDay < 0 || day < this.lastAnnouncedDay;
    this.lastAnnouncedDay = day;
    if (isFirstLook) {
      return;
    }

    const { population, lastDay } = snapshot;
    // Deaths of old age are counted separately from the ones the player caused
    // by running out of food or firewood, because only one of those is a
    // mistake and they should not read the same.
    const fromHardship = Math.max(0, lastDay.deaths);

    // A merchant arriving is the one event the player may want to act on
    // before it passes, so it is announced on the day it happens.
    if (snapshot.trade.merchantPresent && snapshot.trade.boughtAmount > 0) {
      this.announceOnce(
        `${this.i18n.t('event.traded')}: ${snapshot.trade.soldAmount} ${this.i18n.t(
          `hud.${snapshot.trade.sold ?? 'logs'}` as MessageKey,
        )} → ${snapshot.trade.boughtAmount} ${this.i18n.t(
          `hud.${snapshot.trade.bought ?? 'logs'}` as MessageKey,
        )}`,
      );
    } else if (snapshot.trade.merchantPresent) {
      this.announceOnce(this.i18n.t('event.merchant'));
    }

    this.announce('event.born', population.births);
    this.announce('event.arrived', population.arrivals);
    // Sickness costs the settlement a pair of hands for over a week, and there
    // is nothing on the map to see it by: the villager simply stops. Saying so
    // is the only way the player can connect the empty granary to the cause.
    this.announce('event.fellIll', snapshot.illness.fellIll);
    this.announce('event.recovered', snapshot.illness.recovered);
    this.announce('event.diedOfOldAge', population.deathsOfOldAge);
    this.announce('event.died', fromHardship);
  }

  /** Puts one already-worded line on the notice stack. */
  private announceOnce(text: string): void {
    const notice = document.createElement('div');
    notice.className = 'events__notice';
    notice.textContent = text;
    this.elements.events.append(notice);
    notice.addEventListener('animationend', () => notice.remove());
  }

  private announce(key: MessageKey, count: number): void {
    if (count <= 0) {
      return;
    }

    const notice = document.createElement('div');
    notice.className = 'events__notice';
    notice.textContent = count > 1 ? `${this.i18n.t(key)} (${count})` : this.i18n.t(key);
    if (key === 'event.died' || key === 'event.diedOfOldAge') {
      notice.classList.add('is-loss');
    }

    this.elements.events.append(notice);
    // Removed on the animation's own end rather than on a timer, so the two can
    // never disagree about how long a notice lasts.
    notice.addEventListener('animationend', () => notice.remove());
  }

  /**
   * Describes the building the player tapped.
   *
   * Until this existed a settlement builder let you raise a workshop and never
   * ask what it was doing — which is the half of the game that comes after
   * building it. The lines answer the questions a player actually has: is it
   * finished, what is it still waiting for, is anybody working it, what is
   * inside.
   */
  private renderBuildingPanel(): void {
    const building = this.context.selection?.building ?? null;
    this.elements.building.hidden = building === null;
    if (!building) {
      this.elements.workerControl.hidden = true;
      this.elements.demolish.hidden = true;
      this.elements.tradeControl.hidden = true;
      return;
    }

    // Only a trading post has anything to say about trade, and only once it
    // is finished — an unbuilt post cannot swap anything.
    const trading = building.buildingId === 'trading-post' && building.complete;
    this.elements.tradeControl.hidden = !trading;
    if (trading) {
      const order = this.context.tradeOrder;
      this.elements.tradeSell.textContent = this.tradeLabel(order.sell, 'trade.sellAuto');
      this.elements.tradeBuy.textContent = this.tradeLabel(order.buy, 'trade.buyAuto');
    }

    // Hidden on the founding yard, which has no Building behind it and is the
    // settlement's only store on day one — offering to demolish it is a trap.
    const demolishable = this.context.simulation.world.buildings.getById(building.id) !== null;
    this.elements.demolish.hidden = !demolishable;
    if (demolishable) {
      this.elements.demolish.textContent = this.i18n.t(
        building.demolitionOrdered
          ? 'action.cancelDemolition'
          : building.complete
            ? 'action.demolish'
            : 'action.cancelBuilding',
      );
      this.elements.demolish.classList.toggle('is-cancel', building.demolitionOrdered);
    }
    if (!building.complete) {
      this.elements.workerControl.hidden = true;
    }

    this.elements.buildingName.textContent = this.i18n.t(
      `building.${building.buildingId}` as MessageKey,
    );

    this.renderCards(building.complete ? building.id : null);

    if (!building.complete) {
      const percent = Math.round(building.progress * 100);
      // Said on the site as well as on the finished building: "is this worth
      // carrying stone across the map for?" is a question asked *before* it is
      // standing, not after.
      const promise = this.describeProduction(building.buildingId);
      this.elements.buildingState.textContent =
        `${this.i18n.t('building.underConstruction')} ${percent}%` +
        (promise ? ` · ${promise}` : '');
      // Materials are reported apart from progress, because "waiting for stone"
      // and "half built" are different problems with different answers.
      this.elements.buildingDetail.textContent =
        building.missingMaterials.length > 0
          ? `${this.i18n.t('building.waitingFor')}: ${this.describeAmounts(building.missingMaterials)}`
          : '';
      return;
    }

    // The quota, not the slots: what the player asked for is what they should
    // see next to the button that changes it. How many have actually turned up
    // is the first number, and the gap between them is the interesting part —
    // "2/3 wanted" says the settlement is short of hands.
    this.elements.workerControl.hidden = building.workerSlots === 0;
    if (building.workerSlots > 0) {
      this.elements.workerLabel.textContent = this.i18n.t('building.workers');
      this.elements.workerCount.textContent = `${building.workers}/${building.desiredWorkers}`;
      this.elements.workerFewer.disabled = building.desiredWorkers <= 0;
      this.elements.workerMore.disabled = building.desiredWorkers >= building.workerSlots;
    }

    // Staffing is not repeated in the state line: the control beside it already
    // says "Workers 1/2", and printing it twice in one panel reads as a bug.
    const state: string[] = [];
    if (building.housing > 0) {
      state.push(`${this.i18n.t('building.residents')} ${building.residents}/${building.housing}`);
    }
    // What it can make. The one thing a workshop is *for* was the one thing the
    // panel never said, so a player choosing between a Quarry and a Woodcutter
    // was comparing two rates neither of which was on screen.
    const rate = this.describeProduction(building.buildingId);
    if (rate) {
      state.push(rate);
    }
    this.elements.buildingState.textContent = state.join(' · ');

    // A workshop with nobody in it looks identical to a working one, and the
    // difference is the whole reason a settlement starves with a hut standing.
    if (building.workerSlots > 0 && building.workers === 0) {
      this.elements.buildingDetail.textContent = this.i18n.t('building.idleNoWorkers');
      return;
    }

    // A store says how full it is as well as what is in it: "holding 40 food" is
    // a number about the food, and the question a player has is about the room.
    const fill = this.storeFill(building.buildingId);
    const holding =
      building.contents.length > 0
        ? `${this.i18n.t('building.holding')} ${this.describeAmounts(building.contents)}`
        : '';
    this.elements.buildingDetail.textContent = [holding, fill].filter(Boolean).join(' · ');
  }

  /**
   * A building's ceiling, as one line, or `''` when it makes nothing.
   *
   * "At best 123 stone a season", and for anything that comes out of the ground
   * the season that figure belongs to — a Gatherer Hut's summer is forty per
   * cent better than its autumn and its winter is nothing at all, so quoting the
   * peak silently would be the panel overpromising.
   *
   * A season rather than a day because a day's worth of most of these is a
   * fraction, and "10.3 stone" is a number nobody can plan a winter with.
   */
  private describeProduction(buildingId: BuildingId): string {
    const summary = productionSummary(buildingId);
    if (summary.outputs.length === 0) {
      return '';
    }

    const outputs = this.describeRates(summary.outputs);
    const season = summary.peakSeason
      ? ` (${this.i18n.t(`season.${summary.peakSeason}` as MessageKey)})`
      : '';
    const line = `${this.i18n.t('building.atBest')} ${outputs} ${this.i18n.t('building.perSeason')}${season}`;

    if (summary.inputs.length === 0) {
      return line;
    }
    // A workshop that eats a resource is a decision about that resource too: a
    // Woodcutter at full tilt is forty-eight logs a season nobody else is
    // building with.
    return `${line}, ${this.i18n.t('building.consuming')} ${this.describeRates(summary.inputs)}`;
  }

  private describeRates(rates: readonly ProductionRate[]): string {
    return rates
      .map(
        (rate) => `${perSeason(rate.perDay)} ${this.i18n.t(`hud.${rate.resource}` as MessageKey)}`,
      )
      .join(' + ');
  }

  /** A side of the trade, or the word for letting the post decide. */
  private tradeLabel(resource: ResourceId | null, automatic: MessageKey): string {
    return resource === null
      ? this.i18n.t(automatic)
      : this.i18n.t(`hud.${resource}` as MessageKey);
  }

  private describeAmounts(amounts: readonly { resource: ResourceId; amount: number }[]): string {
    return amounts
      .map((entry) => `${entry.amount} ${this.i18n.t(`hud.${entry.resource}` as MessageKey)}`)
      .join(', ');
  }

  /**
   * Draws the closing page.
   *
   * Called once, when the settlement fails — the whole panel is rebuilt rather
   * than diffed, because it happens exactly as often as a settlement ends and
   * nothing on it will change afterwards.
   */
  private renderEndGame(): void {
    const report = buildEndGame(this.context.simulation, (key) => this.i18n.t(key));

    this.elements.failureSurvived.textContent = report.ended;
    fillFigures(this.elements.failureStats, report.stats);
    fillFigures(this.elements.failureCauses, report.causes);
    this.elements.failureRollTitle.textContent = report.rollTitle;
    this.elements.failureIll.textContent = report.illNote;

    const roll = this.elements.failureRoll;
    roll.replaceChildren();
    const years = this.i18n.t('end.years');
    for (const entry of report.roll) {
      const line = document.createElement('li');
      line.className = 'failure__entry';
      line.append(
        span('failure__who', entry.note ? `${entry.name} — ${entry.note}` : entry.name),
        span('failure__age', `${entry.age} ${years}`),
        span('failure__how', entry.cause),
        span('failure__when', entry.when),
      );
      roll.append(line);
    }
  }

  /**
   * The people under the panel: a card each.
   *
   * Rebuilt whenever the selection changes, which is a tap — not a frame. A
   * workshop holds at most a handful of them.
   */
  /**
   * How full this kind of store is, settlement-wide, or `''` for anything else.
   *
   * Across every store that takes the same goods rather than this one alone: a
   * player with three yards has one pool, and "this shed is 40% full" while the
   * others are brimming would be a true sentence pointing the wrong way.
   */
  private storeFill(buildingId: BuildingId): string {
    const definition = buildingDefinition(buildingId);
    const accepts = definition.storage?.accepts?.[0];
    if (!accepts) {
      return '';
    }
    const { used, capacity } = this.context.simulation.storages.fill(accepts);
    if (capacity <= 0) {
      return '';
    }
    return `${Math.round((used / capacity) * 100)}% ${this.i18n.t('building.full')}`;
  }

  private renderCards(buildingId: number | null): void {
    const cards = buildingId === null ? [] : cardsFor(this.context.simulation, buildingId);
    this.elements.buildingCards.hidden = cards.length === 0;
    if (cards.length === 0) {
      this.elements.buildingCards.replaceChildren();
      return;
    }

    this.elements.buildingCards.replaceChildren(
      ...cards.map((person) => {
        const card = document.createElement('div');
        card.className = person.isIll ? 'card is-ill' : 'card';

        const portrait = document.createElement('span');
        portrait.className = 'card__portrait';
        // The disc takes the colour and the silhouette is punched out of it, so
        // one property carries a villager's whole identity.
        portrait.style.color = person.colour;
        portrait.innerHTML =
          `<svg class="card__face" aria-hidden="true" focusable="false">` +
          `<use href="#portrait-${person.portrait}" /></svg>`;

        const who = document.createElement('span');
        who.className = 'card__who';
        who.append(
          span('card__name', person.name),
          span('card__detail', this.describePerson(person)),
        );

        card.append(portrait, who);
        return card;
      }),
    );
  }

  /**
   * The line under a name: age, which of the two, and what they know.
   *
   * The trade is named only once somebody has actually reached a level at it —
   * a first-day forager is not an apprentice, and saying so would make the whole
   * ladder meaningless.
   */
  private describePerson(person: PersonCard): string {
    // A child is a girl or a boy and an elder is an elder — the Spanish needs
    // the distinction anyway, and "woman, 8" would be wrong in any language.
    const age =
      person.portrait === 'child' ? '.child' : person.portrait === 'elder' ? '.elder' : '';
    const parts = [
      `${person.age} ${this.i18n.t('roster.years')}`,
      this.i18n.t(`sex.${person.sex}${age}` as MessageKey),
    ];
    if (person.trade !== null) {
      parts.push(this.i18n.t(`skill.${person.level}` as MessageKey));
    }
    if (person.isIll) {
      parts.push(this.i18n.t('villager.ill'));
    }
    return parts.join(' · ');
  }

  private renderSelection(): void {
    this.renderBuildingPanel();
    const selection = this.context.selection;
    if (!selection) {
      this.elements.selection.hidden = true;
      return;
    }

    // A building speaks for itself through its own panel. This one used to sit
    // underneath it still describing the ground beneath the floorboards —
    // "grass", a cell reference, and a *Lay road* button for a cell with a
    // workshop standing on it. All of it unanswerable, so none of it is shown.
    if (hidesGroundPanel(selection)) {
      this.elements.selection.hidden = true;
      return;
    }

    this.elements.selection.hidden = false;

    // The action depends only on there being a tree, never on which info line
    // is showing. Tying the two together made a tree with someone standing
    // beside it impossible to designate.
    const actionable = selection.treeId !== null || selection.isStoneDeposit;
    this.renderSelectionAction(actionable, selection.designated, selection.treeId !== null);
    this.renderRoadAction(selection);

    // A tapped villager is what the player meant; the tile is the fallback.
    if (selection.villager) {
      const villager = selection.villager;
      this.elements.selectionTerrain.textContent = villager.name;
      this.elements.selectionCell.textContent = `${this.i18n.t('villager.age')} ${villager.age}`;
      // Trade first, then what they are doing. "Gatherer, hauling" is a whole
      // sentence about a person; "hauling" on its own is not.
      const trade = villager.employer
        ? this.i18n.t(`building.${villager.employer}` as MessageKey)
        : this.i18n.t('villager.labourer');
      this.elements.selectionFlags.textContent = `${trade} · ${this.i18n.t(
        `villager.${villager.activity}` as MessageKey,
      )}`;
      return;
    }

    if (selection.treeId !== null) {
      this.elements.selectionTerrain.textContent = this.i18n.t('terrain.tree');
      this.elements.selectionCell.textContent = `${selection.cell.gx}, ${selection.cell.gy}`;
      this.elements.selectionFlags.textContent = selection.designated
        ? this.i18n.t('status.markedForFelling')
        : '';
      return;
    }

    if (selection.isStoneDeposit) {
      this.elements.selectionTerrain.textContent = this.i18n.t('terrain.stoneDeposit');
      this.elements.selectionCell.textContent = `${selection.cell.gx}, ${selection.cell.gy}`;
      this.elements.selectionFlags.textContent = selection.designated
        ? this.i18n.t('status.markedForMining')
        : '';
      return;
    }

    this.elements.selectionTerrain.textContent = this.i18n.t(
      `terrain.${selection.terrain}` as MessageKey,
    );
    this.elements.selectionCell.textContent = `${selection.cell.gx}, ${selection.cell.gy}`;

    const flags: string[] = [];
    if (selection.hasRoad) {
      flags.push(this.i18n.t('status.road'));
    } else if (selection.roadDesignated) {
      flags.push(this.i18n.t('status.roadOrdered'));
    }
    if (!selection.walkable) {
      flags.push(this.i18n.t('terrain.impassable'));
    }
    if (!selection.buildable) {
      flags.push(this.i18n.t('terrain.cannotBuild'));
    }
    this.elements.selectionFlags.textContent = flags.join(' · ');
  }

  private bindSelectionAction(): void {
    this.elements.selectionAction.addEventListener('click', () => {
      const selection = this.context.selection;
      if (!selection || (selection.treeId === null && !selection.isStoneDeposit)) {
        return;
      }

      if (selection.designated) {
        this.context.cancelSelectedDesignation();
      } else {
        this.context.designateSelectedTree();
      }
      this.update();
    });
  }

  private bindWorkerControl(): void {
    this.elements.workerFewer.addEventListener('click', () => {
      this.context.adjustSelectedWorkers(-1);
      this.update();
    });
    this.elements.workerMore.addEventListener('click', () => {
      this.context.adjustSelectedWorkers(1);
      this.update();
    });
  }

  private bindRoadAction(): void {
    this.elements.selectionRoad.addEventListener('click', () => {
      this.context.toggleSelectedRoad();
      this.update();
    });
  }

  /**
   * The road button, which says what it will do rather than what the cell is.
   *
   * Hidden entirely on cells that cannot take one — water, rock, a standing
   * tree — because a permanently disabled button on a bottom bar this small
   * costs more room than it earns.
   */
  private renderRoadAction(selection: {
    hasRoad: boolean;
    roadDesignated: boolean;
    canPave: boolean;
  }): void {
    const available = selection.hasRoad || selection.roadDesignated || selection.canPave;
    this.elements.selectionRoad.hidden = !available;
    if (!available) {
      return;
    }

    const undoing = selection.hasRoad || selection.roadDesignated;
    this.elements.selectionRoad.textContent = this.i18n.t(
      selection.hasRoad
        ? 'action.liftRoad'
        : selection.roadDesignated
          ? 'action.cancel'
          : 'action.pave',
    );
    this.elements.selectionRoad.classList.toggle('is-cancel', undoing);
  }

  private renderSelectionAction(actionable: boolean, designated: boolean, isTree: boolean): void {
    this.elements.selectionAction.hidden = !actionable;
    if (!actionable) {
      return;
    }
    const verb = this.i18n.t(isTree ? 'action.fell' : 'action.mine');
    this.elements.selectionAction.textContent = designated ? this.i18n.t('action.cancel') : verb;
    this.elements.selectionAction.classList.toggle('is-cancel', designated);
  }

  private renderSpeed(speed: SimulationSpeed): void {
    // "II" for a stopped clock, because a pause glyph is the one control symbol
    // that needs no word in any language.
    this.elements.speedLabel.textContent = speed === 0 ? 'II' : `${speed}x`;
    this.elements.speedButton.classList.toggle('is-paused', speed === 0);
    this.elements.speedButton.setAttribute('aria-pressed', String(speed === 0));
  }

  /**
   * Reports that the game went full screen, so the layout can respond.
   *
   * The button itself lives in the settings sheet now; the HUD only needs to
   * know, because the stylesheet gives full screen a little more room.
   */
  public setFullscreen(active: boolean): void {
    this.root.classList.toggle('is-fullscreen', active);
  }

  /** Writes the labels that never change except with the language. */
  private applyStaticText(): void {
    this.elements.failureRestart.textContent = this.i18n.t('failure.restart');
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = element.dataset['i18n'] as MessageKey | undefined;
      if (key) {
        element.textContent = this.i18n.t(key);
      }
    }
  }

  /** Forces every cached readout to redraw. */
  private invalidateAll(): void {
    this.lastRenderedPopulation = -1;
    this.lastRenderedSelection = -1;
    this.lastRenderedSpeed = null;
    this.lastRenderedSeason = '';
    this.lastRenderedTemperature = Number.NaN;
    this.lastRenderedAdvice = undefined;
    this.lastRenderedFailure = undefined;
    this.lastRenderedTotals.clear();
    this.lastRenderedLoose.clear();
  }

  /**
   * One button for the clock, cycling pause, 1x, 2x, 4x and round again.
   *
   * Four buttons for four speeds took a corner of the bottom bar to say what
   * two characters say. The cost is real and worth naming: from 1x it is three
   * taps back to pause, where before it was one. Pause sits *after* 4x in the
   * cycle rather than before 1x, so the speed a player is most likely to want
   * stopping — the fast one they left running — is one tap from stopped.
   */
  private bindSpeedButtons(): void {
    this.elements.speedButton.addEventListener('click', () => {
      const current = SIMULATION_SPEEDS.indexOf(this.context.clock.speed);
      const next = SIMULATION_SPEEDS[(current + 1) % SIMULATION_SPEEDS.length];
      if (next !== undefined) {
        this.context.clock.setSpeed(next);
        this.update();
      }
    });
  }
}

function collectElements(root: HTMLElement): HudElements {
  return {
    population: requireElement(root, '[data-hud="population"]'),
    resources: new Map(
      STRIP_RESOURCES.map((resource) => [
        resource,
        requireElement(root, `[data-hud="${resource}"]`),
      ]),
    ),
    selection: requireElement(root, '[data-hud="selection"]'),
    selectionTerrain: requireElement(root, '[data-hud="selection-terrain"]'),
    selectionCell: requireElement(root, '[data-hud="selection-cell"]'),
    selectionFlags: requireElement(root, '[data-hud="selection-flags"]'),
    selectionAction: requireElement(root, '[data-hud="selection-action"]') as HTMLButtonElement,
    selectionRoad: requireElement(root, '[data-hud="selection-road"]') as HTMLButtonElement,
    season: requireElement(root, '[data-hud="season"]'),
    temperature: requireElement(root, '[data-hud="temperature"]'),
    advice: requireElement(root, '[data-hud="advice"]'),
    events: requireElement(root, '[data-hud="events"]'),
    building: requireElement(root, '[data-hud="building"]'),
    buildingName: requireElement(root, '[data-hud="building-name"]'),
    buildingState: requireElement(root, '[data-hud="building-state"]'),
    buildingDetail: requireElement(root, '[data-hud="building-detail"]'),
    buildingCards: requireElement(root, '[data-hud="building-cards"]'),
    workerControl: requireElement(root, '[data-hud="worker-control"]'),
    workerCount: requireElement(root, '[data-hud="worker-count"]'),
    workerLabel: requireElement(root, '[data-hud="worker-label"]'),
    demolish: requireElement(root, '[data-hud="demolish"]') as HTMLButtonElement,
    tradeControl: requireElement(root, '[data-hud="trade-control"]'),
    tradeSell: requireElement(root, '[data-hud="trade-sell"]') as HTMLButtonElement,
    tradeBuy: requireElement(root, '[data-hud="trade-buy"]') as HTMLButtonElement,
    workerFewer: requireElement(root, '[data-hud="worker-fewer"]') as HTMLButtonElement,
    workerMore: requireElement(root, '[data-hud="worker-more"]') as HTMLButtonElement,
    failure: requireElement(root, '[data-hud="failure"]'),
    failureSurvived: requireElement(root, '[data-hud="failure-survived"]'),
    failureStats: requireElement(root, '[data-hud="failure-stats"]'),
    failureCauses: requireElement(root, '[data-hud="failure-causes"]'),
    failureRollTitle: requireElement(root, '[data-hud="failure-roll-title"]'),
    failureRoll: requireElement(root, '[data-hud="failure-roll"]'),
    failureIll: requireElement(root, '[data-hud="failure-ill"]'),
    failureRestart: requireElement(root, '[data-hud="failure-restart"]') as HTMLButtonElement,
    speedButton: requireElement(root, '[data-ui="speed-cycle"]') as HTMLButtonElement,
    speedLabel: requireElement(root, '[data-hud="speed-label"]'),
  };
}

/** Writes a definition list of labelled figures, replacing whatever was there. */
function fillFigures(list: HTMLElement, stats: readonly EndGameStat[]): void {
  list.replaceChildren();
  for (const stat of stats) {
    const term = document.createElement('dt');
    term.textContent = stat.label;
    const value = document.createElement('dd');
    value.textContent = stat.value;
    list.append(term, value);
  }
}

function span(className: string, text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`HUD is missing a required element: ${selector}`);
  }
  return element;
}
