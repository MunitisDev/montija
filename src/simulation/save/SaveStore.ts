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

import { validateSave, type LoadResult, type SaveGame } from './SaveGame';

const DATABASE_NAME = 'montija';
const DATABASE_VERSION = 1;
const STORE_NAME = 'saves';

/** The slot autosave writes to. */
export const AUTOSAVE_SLOT = 'autosave';

export interface SaveStore {
  write(slot: string, save: SaveGame): Promise<void>;
  read(slot: string): Promise<LoadResult>;
  has(slot: string): Promise<boolean>;
  remove(slot: string): Promise<void>;
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

  public async write(slot: string, save: SaveGame): Promise<void> {
    this.slots.set(slot, JSON.stringify(save));
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
  }
}
