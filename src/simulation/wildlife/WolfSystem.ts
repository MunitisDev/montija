/**
 * Wolves, which are the wood answering back — and now the only thing in this game
 * that walks onto the map from outside it.
 *
 * **The rule this file is written around is the fire system's rule.** A pack is
 * never bad luck: it comes in the season the wood has nothing left in it, it goes
 * for whatever the settlement made easy, and everything it can take is something
 * the player left where it could be taken.
 *
 * - **When** is the hungry half of the year. Nothing comes down in spring or
 *   summer, so a settlement's first two seasons are its own business and the
 *   threat arrives exactly when the player is already busy being afraid of the
 *   cold.
 * - **Where from** is the trees. They come out of cover, and they will not go
 *   more than {@link WOLF_REACH} cells from it, so **ground the settlement has
 *   cleared is ground a pack will not cross** — the same axes the player is
 *   already swinging, doing a second job.
 * - **What they want** is, in order: **somebody caught outside**, and failing that
 *   **food lying in the open**. Those are the two mistakes the game has been
 *   asking the player not to make since the first winter.
 * - **What stops them** is a **wall**, gates included: a gate is barred the moment
 *   the alarm goes up. Timber they will chew through, given long enough. Stone
 *   they will not, and they go home.
 *
 * **Nothing comes down in the settlement's first year**, and that is a tuning
 * decision stated as a rule rather than hidden in a number. The first winter is
 * this game's stated objective and every figure in it has been measured against
 * ten people with no walls and no spare timber; measured *with* wolves in that
 * first year, the tutorial lost two worlds in twelve.
 *
 * ## Why this is a tick system now
 *
 * It used to be a calculation at the day boundary: a pack "came down", a heap lost
 * fifteen turnips, and on a bad night somebody was gone — none of it visible, none
 * of it happening anywhere on the map. The rules were right and there was nothing
 * to watch, so there was nothing to *do*. A pack now arrives, crosses the ground,
 * meets whoever comes out to meet it, and either eats or dies. The arrival is still
 * the same seeded roll it always was, once a day; everything after it is the world
 * running.
 *
 * Deterministic throughout: the only dice are the arrival, the pack's size and
 * where it comes out of the trees. The fight itself has none at all — see
 * `Combat.ts`.
 */

import { isFood, type ResourceId } from '@/data/resources';
import { WORKING_AGE, RETIREMENT_AGE } from '@/data/population';
import type { GridPoint } from '@/shared/types/geometry';
import type { ResourcePile } from '@/simulation/resources/ResourcePile';
import type { Season } from '@/simulation/seasons/SeasonClock';
import type { Villager } from '@/simulation/villagers/Villager';
import type { World } from '@/simulation/world/World';
import { Wolf } from './Wolf';
import { WOLF_VIGOUR } from './Combat';

/**
 * Chance a pack comes down, per day, by season.
 *
 * Nothing at all while the wood is feeding them. Autumn is the warning and winter
 * is the problem, which lines the threat up with the season the whole game is
 * about: a little over one pack a year, and both of the seasons it can happen in
 * are seasons the player is already short of hands.
 */
export const PACK_CHANCE: Readonly<Record<Season, number>> = {
  spring: 0,
  summer: 0,
  autumn: 0.03,
  winter: 0.08,
};

/**
 * How far from the trees a pack will come, in cells.
 *
 * Six, which is far enough to reach a yard built at the edge of a clearing and
 * not far enough to reach the middle of a settlement that has cleared its ground.
 */
export const WOLF_REACH = 6;

/** The first settlement year a pack will come down in. See the header. */
export const FIRST_WOLF_YEAR = 2;

/** How many wolves come, at least and at most. */
export const PACK_MIN = 2;
export const PACK_MAX = 4;

/**
 * How far a wolf will look for somebody to go for.
 *
 * Eight cells: further than a villager can be surprised from and short enough
 * that a pack at the treeline is not a threat to the far side of the settlement.
 */
export const HUNT_RADIUS = 8;

/** How much food one wolf carries off before it has had enough. */
export const PACK_APPETITE = 15;

/** How many heaps one pack will work through. */
export const PACK_HEAPS = 3;

/**
 * How fast a wolf moves, in cells a second.
 *
 * A shade quicker than a villager's 1.6, which is the honest reading and also the
 * thing that makes the alarm matter: you cannot outrun them, so the answer is to
 * be indoors or to be several.
 */
