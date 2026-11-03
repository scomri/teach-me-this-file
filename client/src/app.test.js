import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import React, { act } from 'react';

// Mounts the App in a fake DOM. saved: the IndexedDB records the App loads at startup ({ current, source }).
async function mount(t, saved = null) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  document.oninput = null;
  const { createRoot } = await import('react-dom/client');
  window.HTMLElement.prototype.showModal = function () {};
  window.HTMLElement.prototype.close = function () {};
  globalThis.fetch = async () => Response.json({ ok: true });
  // ponytail: just enough IndexedDB for loadSaved and later writes
  globalThis.indexedDB = saved && { open: () => {
    const store = { get: (key) => ({ result: saved[key] }), put: () => ({}), delete: () => ({}) };
    const db = { transaction: () => { const tx = { objectStore: () => store }; setTimeout(() => tx.oncomplete()); return tx; } };
    const req = { result: db };
    setTimeout(() => req.onsuccess());
    return req;
  } };
  t.after(() => { delete globalThis.indexedDB; });
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), plugins: [react()], appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' });
  t.after(() => vite.close());
  const { default: App } = await vite.ssrLoadModule('/src/App.jsx');
  const container = document.getElementById('root');
  const root = createRoot(container);
  t.after(() => act(() => root.unmount()));
  await act(async () => root.render(React.createElement(App)));
  await act(() => new Promise((r) => setTimeout(r, 20))); // the saved lesson loads
  return container;
}

test('the lesson screen has no echo demo or API status line', async (t) => {
  const container = await mount(t);
  assert.equal(container.querySelector('textarea'), null);
  assert.ok(![...container.querySelectorAll('button')].some((b) => ['Send', 'Stop'].includes(b.textContent)));
  assert.doesNotMatch(container.textContent, /API:/);
  assert.match(container.textContent, /Teach Me This File/);
});

test('a lesson in progress has no file picker, and names its file and keeps the damaged-text warning', async (t) => {
  const { initialLesson, reduce, splitSaved } = await import('./lesson/lesson.js');
  const doc = { kind: 'txt', name: 'water.txt', damaged: true, chunks: [{ id: 'c1', page: null, text: 'Water boils at 100 �.' }] };
  const plan = { title: 'Water', steps: [{ id: 's1', title: 'Boiling', objective: 'o', chunkIds: ['c1'], checkQuestion: 'q?', expected: ['p'] }] };
  let lesson = initialLesson();
  for (const e of [{ type: 'fileRead', source: doc }, { type: 'planReceived', plan, constraints: { maxSteps: 5 } }, { type: 'planValidated' }, { type: 'lessonStarted' }]) lesson = reduce(lesson, e);
  const { main, source } = splitSaved(lesson);
  const container = await mount(t, { current: main, source });
  assert.equal(container.querySelector('input[type=file]'), null);
  assert.match(container.textContent, /water\.txt/);
  assert.match(container.textContent, /may be damaged or missing/);
});
