/**
 * Save persistence, in IndexedDB.
 *
 * IndexedDB rather than localStorage: a settlement's terrain buffer alone is
 * thousands of entries, and localStorage's ~5MB string limit and synchronous
 * API would both bite. IndexedDB stores structured objects and never blocks the
 * frame.
 *
 * The store knows nothing about the game — it reads and writes documents that
 * happen to be saves. Validation lives in `SaveGame.ts`.
 */

import {
  summarise,
  validateSave,
  type LoadResult,
  type SaveGame,
  type SaveSummary,
} from './SaveGame';

const DATABASE_NAME = 'montija';
const DATABASE_VERSION = 1;
const STORE_NAME = 'saves';

/**
 * The slot the game wrote to before settlements had names.
 *
 * Kept so a settlement saved by an older build is still offered on the menu
 * rather than silently orphaned. Nothing writes here any more.
 */
export const AUTOSAVE_SLOT = 'autosave';

/**
 * Where a save's one-line summary lives.
 *
 * Beside the save rather than inside it, under a key the listing can scan for.
 * A save is a megabyte of terrain and the menu needs a name and a year — reading
 * four saves to draw four buttons is four megabytes of parsing for a screen the
 * player looks at for a second.
 */
const SUMMARY_PREFIX = 'summary:';

export interface SaveStore {
  write(slot: string, save: SaveGame): Promise<void>;
  read(slot: string): Promise<LoadResult>;
  has(slot: string): Promise<boolean>;
  remove(slot: string): Promise<void>;
  /** Every settlement in the store, newest first. */
  list(): Promise<readonly SaveSummary[]>;
}

/** `true` when this browser can persist saves at all. */
export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export class IndexedDbSaveStore implements SaveStore {
  private database: Promise<IDBDatabase> | null = null;

  public async write(slot: string, save: SaveGame): Promise<void> {
    const database = await this.open();
    await runTransaction(database, 'readwrite', (store) => store.put(save, slot));
    // The summary second, and in its own transaction: a save that landed and a
    // summary that did not is a settlement missing from the menu, which is
    // recoverable. The other way round is a menu entry that opens nothing.
    await runTransaction(database, 'readwrite', (store) =>
      store.put(summarise(slot, save), SUMMARY_PREFIX + slot),
    );
  }

  public async read(slot: string): Promise<LoadResult> {
    const database = await this.open();
    const value = await runTransaction<unknown>(database, 'readonly', (store) => store.get(slot));

    if (value === undefined) {
      return { ok: false, failure: { kind: 'missing' } };
    }
    return validateSave(value);
  }

  public async has(slot: string): Promise<boolean> {
    const result = await this.read(slot);
    return result.ok;
  }

  public async remove(slot: string): Promise<void> {
    const database = await this.open();
    await runTransaction(database, 'readwrite', (store) => store.delete(slot));
    await runTransaction(database, 'readwrite', (store) => store.delete(SUMMARY_PREFIX + slot));
  }

  public async list(): Promise<readonly SaveSummary[]> {
    const database = await this.open();
    const keys = await runTransaction<IDBValidKey[]>(database, 'readonly', (store) =>
      store.getAllKeys(),
    );

    const summaries: SaveSummary[] = [];
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(SUMMARY_PREFIX)) {
        continue;
      }
      const value = await runTransaction<unknown>(database, 'readonly', (store) => store.get(key));
      const summary = readSummary(value);
      if (summary) {
        summaries.push(summary);
      }
    }

    // A settlement saved before names existed still deserves to be offered.
    if (keys.includes(AUTOSAVE_SLOT) && !summaries.some((s) => s.slot === AUTOSAVE_SLOT)) {
      const legacy = await this.read(AUTOSAVE_SLOT);
      if (legacy.ok) {
        summaries.push(summarise(AUTOSAVE_SLOT, legacy.save));
      }
    }

    return sortNewestFirst(summaries);
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) {
      return this.database;
    }

    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Could not open the save database'));
    });

    return this.database;
  }
}

function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('Save operation failed'));
  });
}

/**
 * An in-memory store, for tests and for browsers without IndexedDB.
 *
 * Saves are round-tripped through JSON so it behaves like real persistence:
 * an in-memory store that hands back the same object reference would hide
 * exactly the serialisation bugs these tests exist to catch.
 */
export class MemorySaveStore implements SaveStore {
  private readonly slots = new Map<string, string>();
  private readonly summaries = new Map<string, SaveSummary>();

  public async write(slot: string, save: SaveGame): Promise<void> {
    this.slots.set(slot, JSON.stringify(save));
    this.summaries.set(slot, summarise(slot, save));
  }

  public async read(slot: string): Promise<LoadResult> {
    const raw = this.slots.get(slot);
    if (raw === undefined) {
      return { ok: false, failure: { kind: 'missing' } };
    }
    try {
      return validateSave(JSON.parse(raw));
    } catch (error) {
      return {
        ok: false,
        failure: { kind: 'corrupt', detail: error instanceof Error ? error.message : 'bad JSON' },
      };
    }
  }

  public async has(slot: string): Promise<boolean> {
    return this.slots.has(slot);
  }

  public async remove(slot: string): Promise<void> {
    this.slots.delete(slot);
    this.summaries.delete(slot);
  }

  public async list(): Promise<readonly SaveSummary[]> {
    return sortNewestFirst([...this.summaries.values()]);
  }
}

/**
 * Newest first, because that is the settlement the player almost always wants.
 *
 * Ties break on name so the list is stable rather than shuffling between two
 * saves written in the same second.
 */
function sortNewestFirst(summaries: readonly SaveSummary[]): readonly SaveSummary[] {
  return [...summaries].sort(
    (a, b) => b.savedAt.localeCompare(a.savedAt) || a.name.localeCompare(b.name),
  );
}

/** A stored summary, if it really is one. Anything else is ignored. */
function readSummary(value: unknown): SaveSummary | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<SaveSummary>;
  if (typeof candidate.slot !== 'string' || typeof candidate.name !== 'string') {
    return null;
  }
  return {
    slot: candidate.slot,
    name: candidate.name,
    year: typeof candidate.year === 'number' ? candidate.year : 1,
    savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : '',
    population: typeof candidate.population === 'number' ? candidate.population : 0,
  };
}
