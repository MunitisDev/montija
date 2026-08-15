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
  readonly currentJobId: number | null;
  /** Absent in saves written before villagers aged or had homes. */
  readonly lifespan?: number;
  readonly homeId?: number | null;
  readonly daysSinceBirthday?: number;
  readonly birthCooldownDays?: number;
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
}

export interface SavedStorage {
  readonly gx: number;
  readonly gy: number;
  readonly capacity: number;
  readonly accepts: readonly ResourceId[] | null;
  /** Spoilage multiplier; absent in saves written before larders preserved food. */
  readonly preservation?: number;
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
}

export interface SavedTree {
  readonly id: number;
  readonly gx: number;
  readonly gy: number;
  readonly variant: number;
  readonly scale: number;
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
  };

  readonly villagers: readonly SavedVillager[];
  readonly piles: readonly SavedPile[];
  readonly storages: readonly SavedStorage[];
  readonly buildings: readonly SavedBuilding[];
  readonly jobs: readonly Job[];
  readonly deaths: number;
  /**
   * Where each random stream had got to.
   *
   * Without this a loaded settlement restarts its RNG from the seed and makes
   * different choices from the save it came from. Determinism is only worth
   * claiming if it survives a save.
   */
  readonly random: { readonly villagers: { readonly seed: number; readonly cursor: number } };
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
