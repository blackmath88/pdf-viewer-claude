/* ------------------------------------------------------------
   recents.js — a tiny IndexedDB-backed "recent documents" store.

   Keeps up to 5 recently opened PDFs on-device (blob + a little
   metadata) so they can be reopened instantly at the last page.
   No libraries, no network — everything stays in the browser and
   can be cleared from the UI.

   Two object stores share one DB: `meta` (light, listed often)
   and `blob` (heavy, read only when reopening) so listing never
   has to deserialize the file bytes.
   ------------------------------------------------------------ */

const DB_NAME = 'pocketpdf';
const DB_VERSION = 1;
const META = 'meta';
const BLOB = 'blob';

export const MAX_ENTRIES = 5;
export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — larger files just open

let dbPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BLOB)) db.createObjectStore(BLOB, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function db() {
  if (!dbPromise) dbPromise = openDB().catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

// Run a transaction and resolve when it completes (so writes are durable). If
// `fn` returns an IDBRequest, the transaction's result is that request's value.
function run(stores, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let out;
    t.oncomplete = () =>
      resolve(out && typeof out === 'object' && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    out = fn(t);
  }));
}

/** All metadata, newest first. Blobs are NOT loaded. */
export async function list() {
  try {
    return await run([META], 'readonly', (t) => t.objectStore(META).getAll())
      .then((rows) => (rows || []).sort((a, b) => b.updatedAt - a.updatedAt));
  } catch {
    return [];
  }
}

/** The stored File/Blob for an entry, or null. */
export async function getBlob(id) {
  try {
    const row = await run([BLOB], 'readonly', (t) => t.objectStore(BLOB).get(id));
    return row ? row.blob : null;
  } catch {
    return null;
  }
}

/** Insert/update an entry, then evict all but the newest MAX_ENTRIES. */
export async function put({ id, name, size, pageCount, lastPage, blob, updatedAt }) {
  const meta = { id, name, size, pageCount, lastPage, updatedAt: updatedAt || Date.now() };
  try {
    await run([META, BLOB], 'readwrite', (t) => {
      t.objectStore(META).put(meta);
      t.objectStore(BLOB).put({ id, blob });
    });
    await prune();
  } catch {
    /* storage unavailable (private mode / quota) — silently skip */
  }
  return meta;
}

/** Update just the last-read page (and bump recency) — no blob rewrite. */
export async function updatePage(id, lastPage) {
  try {
    await run([META], 'readwrite', (t) => {
      const store = t.objectStore(META);
      const g = store.get(id);
      g.onsuccess = () => {
        const row = g.result;
        if (row) { row.lastPage = lastPage; row.updatedAt = Date.now(); store.put(row); }
      };
    });
  } catch { /* ignore */ }
}

export async function remove(id) {
  try {
    await run([META, BLOB], 'readwrite', (t) => {
      t.objectStore(META).delete(id);
      t.objectStore(BLOB).delete(id);
    });
  } catch { /* ignore */ }
}

export async function clear() {
  try {
    await run([META, BLOB], 'readwrite', (t) => {
      t.objectStore(META).clear();
      t.objectStore(BLOB).clear();
    });
  } catch { /* ignore */ }
}

async function prune() {
  const rows = await list();
  if (rows.length <= MAX_ENTRIES) return;
  const doomed = rows.slice(MAX_ENTRIES);
  await run([META, BLOB], 'readwrite', (t) => {
    for (const r of doomed) {
      t.objectStore(META).delete(r.id);
      t.objectStore(BLOB).delete(r.id);
    }
  });
}
