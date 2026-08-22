/**
 * The wall: a palisade of stakes, a wall of stone, and the gates through both.
 *
 * **What it is for.** Wolves come down in the hungry season and take what is
 * easiest — food left lying in the open, or somebody caught out with the trees at
 * their back. A wall is the settlement's answer, and the first thing in this game
 * that exists to keep something out.
 *
 * **A wall is a wall.** It was a screen once — a line nothing crossed, that
 * villagers walked through as if it were not there, on the reasoning that
 * modelling gates would be a great deal of interface. That was the wrong trade:
 * a barrier people ignore is a decoration, and the interesting decision in any
 * wall is *where you leave the way in*. So a stake line now stops villagers as
 * well, and a **gate** is the one cell they may pass. Without one they walk
 * round; with a badly placed one they walk a long way round, which is the
 * decision the whole thing is about.
 *
 * That trades one unrecoverable mistake for a recoverable one: a settlement
 * **can** now wall itself in, and the way out is to pull a cell down (immediate)
 * or put a gate in it. Both are one tap on the cell.
 *
 * **Four kinds, two materials, two purposes:**
 *
 * ```text
 *                stops people   stops wolves   wolves can break it
 * palisade            yes            yes              yes
 * stone wall          yes            yes              no
 * timber gate         no             yes              yes
 * stone gate          no             yes              no
 * ```
 *
 * A gate stops wolves because it is barred the moment the alarm goes up, which is
 * the honest reading of a gate in a settlement that has just seen a pack. What
 * stone buys is that **it cannot be chewed through**: a determined pack will work
 * at timber until it gives, and against stone it gives up and goes home. That is
 * the difference between a wall that holds this winter and one that holds every
 * winter.
 *
 * Drawn like a road, in a line, and paid for like nothing else in the game: see
 * `Simulation.designateFence` for why the material is set aside when the order is
 * given rather than carried out to the line.
 */

import { cellLine } from '@/shared/math/gridLine';
import type { GridPoint } from '@/shared/types/geometry';
import { CellFlagGrid } from './CellFlagGrid';

/**
 * What can stand on a cell, in the order the grid stores them.
 *
 * **Append-only**, like the terrain list and for the same reason: the index is
 * what a save holds.
 */
export const FENCE_KINDS = ['palisade', 'stone-wall', 'timber-gate', 'stone-gate'] as const;
export type FenceKind = (typeof FENCE_KINDS)[number];

/** Kinds people may walk through. */
const OPEN_TO_PEOPLE: readonly FenceKind[] = ['timber-gate', 'stone-gate'];

/** Kinds a pack can chew through, given long enough. */
const TIMBER: readonly FenceKind[] = ['palisade', 'timber-gate'];

/**
 * Logs per cell of palisade.
 *
 * One, which for a settlement of any size is the cheapest building decision in
 * the game and for a settlement in its first autumn is a real one: twenty cells
 * of stake line is two and a half houses' worth of timber, and the first winter
 * does not have that to spare. Ringing the whole settlement is not the plan the
 * numbers reward — screening the larder and the yard is.
 */
export const LOGS_PER_FENCE = 1;

/**
 * Logs for a gate.
 *
 * Three times a plain cell, because a gate is a frame and a hung door rather than
 * a stake driven into the ground — and because the *number* of gates should be a
 * decision. A wall with a gate every five cells is not a wall.
 */
export const LOGS_PER_GATE = 3;

/**
 * Stone to build a cell of wall up in stone.
 *
 * Two, and it is deliberately dearer than the timber it replaces by more than the
 * multiplier suggests: stone comes out of a Quarry at half the rate logs come out
 * of a wood, so the same number would be a much larger commitment. What it buys
 * is a cell no pack can ever get through.
 */
export const STONE_PER_WALL = 2;

/** Stone for a gate in the wall. Dearer again: a stone arch is a real thing. */
export const STONE_PER_GATE = 4;

/**
 * How much chewing a cell of timber takes before it gives.
 *
 * In bites, and a wolf bites once a tick — so a lone wolf works through a stake
 * line in a little under a minute of play at 1x, and a pack of four in fifteen
 * seconds. Long enough that the settlement has time to answer it, short enough
 * that a timber wall left undefended is not a permanent answer.
 */
