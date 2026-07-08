/**
 * Persistent PDF/document cache backed by IndexedDB.
 *
 * Policy: LRU by count, cap = 20 entries. No TTL — freshness is enforced by
 * versioned cache keys (callers append `@v=<version>` when the source has a
 * mutable identity). Blobs are stored natively (IndexedDB accepts `Blob`),
 * no base64 or ArrayBuffer copy.
 *
 * All APIs swallow errors and return null / resolve — the cache is best-effort.
 * A cache failure must never break the calling data flow.
 */

const DB_NAME = "lovable-doc-cache";
const DB_VERSION = 1;
const STORE = "pdf-cache";
const MAX_ENTRIES = 20;

export interface CachedDoc {
  key: string;
  blob: Blob;
  mime: string;
  lastAccess: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "key" });
          store.createIndex("lastAccess", "lastAccess");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function getCached(key: string): Promise<CachedDoc | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = tx(db, "readonly").get(key);
      req.onsuccess = () => resolve((req.result as CachedDoc | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function touchLastAccess(key: string, now: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const store = tx(db, "readwrite");
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const rec = getReq.result as CachedDoc | undefined;
        if (!rec) return resolve();
        rec.lastAccess = now;
        const putReq = store.put(rec);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => resolve();
      };
      getReq.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function evictOldest(count: number): Promise<void> {
  if (count <= 0) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const store = tx(db, "readwrite");
      const idx = store.index("lastAccess");
      const cursorReq = idx.openCursor();
      let deleted = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || deleted >= count) return resolve();
        cursor.delete();
        deleted += 1;
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function countEntries(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const req = tx(db, "readonly").count();
      req.onsuccess = () => resolve(req.result ?? 0);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

async function putRecord(rec: CachedDoc): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const req = tx(db, "readwrite").put(rec);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Write a blob into the cache, enforcing the LRU-by-count cap. On quota
 * failure, evict 5 oldest and retry once, then give up.
 */
export async function putCached(entry: Omit<CachedDoc, "lastAccess">): Promise<void> {
  const rec: CachedDoc = { ...entry, lastAccess: Date.now() };
  const ok = await putRecord(rec);
  if (!ok) {
    // Assume quota — evict + retry once.
    await evictOldest(5);
    await putRecord(rec);
  }
  const total = await countEntries();
  if (total > MAX_ENTRIES) {
    await evictOldest(total - MAX_ENTRIES);
  }
}

/** Refresh a hit's lastAccess without rewriting the blob. Fire-and-forget. */
export function touchCached(key: string): void {
  void touchLastAccess(key, Date.now());
}