export const WOLF_SPEED = 1.9;

/**
 * How long a pack will keep at a settlement that gives it nothing.
 *
 * Two minutes of play at 1x. After that they have had enough of a place with
 * everything behind stone and go back to the wood, which is what makes a
 * well-walled settlement *boring* to them rather than merely safe.
 */
export const PACK_PATIENCE = 1200;

/** What happened this tick. */
export interface WolfTickReport {
  /** Food carried off, heap by heap. */
  readonly stolen: readonly {
    readonly resource: ResourceId;
    readonly amount: number;
    readonly cell: GridPoint;
  }[];
  /** Cells of wall a pack broke open this tick. */
  readonly breached: readonly GridPoint[];
  /** Pairings for this tick's fighting, for `Combat.exchangeBlows`. */
  readonly biting: readonly { readonly villagerId: number; readonly wolfId: number }[];
}

export const NO_WOLF_TICK: WolfTickReport = { stolen: [], breached: [], biting: [] };

/** What the settlement's people should be doing while a pack is about. */
export type DefenceOrder = 'shelter' | 'muster';

export class WolfSystem {
  private readonly pack: Wolf[] = [];
  private nextId = 1;
  private patience = 0;
  /** Set once anybody has seen them, and cleared when the pack is gone. */
  private seen = false;

  public get all(): readonly Wolf[] {
    return this.pack;
  }

  public get count(): number {
    return this.pack.length;
  }

  /**
   * `true` once the settlement knows.
   *
   * **One villager seeing them tells everybody**, which is what the player asked
   * for and what a shout across a valley actually does. It stays up until the last
   * wolf is dead or gone, so nobody goes back to the fields while one is still
   * standing in them.
   */
  public get isAlarmed(): boolean {
    return this.seen && this.pack.length > 0;
  }

  /**
   * What this villager should do while the alarm is up.
   *
   * Children and elders shelter; everybody of working age goes out. Nobody is
   * *ordered* to fight in the sense of a job — this is the one thing in the game
   * the settlement does without the player, because a village that stood in the
   * fields watching wolves eat its winter would be a village nobody believes in.
   */
  public orderFor(villager: Villager): DefenceOrder | null {
    if (!this.isAlarmed) {
      return null;
    }
    if (villager.age < WORKING_AGE || villager.age >= RETIREMENT_AGE) {
      return 'shelter';
    }
    return 'muster';
  }

