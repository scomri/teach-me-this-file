import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { initialLesson, reduce } from '../lesson/lesson.js';

// The start of a lesson in a fake DOM: Start on the plan screen, the streamed opening reply, Stop,
// Regenerate and Retry. The components are the real ones (compiled by Vite); fetch is stubbed.
const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
globalThis.HTMLElement = window.HTMLElement;
const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)), plugins: [react()], appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' });
const { default: PlanLesson } = await vite.ssrLoadModule('/src/ui/PlanLesson.jsx');
const { default: Lesson } = await vite.ssrLoadModule('/src/ui/Lesson.jsx');
test.after(() => vite.close());

const doc = { kind: 'pdf', chunks: [{ id: 'c1', page: 2, text: 'Photosynthesis turns light into sugar.' }, { id: 'c2', page: 3, text: 'Chlorophyll absorbs light.' }] };
const steps = [
  { id: 's1', title: 'Light', objective: 'o1', chunkIds: ['c1', 'c2'], checkQuestion: 'Why light?', expected: ['the secret key point'] },
  { id: 's2', title: 'Sugar', objective: 'o2', chunkIds: ['c2'], checkQuestion: 'Why sugar?', expected: ['p'] },
];
const received = {
  type: 'planReceived', plan: { title: 'A lesson', steps }, coverage: 'full', coverageNote: '', documentLanguage: 'Hebrew',
  constraints: { language: 'English', audience: null, style: null, minutes: null, steps: null, outsideSources: false, maxSteps: 5 },
};
const settings = { preset: 'gemini', apiKey: 'k', teacher: 'm' };

// App's choice of screen: the plan until the lesson starts, then the chat.
function Host(props) {
  const [lesson, dispatch] = React.useReducer(reduce, undefined, () => [{ type: 'fileRead', source: doc }, received].reduce(reduce, initialLesson()));
  return lesson.progress
    ? React.createElement(Lesson, { ...props, lesson, dispatch })
    : React.createElement(PlanLesson, { ...props, lesson, dispatch, saveCount: 0 });
}

// A teach response the test feeds by hand. Aborting the request errors it, as fetch does.
function liveStream(signal) {
  const enc = new TextEncoder();
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
  const send = (s) => controller.enqueue(enc.encode(s));
  return {
    response: new Response(body, { status: 200 }),
    start: (id) => send(`event: start\ndata: ${JSON.stringify({ id })}\n\n`),
    text: (t) => send(`data: ${JSON.stringify({ text: t })}\n\n`),
    done: () => { send('event: done\ndata: {}\n\n'); controller.close(); },
    close: () => controller.close(),
    fail: (error) => { send(`event: error\ndata: ${JSON.stringify({ error })}\n\n`); controller.close(); },
  };
}

async function mount() {
  const teach = []; // one per /api/teach request: { body, headers, stream }
  const cancelled = [];
  globalThis.fetch = async (url, init) => {
    if (url === '/api/teach') {
      const stream = liveStream(init.signal);
      teach.push({ body: JSON.parse(init.body), headers: init.headers, stream });
      return stream.response;
    }
    const cancel = /^\/api\/streams\/(.+)\/cancel$/.exec(url);
    if (cancel) { cancelled.push(cancel[1]); return new Response(null, { status: 204 }); }
    throw new Error(`unexpected request ${url}`);
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Host, { settings, openSettings() {} })));
  const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const click = (label) => act(async () => { button(label).dispatchEvent(new window.Event('click', { bubbles: true })); await tick(); });
  const feed = (fn) => act(async () => { fn(); await tick(); });
  return { container, teach, cancelled, button, click, feed, text: () => container.textContent, unmount: () => act(() => root.unmount()) };
}

test('Start is enabled on a plan and sends an opening request built from the step, with the key in a header', async () => {
  const ui = await mount();
  assert.equal(ui.button('Start').disabled, false);
  await ui.click('Start');
  assert.equal(ui.teach.length, 1);
  const { body, headers } = ui.teach[0];
  assert.equal(headers['X-Api-Key'], 'k');
  assert.equal(body.transition, 'opening');
  assert.deepEqual(body.step, { index: 1, total: 2, title: 'Light', objective: 'o1', checkQuestion: 'Why light?' });
  assert.deepEqual(body.chunks.map((c) => c.id), ['c1', 'c2']);
  assert.equal(body.lesson.language, 'English');
  assert.equal(body.lesson.documentLanguage, 'Hebrew');
  assert.ok(!JSON.stringify(body).includes('the secret key point'), 'an opening request carries no key points');
  assert.match(ui.text(), /Step 1 of 2/);
  await ui.unmount();
});

