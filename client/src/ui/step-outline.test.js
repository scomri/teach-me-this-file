import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { initialLesson, reduce } from '../lesson/lesson.js';

// The header and the step outline read lesson state. The components are the real ones (compiled by Vite).
const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
globalThis.HTMLElement = window.HTMLElement;
const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)), plugins: [react()], appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' });
const { default: StepOutline, WIDE } = await vite.ssrLoadModule('/src/ui/StepOutline.jsx');
const { default: Header } = await vite.ssrLoadModule('/src/ui/Header.jsx');
test.after(() => vite.close());

const doc = { kind: 'txt', chunks: [{ id: 'c1', text: 'Some text.' }] };
const step = (id, title) => ({ id, title, objective: 'o', chunkIds: ['c1'], checkQuestion: 'q', expected: ['p'] });
const planned = [
  { type: 'fileRead', source: doc },
  { type: 'planReceived', plan: { title: 'A lesson', steps: [step('s1', 'Light'), step('s2', 'Sugar'), step('s3', 'Water'), step('s4', 'Air')], validated: true }, coverage: 'full', coverageNote: '' },
].reduce(reduce, initialLesson());
const started = reduce(planned, { type: 'lessonStarted' });
// Step 1 mastered, step 2 revealed, step 3 current, step 4 not reached.
const midway = {
  ...started,
  progress: { current: 's3', steps: { ...started.progress.steps, s1: { ...started.progress.steps.s1, status: 'mastered' }, s2: { ...started.progress.steps.s2, status: 'revealed' }, s3: { ...started.progress.steps.s3, status: 'active' } } },
};

async function render(element) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, unmount: () => act(() => root.unmount()) };
}

test('below the wide breakpoint the outline is a disclosure whose summary is the progress bar', async () => {
  const { container, unmount } = await render(React.createElement(StepOutline, { lesson: midway }));
  const items = [...container.querySelectorAll('li')];
  assert.deepEqual(items.map((li) => li.textContent), ['LightStep 1 · Mastered', 'SugarStep 2 · Answer shown', 'WaterStep 3 · Current', 'AirStep 4 · Upcoming']);
  assert.deepEqual(items.map((li) => li.getAttribute('aria-current')), [null, null, 'step', null]);
  const summary = container.querySelector('details > summary');
  assert.match(summary.textContent, /2 of 4 done/);
  const segments = [...summary.querySelectorAll('[data-status]')].map((s) => s.dataset.status);
  assert.deepEqual(segments, ['mastered', 'revealed', 'active', 'pending']);
  assert.equal(container.querySelector('aside'), null);
  await unmount();
});

test('at the wide breakpoint the outline is an aside with no progress bar', async () => {
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  try {
    const { container, unmount } = await render(React.createElement(StepOutline, { lesson: midway }));
    assert.ok(container.querySelector('aside'));
    assert.equal(container.querySelector('details'), null);
    assert.equal(container.querySelector('li[aria-current="step"]').textContent, 'WaterStep 3 · Current');
    await unmount();
  } finally {
    delete window.matchMedia;
  }
});

test('the outline switches shape at the same width as the md breakpoint in index.css', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  assert.equal(WIDE, `(min-width: ${css.match(/--breakpoint-md:\s*([^;]+);/)[1]})`);
});

test('the header shows the step chip during a lesson, and New lesson when there is something to discard', async () => {
  let asked = 0;
  const lesson = await render(React.createElement(Header, { lesson: midway, onNewLesson() { asked++; } }));
  assert.match(lesson.container.textContent, /Teach Me This File/);
  assert.match(lesson.container.textContent, /Step 3 of 4/);
  const newLesson = [...lesson.container.querySelectorAll('button')].find((b) => b.textContent === 'New lesson');
  await act(async () => newLesson.click());
  assert.equal(asked, 1);
  await lesson.unmount();

  const setup = await render(React.createElement(Header, { lesson: planned }));
  assert.doesNotMatch(setup.container.textContent, /Step \d/);
  assert.equal(setup.container.querySelector('button'), null);
  await setup.unmount();
});
