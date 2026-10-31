import { splitSaved, joinSaved } from './lesson.js';
// Saving the lesson in IndexedDB: one database, one store, two keys (the file, and the rest of the lesson). Native API, no library.
const DB = 'teach-me-this-file';
const STORE = 'lesson';
const KEY = 'current';
const SOURCE_KEY = 'source';

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

// Newest write wins: one write in flight and one pending. A new op replaces the pending one (merged by
// `merge`), so a burst of saves becomes two writes and order is kept. Callers of a replaced op settle with
// the op that replaced it.
export function createWriter(perform, merge = (_, next) => next) {
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
    pending = { op: merge(pending?.op, op), waiters: [...(pending?.waiters ?? []), { res, rej }] };
    pump();
  });
}

// The lesson is two records, the file and the rest. The file is written only when it changed.
let lastSource = null; // the file last handed to storage (or loaded)

export function writeOp(lesson, last) {
  const { main, source } = splitSaved(lesson);
  return { type: 'put', main, source, writeSource: source !== last };
}

// A replaced put must not drop its file write: the merged op writes the file if either did. A put after a
// clear has no file on disk to rely on.
export function coalesce(prev, next) {
  if (next.type === 'clear') return next;
  return { ...next, writeSource: next.writeSource || prev?.type === 'clear' || (prev?.type === 'put' && prev.writeSource) };
}

const perform = (op) => run('readwrite', (s) => {
  if (op.type === 'clear') { s.delete(SOURCE_KEY); return s.delete(KEY); }
  if (op.writeSource) { if (op.source == null) s.delete(SOURCE_KEY); else s.put(op.source, SOURCE_KEY); }
  return s.put(op.main, KEY);
});
const write = createWriter(perform, coalesce);

// Both records are read in one transaction, so they come from the same moment.
export async function loadSaved() {
  const [main, source] = await run('readonly', (s) => {
    const m = s.get(KEY);
    const f = s.get(SOURCE_KEY);
    return { get result() { return [m.result, f.result]; } };
  });
  lastSource = source ?? null;
  return joinSaved(main, source);
}
export const putSaved = (lesson) => {
  const op = writeOp(lesson, lastSource);
  lastSource = op.source;
  return write(op);
};
export const clearSaved = () => {
  lastSource = null;
  return write({ type: 'clear' });
};