export const TIMBER_STRENGTH = 240;

export class FenceGrid extends CellFlagGrid {
  /**
   * How far through each cell the wolves have got.
   *
   * A second array rather than a field on a cell object, for the same reason the
   * kinds are an array: there is one number per cell of a 96×96 map and no
   * object anywhere. Cleared when a cell changes hands.
   */
  private readonly chewed: Uint8Array;

  constructor(width: number, height: number) {
    super(width, height);
    this.chewed = new Uint8Array(width * height);
  }

  /** What stands on this cell, or `null` for open ground. */
  public kindAt(cell: GridPoint): FenceKind | null {
    const stored = this.valueAt(cell.gx, cell.gy);
    return stored === 0 ? null : (FENCE_KINDS[stored - 1] ?? null);
  }

  /** `true` when a villager cannot walk through this cell. */
  public blocksPeople(cell: GridPoint): boolean {
    const kind = this.kindAt(cell);
    return kind !== null && !OPEN_TO_PEOPLE.includes(kind);
  }

  /** `true` when this cell is a way through the wall. */
  public isGate(cell: GridPoint): boolean {
    const kind = this.kindAt(cell);
    return kind !== null && OPEN_TO_PEOPLE.includes(kind);
  }

  /** Puts something up. Replaces whatever was there, and resets its damage. */
  public raise(cell: GridPoint, kind: FenceKind): boolean {
    const index = FENCE_KINDS.indexOf(kind) + 1;
    if (!this.lay(cell.gx, cell.gy, index)) {
      return false;
    }
    this.chewed[cell.gy * this.width + cell.gx] = 0;
    return true;
  }

  /** Takes it down, and forgets the damage with it. */
  public pullDown(cell: GridPoint): boolean {
    if (!this.lift(cell.gx, cell.gy)) {
      return false;
    }
    this.chewed[cell.gy * this.width + cell.gx] = 0;
    return true;
  }

  /**
   * One bite at a cell.
   *
   * @returns `true` on the bite that breaks it, at which point the cell is open
   *   ground and the settlement has a hole in its wall.
   */
  public gnaw(cell: GridPoint): boolean {
    const kind = this.kindAt(cell);
    if (kind === null || !TIMBER.includes(kind)) {
      return false;
    }
    const index = cell.gy * this.width + cell.gx;
    const bites = (this.chewed[index] ?? 0) + Math.ceil(255 / TIMBER_STRENGTH);
    if (bites >= 255) {
      this.pullDown(cell);
      return true;
    }
    this.chewed[index] = bites;
    return false;
  }

  /** How chewed a cell is, in `0..1`. For the renderer and for saving. */
  public damageAt(cell: GridPoint): number {
    return (this.chewed[cell.gy * this.width + cell.gx] ?? 0) / 255;
  }

  /**
   * `true` when a wall of any kind lies between two cells.
   *
   * The same test the fire system uses for a firebreak, and on purpose: the
   * player has already learned that what lies *between* two things decides
   * whether one reaches the other, and this is that rule doing a second job.
   * Gates count — they are barred when the alarm goes up.
   */
  public screens(from: GridPoint, to: GridPoint): boolean {
    for (const cell of cellLine(from, to)) {
      if (this.hasAt(cell)) {
        return true;
      }
    }
    return false;
  }

  /** Every standing cell with what stands on it, for saving and drawing. */
  public survey(): { gx: number; gy: number; kind: FenceKind; damage: number }[] {
    return this.all().map((cell) => ({
      gx: cell.gx,
      gy: cell.gy,
      kind: this.kindAt(cell) ?? 'palisade',
      damage: this.damageAt(cell),
    }));
  }

  /** Replaces the whole wall from a save. */
  public restoreWall(
    cells: readonly { gx: number; gy: number; kind?: FenceKind; damage?: number }[],
  ): void {
    this.restore([]);
    this.chewed.fill(0);
    for (const cell of cells) {
      // A save written before there was more than one kind holds bare cells, and
      // every one of them was a palisade.
      this.raise(cell, cell.kind ?? 'palisade');
      if (cell.damage) {
        this.chewed[cell.gy * this.width + cell.gx] = Math.round(
          Math.min(1, Math.max(0, cell.damage)) * 255,
        );
      }
    }
  }
}
