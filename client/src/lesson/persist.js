// Saving the lesson in IndexedDB: one database, one store, one key. Native API, no library.
const DB = 'teach-me-this-file';
const STORE = 'lesson';
const KEY = 'current';

// Save after every change except a stream chunk: same step list, the reply being streamed grew.
export function shouldSave(prev, next) {
  if (prev === next) return false;
  const [a, b] = [prev.messages.at(-1), next.messages.at(-1)];
  const chunk = prev.messages.length === next.messages.length && a?.status === 'streaming' && b?.status === 'streaming'
    && prev.messages.slice(0, -1).every((m, i) => m === next.messages[i]) && prev.plan === next.plan && prev.progress === next.progress;
  return !chunk;
}

// One connection, opened on first use and reused. The memo resets if opening fails or the browser closes it,
// so a later call retries.
let dbPromise = null;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => { dbPromise = null; db.close(); };
      resolve(db);
    };
    req.onerror = req.onblocked = () => reject(req.error ?? new Error('IndexedDB blocked'));
  }).catch((error) => { dbPromise = null; throw error; });
  return dbPromise;
}

async function run(mode, op) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// Newest write wins: one write in flight and one pending. A new op replaces the pending one, so a burst of
// saves becomes two writes and order is kept. Callers of a replaced op settle with the op that replaced it.
export function createWriter(perform) {
  let inflight = false;
  let pending = null;
  function pump() {
    if (inflight || !pending) return;
    const { op, waiters } = pending;
    pending = null;
    inflight = true;
    perform(op).then(
      (v) => waiters.forEach((w) => w.res(v)),
      (e) => waiters.forEach((w) => w.rej(e)),
    ).finally(() => { inflight = false; pump(); });
  }
  return (op) => new Promise((res, rej) => {
    pending = { op, waiters: [...(pending?.waiters ?? []), { res, rej }] };
    pump();
  });
}

export const loadSaved = () => run('readonly', (s) => s.get(KEY));
const write = createWriter((op) => run('readwrite', (s) => (op.type === 'put' ? s.put(op.record, KEY) : s.delete(KEY))));
export const putSaved = (record) => write({ type: 'put', record });
export const clearSaved = () => write({ type: 'clear' });