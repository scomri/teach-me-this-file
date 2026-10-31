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

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = req.onblocked = () => reject(req.error ?? new Error('IndexedDB blocked'));
  });
}

async function run(mode, op) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export const loadSaved = () => run('readonly', (s) => s.get(KEY));
// Writes go one after another, so an older save can never land after a newer one.
let queue = Promise.resolve();
const write = (op) => (queue = queue.catch(() => {}).then(() => run('readwrite', op)));
export const putSaved = (record) => write((s) => s.put(record, KEY));
export const clearSaved = () => write((s) => s.delete(KEY));
