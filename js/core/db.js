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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

export async function dbGet(store, key) {
  const s = await tx(store);
  return new Promise((res, rej) => { const r = s.get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function dbPut(store, value) {
  const s = await tx(store, 'readwrite');
  return new Promise((res, rej) => { const r = s.put(value); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function dbBulkPut(store, values) {
  if (!values.length) return 0;
  const s = await tx(store, 'readwrite');
  return new Promise((res, rej) => {
    let done = 0, failed = false;
    for (const v of values) {
      const r = s.put(v);
      r.onsuccess = () => { done++; if (done === values.length && !failed) res(done); };
      r.onerror = () => { failed = true; rej(r.error); };
    }
  });
}

export async function dbDelete(store, key) {
  const s = await tx(store, 'readwrite');
  return new Promise((res, rej) => { const r = s.delete(key); r.onsuccess = () => res(true); r.onerror = () => rej(r.error); });
}

export async function dbAll(store, indexName = null, query = null) {
  const s = await tx(store);
  return new Promise((res, rej) => {
    const src = indexName ? s.index(indexName) : s;
    const r = query != null ? src.getAll(query) : src.getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

export async function dbByIndex(store, indexName, value) {
  return dbAll(store, indexName, value);
}

export async function auditLog(projectId, action, entity, entity_id, details) {
  const entry = { id: Date.now().toString() + Math.random().toString(36).slice(2,6), project_id: projectId, ts: Date.now(), action, entity, entity_id, details: details || null };
  await dbPut('audit_log', entry);
}