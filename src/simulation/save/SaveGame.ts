/**
 * The save format.
 *
 * Versioned from the first release, because a save written today must still be
 * readable — or knowably unreadable — after the format changes. `version` is
 * checked before anything else is trusted.
 *
 * **Only authoritative simulation state is saved.** No Phaser objects, no
 * sprites, no camera. Everything the renderer holds is derived and is rebuilt
 * from this on load, which is precisely why the simulation was kept free of the
 * engine in Phase 1.
 *
 * The whole document is plain JSON-compatible data. Jobs were deliberately
 * designed as plain data in Phase 4 for this moment.
 */

import type { BuildingId } from '@/data/buildings';
import type { ResourceId } from '@/data/resources';
import type { Job } from '@/simulation/jobs/Job';

/** Bump whenever the shape below changes incompatibly. */
export const SAVE_VERSION = 1;

export interface SavedInventory {
  readonly [resource: string]: number;
}

export interface SavedVillager {
  readonly id: number;
  readonly name: string;
  readonly age: number;
  readonly wx: number;
  readonly wy: number;
  readonly hunger: number;
  readonly warmth: number;
  readonly health: number;
  /** Absent in saves written before the settlement had a spirit; restores neutral. */
  readonly spirit?: number;
  readonly currentJobId: number | null;
  /** Absent in saves written before villagers aged or had homes. */
  readonly lifespan?: number;
  readonly homeId?: number | null;
  readonly daysSinceBirthday?: number;
  readonly birthCooldownDays?: number;
  /** The building they work at. Absent in saves from before anyone had a job. */
  readonly employerId?: number | null;
  /**
   * A posting the player made: a building id, `'labourer'`, or absent for
   * automatic. Optional, so saves written before postings existed load as
   * automatic rather than being rejected.
   */
  readonly workPreference?: number | 'labourer' | null;
  /** The villager this one is paired with. Optional for older saves. */
  readonly partnerId?: number | null;
  /** Which of two. Absent in saves written before households had families. */
  readonly sex?: 'f' | 'm';
  /** Who they were born to, oldest id first. Absent for founders. */
  readonly parentIds?: readonly [number, number] | null;
  /** Days of sickness left. Absent in saves from before anyone could fall ill. */
  readonly illDaysRemaining?: number;
  /**
   * Days spent unwell across a whole life, which shortens it.
   *
   * Absent in older saves and restores at zero: a villager whose sickness was
   * never written down, honestly treated as having had none.
   */
  readonly illDaysLived?: number;
  /**
   * Days worked at each trade, as pairs.
   *
   * Pairs rather than an object because the keys are building ids and a plain
   * record over them would be mostly zeroes. Absent in saves from before trades
   * existed, which restore as a settlement of beginners — which is exactly what
   * they were.
   */
  readonly experience?: readonly (readonly [string, number])[];
  readonly carrying: SavedInventory;
  /**
   * The route being walked, and where it leads.
   *
   * Saved because dropping it makes a loaded villager re-plan from where they
   * stand, which quietly diverges the simulation from the one that was saved.
   */
  readonly path: readonly { readonly gx: number; readonly gy: number }[];
  readonly destination: { readonly gx: number; readonly gy: number } | null;
  readonly activity: string;
  readonly idleTicks: number;
}

export interface SavedPile {
  readonly gx: number;
  readonly gy: number;
  readonly resource: ResourceId;
  readonly amount: number;
  /**
   * Days it has lain there. Absent in saves written before heaps had an age,
   * which restore as new — a settlement reloaded is not punished for the time
   * its goods spent on the ground before anybody was counting.
   */
  readonly days?: number;
}

export interface SavedStorage {
  readonly gx: number;
  readonly gy: number;
  readonly capacity: number;
  readonly accepts: readonly ResourceId[] | null;
  /** Spoilage multiplier; absent in saves written before larders preserved food. */
  readonly preservation?: number;
  /** The building that opened this yard, or null for the founding one. */
  readonly ownerBuildingId?: number | null;
  readonly contents: SavedInventory;
}

export interface SavedBuilding {
  readonly id: number;
  readonly buildingId: BuildingId;
  /** The yard this building opened, so restoring does not open a second. */
  readonly storageId?: number | null;
  readonly gx: number;
  readonly gy: number;
  readonly complete: boolean;
  readonly buildTicksRemaining: number;
  readonly materials: SavedInventory;
  readonly input: SavedInventory;
  /**
   * How many workers the player asked for here.
   *
   * Absent in saves written before quotas existed, which restore with every
   * slot filled — what those settlements were already doing.
   */
  readonly desiredWorkers?: number;
}

export interface SavedTree {
  readonly id: number;
  readonly gx: number;
  readonly gy: number;
  readonly variant: number;
  readonly scale: number;
  /**
   * The day it took root, which is what its size is read from.
   *
   * Absent in saves written before trees grew, which restore as full-grown: every
   * tree in those settlements was fellable when the save was written, and a reload
   * that turned a working wood into a field of saplings would be a worse lie than
   * forgetting an age.
   */
  readonly planted?: number;
}

export interface SaveGame {
  readonly version: number;
  readonly savedAt: string;
  readonly worldSeed: number;
  readonly simulationTime: number;

