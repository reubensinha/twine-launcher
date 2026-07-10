/**
 * Generic IndexedDB export / import for save sync.
 *
 * Many Twine games (SugarCube, e.g. Degrees of Lewdity) store their save slots in
 * IndexedDB rather than localStorage. The launcher captures a JSON-safe dump of the
 * game's IndexedDB databases and restores it into the same-origin store before the
 * game boots, so saves follow the user across devices and browsers.
 *
 * Pattern mirrors the well-known `indexeddb-export-import` approach: per-store
 * metadata (keyPath / autoIncrement / indexes) plus all records.
 */

export interface IdbStoreDump {
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }>;
  // `key` is only present for out-of-line stores (keyPath === null); inline keys live in `value`.
  records: Array<{ key?: IDBValidKey; value: unknown }>;
}

export interface IdbDbDump {
  version: number;
  stores: Record<string, IdbStoreDump>;
}

/** dbName -> dump. This is the `indexedDB` half of the server save blob. */
export type IdbDump = Record<string, IdbDbDump>;

// ── Promise helpers ────────────────────────────────────────────────────────────

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`IndexedDB open blocked: ${name}`));
  });
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // Blocked means another connection is still open; it will delete once that closes.
    req.onblocked = () => resolve();
  });
}

// ── Discovery ──────────────────────────────────────────────────────────────────

/**
 * Best-effort enumeration of the origin's IndexedDB databases.
 *
 * `indexedDB.databases()` exists on Chromium/Android Chrome but NOT Firefox, so we
 * union it with `extra` names (collected by the injected open() tracker / known from
 * a prior restore).
 */
export async function discoverDbNames(extra: Iterable<string> = []): Promise<string[]> {
  const names = new Set<string>(extra);
  const idbAny = indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> };
  if (typeof idbAny.databases === 'function') {
    try {
      for (const d of await idbAny.databases()) {
        if (d && d.name) names.add(d.name);
      }
    } catch { /* ignore — fall back to whatever `extra` gave us */ }
  }
  return [...names];
}

// ── Export ─────────────────────────────────────────────────────────────────────

export async function dumpIndexedDB(dbNames: string[]): Promise<IdbDump> {
  const out: IdbDump = {};
  for (const name of dbNames) {
    try {
      const db = await openDb(name);
      try {
        const storeNames = Array.from(db.objectStoreNames);
        if (storeNames.length === 0) continue; // empty/phantom DB — nothing to sync
        const dbDump: IdbDbDump = { version: db.version, stores: {} };
        for (const storeName of storeNames) {
          // One transaction per store: avoids the IndexedDB auto-commit pitfall where a
          // transaction goes inactive across an `await`. Both requests are issued
          // synchronously within the same task, so the tx stays alive for both.
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const indexes = Array.from(store.indexNames).map(idxName => {
            const idx = store.index(idxName);
            return {
              name: idx.name,
              keyPath: idx.keyPath as string | string[],
              unique: idx.unique,
              multiEntry: idx.multiEntry,
            };
          });
          const keyPath = store.keyPath as string | string[] | null;
          const [values, keys] = await Promise.all([
            reqToPromise<unknown[]>(store.getAll()),
            reqToPromise<IDBValidKey[]>(store.getAllKeys()),
          ]);
          const records = values.map((value, i) =>
            keyPath == null ? { key: keys[i], value } : { value },
          );
          dbDump.stores[storeName] = { keyPath, autoIncrement: store.autoIncrement, indexes, records };
        }
        out[name] = dbDump;
      } finally {
        db.close();
      }
    } catch (e) {
      // Skip a DB we can't read rather than failing the whole snapshot.
      console.warn('[idb-sync] dump failed for', name, e);
    }
  }
  return out;
}

/** Delete the named databases (used for a genuine "play fresh" start). */
export async function deleteIndexedDB(dbNames: string[]): Promise<void> {
  for (const name of dbNames) {
    try {
      await deleteDb(name);
    } catch (e) {
      console.warn('[idb-sync] delete failed for', name, e);
    }
  }
}

// ── Import ─────────────────────────────────────────────────────────────────────

/**
 * Restore an IndexedDB dump into the current origin.
 *
 * Each database is deleted and recreated at the captured version so the result
 * exactly mirrors the server's authoritative copy (no version conflicts, no stale
 * records). Must be awaited BEFORE the game iframe navigates, so the game opens an
 * already-populated database.
 */
export async function restoreIndexedDB(dump: IdbDump): Promise<void> {
  for (const [name, dbDump] of Object.entries(dump)) {
    await deleteDb(name);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, dbDump.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [storeName, storeDump] of Object.entries(dbDump.stores)) {
          const store = db.createObjectStore(storeName, {
            keyPath: storeDump.keyPath as string | string[] | undefined,
            autoIncrement: storeDump.autoIncrement,
          });
          for (const idx of storeDump.indexes) {
            store.createIndex(idx.name, idx.keyPath, { unique: idx.unique, multiEntry: idx.multiEntry });
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const storeNames = Object.keys(dbDump.stores).filter(s => db.objectStoreNames.contains(s));
        if (storeNames.length === 0) { db.close(); resolve(); return; }
        const tx = db.transaction(storeNames, 'readwrite');
        for (const storeName of storeNames) {
          const store = tx.objectStore(storeName);
          const storeDump = dbDump.stores[storeName];
          for (const rec of storeDump.records) {
            if (storeDump.keyPath == null && 'key' in rec) store.put(rec.value, rec.key);
            else store.put(rec.value);
          }
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error(`IndexedDB open blocked during restore: ${name}`));
    });
  }
}
