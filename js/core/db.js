const DB_NAME = 'routemaximist_final';
const DB_VERSION = 1;

const STORES = [
  { name: 'projects', keyPath: 'id' },
  { name: 'areas', keyPath: 'id', indexes: [['project_id', 'project_id']] },
  { name: 'rayons', keyPath: 'id', indexes: [['project_id','project_id']] },
  { name: 'salesmen', keyPath: 'id', indexes: [['project_id','project_id']] },
  { name: 'outlets', keyPath: 'id', indexes: [['project_id','project_id'], ['rayon_id','rayon_id'], ['salesman_id','salesman_id']] },
  { name: 'audit_log', keyPath: 'id', indexes: [['project_id','project_id']] },
  { name: 'settings', keyPath: 'key' }
];

let dbPromise = null;
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('Browser tidak mendukung IndexedDB (mode privat?). Gunakan browser modern non-privat.'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s.name)) {
          const store = db.createObjectStore(s.name, { keyPath: s.keyPath });
          if (s.indexes) for (const [n, k] of s.indexes) store.createIndex(n, k, { unique: false });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('Database terkunci oleh tab lain. Tutup tab RouteMaximist lain lalu muat ulang.')); };
  });
  return dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function dbGet(store, key) { return wrap((await tx(store)).get(key)); }
export async function dbPut(store, value) { return wrap((await tx(store, 'readwrite')).put(value)); }
export async function dbDelete(store, key) { await wrap((await tx(store, 'readwrite')).delete(key)); return true; }

export async function dbAll(store, indexName = null, query = null) {
  const s = await tx(store);
  const src = indexName ? s.index(indexName) : s;
  const r = query != null ? src.getAll(query) : src.getAll();
  return (await wrap(r)) || [];
}

export async function dbByIndex(store, indexName, value) { return dbAll(store, indexName, value); }

// Tulis banyak record dalam SATU transaksi (jauh lebih cepat & atomik)
export async function dbBulkPut(store, values) {
  if (!values.length) return 0;
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const v of values) s.put(v);
    t.oncomplete = () => res(values.length);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transaksi dibatalkan'));
  });
}

export async function dbDeleteByIndex(store, indexName, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    const idx = t.objectStore(store).index(indexName);
    let n = 0;
    const cur = idx.openKeyCursor(IDBKeyRange.only(value));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { t.objectStore(store).delete(c.primaryKey); n++; c.continue(); }
    };
    t.oncomplete = () => res(n);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transaksi dibatalkan'));
  });
}

export async function auditLog(projectId, action, entity, entity_id, details) {
  const entry = { id: Date.now().toString() + Math.random().toString(36).slice(2, 8), project_id: projectId, ts: Date.now(), action, entity, entity_id, details: details || null };
  await dbPut('audit_log', entry);
}