  readonly world: {
    readonly width: number;
    readonly height: number;
    /**
     * The terrain buffer as a plain number array.
     *
     * Terrain is saved rather than regenerated, because villagers change it:
     * felled forest becomes grass and mined rock opens up. Re-running the
     * generator would undo every clearing the settlement ever made.
     */
    readonly terrain: readonly number[];
    readonly trees: readonly SavedTree[];
    /**
     * Every paved cell.
     *
     * Absent in saves written before roads existed, which restore as a
     * settlement with none — the correct reading of a save that predates them.
     * Stored as a list rather than a second full-map buffer because roads are
     * sparse: a well-connected settlement has tens of them on a map of ~9,000
     * cells.
     */
    readonly roads?: readonly { readonly gx: number; readonly gy: number }[];
  };

  readonly villagers: readonly SavedVillager[];
  readonly piles: readonly SavedPile[];
  readonly storages: readonly SavedStorage[];
  readonly buildings: readonly SavedBuilding[];
  readonly jobs: readonly Job[];
  readonly deaths: number;
  /**
   * Fractional wear the settlement still owes, as pairs.
   *
   * Tools and coats wear at a twentieth a day and herbs at a half, and stores
   * hold whole things — so the remainder is carried rather than rounded away.
   * Dropping it on load would quietly forgive whatever was owed, which over a
   * long game is free tools. Absent in older saves, which restore owing nothing.
   */
  readonly wear?: readonly (readonly [string, number])[];
  /**
   * Lifetime totals.
   *
   * Saved rather than recomputed because they are about the past, and a
   * snapshot of the present cannot be asked what the past was. Absent in older
   * saves, which restore at zero — a settlement whose history was never
   * written down, honestly reported as such.
   */
  readonly chronicle?: {
    readonly born: number;
    readonly died: number;
    readonly arrived: number;
    readonly peakPopulation: number;
    readonly buildingsRaised: number;
    readonly foodEaten: number;
    readonly firewoodBurned: number;
    readonly coldest: number;
    readonly roughNights: number;
  };
  /**
   * The roll of the dead: a line each, with an age and a cause.
   *
   * Saved for the same reason as the chronicle and more strongly: a name and an
   * age at death cannot be recomputed from anything, because the person they
   * belong to is gone. A settlement that forgot its dead on every reload would
   * show a clean history beside an unexplained population. Absent in older
   * saves, which restore with an empty roll.
   */
  readonly necrology?: readonly {
    readonly name: string;
    readonly sex: string;
    readonly age: number;
    readonly cause: string;
    readonly year: number;
    readonly season: string;
    readonly ill: boolean;
    readonly trade: string | null;
    readonly level?: string;
  }[];
  /**
   * The ground the player cleared for good.
   *
   * It cannot be recomputed from the map — a cleared cell and a cell that never
   * had a tree look identical — so a save without it would let the wild spread
   * creep back through the middle of a village. Absent in older saves, which
   * restore with every clearing forgotten, as it was before.
   *
   * `stumps` is written by saves from when the Forester's Lodge existed and trees
   * came back out of a ledger rather than growing where you could see them. It is
   * read and ignored: those cells are standing wood or open ground either way,
   * and the trees on the map are what the save actually recorded.
   */
  readonly woodland?: {
    readonly stumps?: readonly {
      readonly gx: number;
      readonly gy: number;
      readonly day: number;
    }[];
    readonly barren: readonly (readonly [number, number])[];
  };
  /**
   * Where each random stream had got to.
   *
   * Without this a loaded settlement restarts its RNG from the seed and makes
   * different choices from the save it came from. Determinism is only worth
   * claiming if it survives a save.
   */
  readonly random: {
    readonly villagers: { readonly seed: number; readonly cursor: number };
    /** Absent in saves written before the woods could grow back. */
    readonly forest?: { readonly seed: number; readonly cursor: number };
    /** Absent in saves written before anyone could fall ill. */
    readonly illness?: { readonly seed: number; readonly cursor: number };
  };
}

/** Why a save could not be loaded, so the UI can say something useful. */
export type LoadFailure =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unsupported-version'; readonly found: number }
  | { readonly kind: 'corrupt'; readonly detail: string };

export type LoadResult =
  | { readonly ok: true; readonly save: SaveGame }
  | { readonly ok: false; readonly failure: LoadFailure };

/**
 * Checks a value really is a save of a version we understand.
 *
 * Deliberately strict: a half-recognised save that loads into a broken world is
 * far worse than one that refuses cleanly.
 */
export function validateSave(value: unknown): LoadResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, failure: { kind: 'corrupt', detail: 'not an object' } };
  }

  const candidate = value as Partial<SaveGame>;

  if (typeof candidate.version !== 'number') {
    return { ok: false, failure: { kind: 'corrupt', detail: 'no version' } };
  }
  if (candidate.version !== SAVE_VERSION) {
    return { ok: false, failure: { kind: 'unsupported-version', found: candidate.version } };
  }

  const required: (keyof SaveGame)[] = [
    'worldSeed',
    'simulationTime',
    'world',
    'villagers',
    'piles',
    'storages',
    'buildings',
    'jobs',
  ];
  for (const key of required) {
    if (candidate[key] === undefined) {
      return { ok: false, failure: { kind: 'corrupt', detail: `missing ${String(key)}` } };
    }
  }

  if (!Array.isArray(candidate.world?.terrain)) {
    return { ok: false, failure: { kind: 'corrupt', detail: 'terrain is not an array' } };
  }

  return { ok: true, save: candidate as SaveGame };
}