test('the reply streams in, then shows its source pages; Stop is only there while it streams', async () => {
  const ui = await mount();
  await ui.click('Start');
  const { stream } = ui.teach[0];
  assert.ok(ui.button('Stop'));
  assert.equal(ui.button('Regenerate'), undefined);
  await ui.feed(() => { stream.start('id-1'); stream.text('Plants '); });
  assert.match(ui.text(), /Plants/);
  await ui.feed(() => { stream.text('eat light.'); stream.done(); });
  assert.match(ui.text(), /Plants eat light\./);
  assert.match(ui.text(), /Source: pages 2, 3/);
  assert.equal(ui.button('Stop'), undefined);
  assert.ok(ui.button('Regenerate'));
  await ui.unmount();
});

test('Stop sends the cancel request, aborts the stream and keeps the partial text', async () => {
  const ui = await mount();
  await ui.click('Start');
  const { stream } = ui.teach[0];
  await ui.feed(() => { stream.start('id-1'); stream.text('Plants '); });
  await ui.click('Stop');
  assert.deepEqual(ui.cancelled, ['id-1']);
  assert.match(ui.text(), /Plants/);
  assert.match(ui.text(), /Stopped/);
  assert.equal(ui.button('Stop'), undefined);
  assert.match(ui.text(), /Step 1 of 2/); // progress untouched
  assert.ok(ui.button('Regenerate'));
  await ui.unmount();
});

test('Stop before the stream is named cancels it once the id arrives', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.click('Stop');
  assert.deepEqual(ui.cancelled, []);
  await ui.feed(() => ui.teach[0].stream.start('id-early'));
  assert.deepEqual(ui.cancelled, ['id-early']);
  assert.match(ui.text(), /Stopped/);
  await ui.unmount();
});

test('Regenerate sends a teach request with the same transition and replaces the reply', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.feed(() => { const s = ui.teach[0].stream; s.start('id-1'); s.text('First reply.'); s.done(); });
  await ui.click('Regenerate');
  assert.equal(ui.teach.length, 2);
  assert.equal(ui.teach[1].body.transition, 'opening');
  assert.deepEqual(ui.teach[1].body.step, ui.teach[0].body.step);
  assert.ok(!ui.text().includes('First reply.'), 'the old reply is gone while the new one streams');
  await ui.feed(() => { const s = ui.teach[1].stream; s.start('id-2'); s.text('Second reply.'); s.done(); });
  assert.match(ui.text(), /Second reply\./);
  assert.ok(!ui.text().includes('First reply.'));
  assert.equal(ui.container.querySelectorAll('li').length, 1);
  await ui.unmount();
});

test('a reply that fails mid-stream keeps its text and offers Retry for the same transition', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.feed(() => { const s = ui.teach[0].stream; s.start('id-1'); s.text('Plants '); s.fail('rate_limited'); });
  assert.match(ui.text(), /Plants/);
  assert.match(ui.text(), /rate-limiting/);
  assert.equal(ui.button('Regenerate'), undefined);
  await ui.click('Retry');
  assert.equal(ui.teach.length, 2);
  assert.equal(ui.teach[1].body.transition, 'opening');
  await ui.feed(() => { const s = ui.teach[1].stream; s.start('id-2'); s.text('Better.'); s.done(); });
  assert.match(ui.text(), /Better\./);
  assert.ok(!ui.text().includes('rate-limiting'));
  await ui.unmount();
});

test('a connection that closes without done is a failed reply', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.feed(() => { const s = ui.teach[0].stream; s.start('id-1'); s.text('Plants '); s.close(); });
  assert.match(ui.text(), /Plants/);
  assert.match(ui.text(), /reach the model provider/);
  assert.ok(ui.button('Retry'));
  await ui.unmount();
});

test('the composer stays disabled until answers are supported', async () => {
  const ui = await mount();
  await ui.click('Start');
  assert.equal(ui.container.querySelector('#answer').disabled, true);
  await ui.unmount();
});