  /** The wolf nearest a cell, for a villager to walk at. */
  public nearestTo(cell: GridPoint): Wolf | null {
    let best: Wolf | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const wolf of this.pack) {
      const distance = chebyshev(wolf.cell, cell);
      if (
        distance < bestDistance ||
        (distance === bestDistance && best !== null && wolf.id < best.id)
      ) {
        best = wolf;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Rolls for tonight's pack, and brings it out of the trees if it comes.
   *
   * Called once a day. The dice are not even touched in a quiet season or in the
   * founding year, so a settlement's first year is bit-for-bit the year it always
   * was and every measurement taken before wolves existed still describes it.
   *
   * @returns `true` when a pack arrived
   */
  public considerRaid(options: {
    world: World;
    random: { next(): number };
    season: Season;
    year: number;
  }): boolean {
    const { world, random, season, year } = options;
    if (this.pack.length > 0 || year < FIRST_WOLF_YEAR || PACK_CHANCE[season] === 0) {
      return false;
    }
    if (random.next() >= PACK_CHANCE[season]) {
      return false;
    }

    // Out of the trees nearest something worth coming for: a heap in the open if
    // there is one, otherwise the settlement itself.
    const draw = exposedFood(world);
    const aim = draw[0]?.cell ?? world.landfallCell;
    const cover = coverNear(world, aim);
    if (cover.length === 0) {
      return false;
    }

    const size = PACK_MIN + Math.floor(random.next() * (PACK_MAX - PACK_MIN + 1));
    for (let index = 0; index < size; index += 1) {
      const at = cover[index % cover.length];
      if (at) {
        this.pack.push(new Wolf(this.nextId, at, WOLF_VIGOUR));
        this.nextId += 1;
      }
    }
    this.patience = PACK_PATIENCE;
    this.seen = false;
    return true;
  }

  /**
   * One tick of the pack: look, move, bite, eat, leave.
   *
   * Returns what the caller has to act on — the food that went, the wall that
   * broke, and who is biting whom. Deaths are the simulation's business, because
   * a death means a household, a job and a roll of the dead.
   */
  public update(options: {
    world: World;
    villagers: readonly Villager[];
    tickSeconds: number;
  }): WolfTickReport {
    const { world, villagers, tickSeconds } = options;
    if (this.pack.length === 0) {
      this.seen = false;
      return NO_WOLF_TICK;
    }

    this.patience -= 1;
    const stolen: { resource: ResourceId; amount: number; cell: GridPoint }[] = [];
    const breached: GridPoint[] = [];
    const biting: { villagerId: number; wolfId: number }[] = [];

    // **Seen once is known everywhere.** Anybody who is out and looking counts,
    // which is why a settlement whose people are all indoors can be raided
    // without ever raising the alarm — and lose the food it left outside.
    if (!this.seen) {
      this.seen = this.pack.some((wolf) =>
        villagers.some(
          (villager) =>
            villager.activity !== 'sheltering' &&
            chebyshev(villager.cell, wolf.cell) <= HUNT_RADIUS,
        ),
      );
    }

    const heaps = exposedFood(world);

    for (const wolf of this.pack) {
      wolf.previousPosition = wolf.position;

      if (this.patience <= 0 || wolf.eaten >= PACK_APPETITE) {
        wolf.state = 'leaving';
      }

      if (wolf.state === 'leaving') {
        this.retreat(world, wolf, tickSeconds);
        continue;
      }

      // **A villager in reach comes first.** Not because a wolf prefers people to
      // turnips, but because the people are what walk *at them* the moment the
      // alarm goes up: whoever came out to fight is who they fight.
      const quarry = nearestQuarry(villagers, wolf);
      if (quarry) {
        const distance = chebyshev(quarry.cell, wolf.cell);
        if (distance <= 1) {
          wolf.state = 'fighting';
          wolf.quarryId = quarry.id;
          biting.push({ villagerId: quarry.id, wolfId: wolf.id });
          continue;
        }
        wolf.state = 'closing';
        wolf.quarryId = null;
        this.step(world, wolf, quarry.cell, tickSeconds, breached);
        continue;
      }

      wolf.quarryId = null;
      const heap = heaps.find((pile) => !pile.isEmpty) ?? null;
      if (!heap) {
        // **Nothing in reach yet, so they come on.** This is what a pack that has
        // come down actually does, and getting it wrong the other way was
        // instructive: sending them home the moment there was nothing to hand
        // meant they arrived in the trees and vanished in the same tick, and the
        // player never saw a wolf at all. They prowl toward the settlement until
        // their patience runs out.
        wolf.state = 'closing';
        this.step(world, wolf, world.landfallCell, tickSeconds, breached);
        continue;
      }

      if (chebyshev(heap.cell, wolf.cell) === 0) {
        const appetite = Math.min(PACK_APPETITE - wolf.eaten, heap.amount);
        const amount = heap.inventory.remove(heap.resource, appetite);
        wolf.eaten += amount;
        if (amount > 0) {
          stolen.push({ resource: heap.resource, amount, cell: { ...heap.cell } });
        }
        world.piles.removeIfEmpty(heap.id);
        continue;
      }

      wolf.state = 'closing';
      this.step(world, wolf, heap.cell, tickSeconds, breached);
    }

    return { stolen, breached, biting };
  }

  /** Takes the dead off the map. Called by the simulation once it has buried them. */
  public remove(ids: readonly number[]): void {
    for (const id of ids) {
      const index = this.pack.findIndex((wolf) => wolf.id === id);
      if (index >= 0) {
        this.pack.splice(index, 1);
      }
    }
    if (this.pack.length === 0) {
      this.seen = false;
    }
  }

  /** Everything the save needs, and nothing it does not. */
  public state(): {
    wolves: { id: number; wx: number; wy: number; vigour: number; eaten: number; state: string }[];
    nextId: number;
    patience: number;
    seen: boolean;
  } {
    return {
      wolves: this.pack.map((wolf) => ({
        id: wolf.id,
        wx: wolf.position.wx,
        wy: wolf.position.wy,
        vigour: wolf.vigour,
        eaten: wolf.eaten,
        state: wolf.state,
      })),
      nextId: this.nextId,
      patience: this.patience,
      seen: this.seen,
    };
  }

  public restore(saved: {
    wolves?: readonly {
      id: number;
      wx: number;
      wy: number;
      vigour: number;
      eaten?: number;
      state?: string;
    }[];
    nextId?: number;
    patience?: number;
    seen?: boolean;
  }): void {
    this.pack.length = 0;
    for (const entry of saved.wolves ?? []) {
      const wolf = new Wolf(
        entry.id,
        { gx: Math.floor(entry.wx), gy: Math.floor(entry.wy) },
        entry.vigour,
      );
      wolf.position = { wx: entry.wx, wy: entry.wy };
      wolf.previousPosition = wolf.position;
      wolf.eaten = entry.eaten ?? 0;
      wolf.state = (entry.state as Wolf['state']) ?? 'closing';
      this.pack.push(wolf);
    }
    this.nextId = saved.nextId ?? this.pack.length + 1;
    this.patience = saved.patience ?? PACK_PATIENCE;
    this.seen = saved.seen ?? false;
  }

  public clear(): void {
    this.pack.length = 0;
    this.nextId = 1;
    this.patience = 0;
    this.seen = false;
  }

  /**
   * One step toward a cell, or a mouthful of whatever is in the way.
   *
   * Greedy rather than A\*, and deliberately: a pack comes out of the trees at
   * something a few cells away, and a search would buy nothing but cost a
   * pathfinding request per wolf per tick. What it does instead is the thing an
   * animal does — head for it, and if there is a wall, work at the wall.
   */
  private step(
    world: World,
    wolf: Wolf,
    target: GridPoint,
    tickSeconds: number,
    breached: GridPoint[],
  ): void {
    const from = wolf.cell;
    let best: GridPoint | null = null;
    let bestDistance = chebyshev(from, target);
    let blocked: GridPoint | null = null;

    for (const [dx, dy] of STEPS) {
      const cell = { gx: from.gx + dx, gy: from.gy + dy };
      const distance = chebyshev(cell, target);
      if (distance >= bestDistance) {
        continue;
      }
      if (world.fences.hasAt(cell)) {
        // A wall, or a gate that is barred. The nearest one on the way is the one
        // they work at.
        if (blocked === null) {
          blocked = cell;
        }
        continue;
      }
      if (!world.navigation.isWalkable(cell.gx, cell.gy)) {
        continue;
      }
      // **They will not leave the cover behind them.** Six cells is as far into
      // the open as a pack will come, which is why a settlement that has cleared
      // its ground is a settlement they cannot reach the middle of. Checked on the
      // step rather than on the target, so they creep as far as the wood allows
      // and then hang about at the edge of it.
      if (!coverWithinReach(world, cell)) {
        continue;
      }
      best = cell;
      bestDistance = distance;
    }

    if (best === null) {
      // Nowhere better to stand. If a wall is what is in the way they work at it;
      // otherwise they wait where they are, which is what {@link PACK_PATIENCE} is
      // for — a pack that cannot reach anything eventually goes home.
      if (blocked !== null) {
        wolf.state = 'gnawing';
        wolf.gnawingAt = blocked;
        if (world.gnawFence(blocked)) {
          breached.push({ ...blocked });
        }
        return;
      }
      return;
    }

    wolf.gnawingAt = null;
    advance(wolf, best, tickSeconds);
  }

  /** Back toward the trees, and off the map when it gets there. */
  private retreat(world: World, wolf: Wolf, tickSeconds: number): void {
    const cover = coverNear(world, wolf.cell);
    const home = cover[0];
    if (!home || chebyshev(home, wolf.cell) === 0) {
      // Gone into the wood: the pack is one smaller, without anybody killing it.
      wolf.vigour = 0;
      return;
    }
    this.step(world, wolf, home, tickSeconds, []);
  }
}

/** Eight ways off a cell, in a fixed order so a replay steps identically. */
const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** Moves a wolf toward the centre of a cell, at its own pace. */
function advance(wolf: Wolf, towards: GridPoint, tickSeconds: number): void {
  const targetX = towards.gx + 0.5;
  const targetY = towards.gy + 0.5;
  const dx = targetX - wolf.position.wx;
  const dy = targetY - wolf.position.wy;
  const distance = Math.hypot(dx, dy);
  const travel = WOLF_SPEED * tickSeconds;
  if (distance <= travel || distance === 0) {
    wolf.position = { wx: targetX, wy: targetY };
    return;
  }
  wolf.position = {
    wx: wolf.position.wx + (dx / distance) * travel,
    wy: wolf.position.wy + (dy / distance) * travel,
  };
}

/**
 * The villager a wolf would go for, or `null`.
 *
 * Anybody out of doors within {@link HUNT_RADIUS}. Somebody sheltering is not a
 * target at all — that is the whole point of sending the children indoors — and
 * neither is somebody already dead in all but name, because ties are broken by id
 * and a wolf should not keep switching between two people at equal range.
 */
function nearestQuarry(villagers: readonly Villager[], wolf: Wolf): Villager | null {
  let best: Villager | null = null;
  let bestDistance = HUNT_RADIUS + 1;
  for (const villager of villagers) {
    if (villager.activity === 'sheltering') {
      continue;
    }
    const distance = chebyshev(villager.cell, wolf.cell);
    if (distance > HUNT_RADIUS) {
      continue;
    }
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && villager.id < best.id)
    ) {
      best = villager;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The heaps a pack would work through, nearest the trees first.
 *
 * Food only — wolves have no use for a pile of stone — and at most
 * {@link PACK_HEAPS} of them, so a settlement that leaves one heap at the
 * treeline and keeps the rest behind a wall loses the one at the treeline.
 */
function exposedFood(world: World): readonly ResourcePile[] {
  const reachable: { pile: ResourcePile; distance: number }[] = [];
  for (const pile of world.piles.all) {
    if (!isFood(pile.resource) || pile.isEmpty) {
      continue;
    }
    const distance = distanceToWood(world, pile.cell);
    if (distance === null) {
      continue;
    }
    reachable.push({ pile, distance });
  }
  reachable.sort((a, b) => a.distance - b.distance || a.pile.id - b.pile.id);
  return reachable.slice(0, PACK_HEAPS).map((found) => found.pile);
}

/**
 * Cells of standing wood within reach of somewhere, nearest first.
 *
 * Where a pack comes out and where it goes back to. A settlement that has cleared
 * its ground has pushed this list further away from itself, which is the quiet
 * defence nobody has to be told about.
 */
function coverNear(world: World, of: GridPoint): readonly GridPoint[] {
  const found: { cell: GridPoint; distance: number }[] = [];
  for (let gy = of.gy - WOLF_REACH; gy <= of.gy + WOLF_REACH; gy += 1) {
    for (let gx = of.gx - WOLF_REACH; gx <= of.gx + WOLF_REACH; gx += 1) {
      if (!world.terrain.contains(gx, gy) || !world.trees.has({ gx, gy })) {
        continue;
      }
      const cell = { gx, gy };
      if (world.fences.screens(cell, of)) {
        continue;
      }
      found.push({ cell, distance: chebyshev(cell, of) });
    }
  }
  found.sort((a, b) => a.distance - b.distance || a.cell.gy - b.cell.gy || a.cell.gx - b.cell.gx);
  return found.map((entry) => entry.cell);
}

/**
 * How far this cell is from wood a pack could come out of, or `null` when it is
 * out of reach or screened by a wall.
 */
function distanceToWood(world: World, cell: GridPoint): number | null {
  const cover = coverNear(world, cell);
  const nearest = cover[0];
  return nearest ? chebyshev(nearest, cell) : null;
}

/**
 * Whether any standing wood is within a pack's range of a cell.
 *
 * A cheap early-exit scan rather than the sorted list {@link coverNear} builds:
 * this one is asked of every candidate step of every wolf every tick, and it only
 * ever needs a yes.
 */
function coverWithinReach(world: World, cell: GridPoint): boolean {
  for (let gy = cell.gy - WOLF_REACH; gy <= cell.gy + WOLF_REACH; gy += 1) {
    for (let gx = cell.gx - WOLF_REACH; gx <= cell.gx + WOLF_REACH; gx += 1) {
      if (world.terrain.contains(gx, gy) && world.trees.has({ gx, gy })) {
        return true;
      }
    }
  }
  return false;
}

function chebyshev(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
}
