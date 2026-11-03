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
const { default: Header } = await vite.ssrLoadModule('/src/ui/Header.jsx');
test.after(() => vite.close());

const doc = { kind: 'pdf', chunks: [{ id: 'c1', page: 2, text: 'Photosynthesis turns light into sugar.' }, { id: 'c2', page: 3, text: 'Chlorophyll absorbs light.' }] };
const steps = [
  { id: 's1', title: 'Light', objective: 'o1', chunkIds: ['c1', 'c2'], checkQuestion: 'Why light?', expected: ['the secret key point'] },
  { id: 's2', title: 'Sugar', objective: 'o2', chunkIds: ['c2'], checkQuestion: 'Why sugar?', expected: ['p'] },
];
const received = {
  type: 'planReceived', plan: { title: 'A lesson', steps, validated: true }, coverage: 'full', coverageNote: '', documentLanguage: 'Hebrew',
  constraints: { language: 'English', audience: null, style: null, minutes: null, steps: null, outsideSources: false, maxSteps: 5 },
};
let planEvent = received; // a test may swap the plan before mounting
const settings = { preset: 'gemini', apiKey: 'k', teacher: 'm' };

// App's choice of screen: the plan until the lesson starts, then the chat. The header shows the step chip.
function Host(props) {
  const [lesson, dispatch] = React.useReducer(reduce, undefined, () => [{ type: 'fileRead', source: doc }, planEvent].reduce(reduce, initialLesson()));
  return React.createElement(React.Fragment, null, React.createElement(Header, { lesson }), lesson.progress
    ? React.createElement(Lesson, { ...props, lesson, dispatch })
    : React.createElement(PlanLesson, { ...props, lesson, dispatch, saveCount: 0 }));
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

async function mount(steps) {
  planEvent = steps ? { ...received, plan: { title: 'A lesson', steps, validated: true } } : received;
  const teach = []; // one per /api/teach request: { body, headers, stream }
  const cancelled = [];
  const evaluate = []; // one per /api/evaluate request: { body, headers, answer(evaluation), fail(code, status) }
  globalThis.fetch = async (url, init) => {
    if (url === '/api/evaluate') {
      return new Promise((resolve) => evaluate.push({
        body: JSON.parse(init.body), headers: init.headers,
        answer: (evaluation, extra = {}) => resolve(Response.json({ evaluation: evaluation && { relevantChunkIds: [], ...evaluation }, ...extra })),
        fail: (code, status = 502) => resolve(Response.json({ code }, { status })),
      }));
    }
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
  let openedSettings = 0;
  const render = (nextSettings = settings, saveCount = 0) => act(async () => root.render(React.createElement(Host, { settings: nextSettings, saveCount, openSettings() { openedSettings++; } })));
  await render();
  const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const tick = () => new Promise((r) => setImmediate(r)); // not setTimeout, which a test may mock
  const click = (label) => act(async () => { button(label).dispatchEvent(new window.Event('click', { bubbles: true })); await tick(); });
  const feed = (fn) => act(async () => { fn(); await tick(); });
  const composer = () => container.querySelector('#answer');
  // Typing into the controlled textarea. React loads before this fake DOM exists, so it does not wire up input
  // events here; the textarea's own change handler is called with the new value instead.
  const type = (value) => act(async () => {
    const props = composer()[Object.keys(composer()).find((k) => k.startsWith('__reactProps$'))];
    props.onChange({ target: { value } });
    await tick();
  });
  // Waiting keeps the composer focusable (read-only); after a reveal and on the done screen it is disabled.
  const locked = () => composer().hasAttribute('readOnly') || composer().hasAttribute('disabled');
  const key = (init) => act(async () => { composer()[Object.keys(composer()).find((k) => k.startsWith('__reactProps$'))].onKeyDown({ preventDefault() {}, nativeEvent: {}, ...init }); await tick(); });
  return { container, teach, evaluate, cancelled, button, click, feed, type, key, locked, composer, render, openedSettings: () => openedSettings, text: () => container.textContent, unmount: () => act(() => root.unmount()) };
}

test('a restored in-progress lesson can check its old questions and regenerate a usable fallback', async () => {
  const started = [ { type: 'fileRead', source: doc }, received, { type: 'lessonStarted' }, { type: 'teachStarted', stepId: 's1', transition: 'opening', chunkIds: ['c1'] }, { type: 'teachDone' } ].reduce(reduce, initialLesson());
  const initial = { ...started, plan: { ...started.plan, validated: false } };
  let sent;
  globalThis.fetch = async (url, init) => {
    if (url === '/api/plan/check') return Response.json({ flagged: [] });
    if (url === '/api/teach') { sent = JSON.parse(init.body); return new Response('event: done\ndata: {}\n\n'); }
    throw new Error(`unexpected request ${url}`);
  };
  function Restored() {
    const [lesson, dispatch] = React.useReducer(reduce, initial);
    return React.createElement(Lesson, { lesson, dispatch, settings, saveCount: 0, openSettings() {} });
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Restored)));
  const click = async (label) => act(async () => { [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label).click(); await new Promise(r => setTimeout(r, 0)); });
  assert.match(container.textContent, /unchecked questions/);
  await click('Check questions');
  assert.doesNotMatch(container.textContent, /unchecked questions/);
  await click('Regenerate');
  assert.equal(sent.questionValidated, true);
  await act(() => root.unmount());
});

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
  assert.deepEqual(body.protectedPoints, ['the secret key point']);
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

test('leaving the page stops the reply in flight, as Stop does; hiding the tab does not', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.feed(() => { ui.teach[0].stream.start('id-1'); ui.teach[0].stream.text('Plants '); });
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  await ui.feed(() => document.dispatchEvent(new window.Event('visibilitychange')));
  delete document.visibilityState;
  assert.deepEqual(ui.cancelled, []);
  assert.ok(ui.button('Stop'), 'a hidden tab keeps its reply');
  await ui.feed(() => window.dispatchEvent(new window.Event('pagehide')));
  assert.deepEqual(ui.cancelled, ['id-1']);
  assert.match(ui.text(), /Stopped/); // what a page restored from the back-forward cache shows
  assert.ok(ui.button('Regenerate'));
  await ui.unmount();
});

test('leaving the page before the stream is named stops it, and cancels it if the id still arrives', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.feed(() => window.dispatchEvent(new window.Event('pagehide')));
  assert.deepEqual(ui.cancelled, []);
  assert.match(ui.text(), /Stopped/);
  await ui.feed(() => ui.teach[0].stream.start('id-late'));
  assert.deepEqual(ui.cancelled, ['id-late']);
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

// Answering. Start, let the opening finish, then send answers; each evaluation and reply is fed by hand.
async function opened(steps) {
  const ui = await mount(steps);
  await ui.click('Start');
  await ui.feed(() => { const s = ui.teach[0].stream; s.start('id-0'); s.text('Plants eat light.'); s.done(); });
  return ui;
}
const reply = (ui, n, text = 'Reply.') => ui.feed(() => { const s = ui.teach[n].stream; s.start(`id-${n}`); s.text(text); s.done(); });
// Types an answer, sends it, and returns the evaluate request it caused.
async function send(ui, text) {
  const before = ui.evaluate.length;
  await ui.type(text);
  await ui.click('Send');
  assert.equal(ui.evaluate.length, before + 1);
  return ui.evaluate[before];
}
const wrong = { intent: 'answer', keyPointsMet: [] };
const right = { intent: 'answer', keyPointsMet: [0] };

test('the composer waits for the opening reply, and Send needs text', async () => {
  const ui = await mount();
  await ui.click('Start');
  assert.equal(ui.locked(), true);
  await ui.feed(() => { const s = ui.teach[0].stream; s.start('id-0'); s.text('Hi.'); s.done(); });
  assert.equal(ui.locked(), false);
  assert.equal(ui.button('Send').disabled, true);
  await ui.type('   ');
  assert.equal(ui.button('Send').disabled, true);
  await ui.type('light');
  assert.equal(ui.button('Send').disabled, false);
  await ui.unmount();
});

test('an answer sends evaluate, shows thinking, then streams the teach reply; a correct one advances to step 2', async () => {
  const ui = await opened();
  const call = await send(ui, '  it is sugar  ');
  assert.equal(call.headers['X-Api-Key'], 'k');
  assert.equal(call.body.message, 'it is sugar'); // trimmed
  assert.deepEqual(call.body.earlier, []);
  assert.equal(call.body.lastTutor, 'Plants eat light.');
  assert.deepEqual(call.body.step, { objective: 'o1', checkQuestion: 'Why light?', expected: ['the secret key point'] });
  assert.deepEqual(call.body.chunks.map((c) => c.id), ['c1', 'c2']);
  assert.match(ui.text(), /it is sugar/); // the student's message is in the transcript
  assert.match(ui.text(), /Reading your answer…/);
  assert.equal(ui.composer().value, '');
  assert.equal(ui.locked(), true);
  assert.equal(ui.teach.length, 1, 'no teach request before the evaluation arrives');
  assert.match(ui.text(), /Step 1 of 2/);
  await ui.feed(() => call.answer(right));
  assert.equal(ui.teach.length, 2);
  const { body, headers } = ui.teach[1];
  assert.equal(headers['X-Api-Key'], 'k');
  assert.equal(body.transition, 'advance');
  assert.deepEqual(body.step, { index: 2, total: 2, title: 'Sugar', objective: 'o2', checkQuestion: 'Why sugar?' });
  assert.deepEqual(body.chunks.map((c) => c.id), ['c2']);
  assert.deepEqual(body.answered, { title: 'Light', checkQuestion: 'Why light?', expected: ['the secret key point'], pointsMet: [0] });
  assert.match(ui.text(), /Step 2 of 2/); // applied before the reply streams
  await reply(ui, 1, 'Right! Now sugar.');
  assert.match(ui.text(), /Right! Now sugar\./);
  assert.match(ui.text(), /Source: page 3/); // no chunk ids from the evaluator: the next step's own
  assert.equal(ui.locked(), false);
  await ui.unmount();
});

test('the tutor message cites all passages supplied to the teacher', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.answer({ ...wrong, relevantChunkIds: ['c1'] }));
  await reply(ui, 1);
  assert.match(ui.container.querySelectorAll('li')[2].textContent, /Source: pages 2, 3/);
  const next = await send(ui, 'sugar again');
  await ui.feed(() => next.answer({ ...right, relevantChunkIds: ['c1'] }));
  assert.equal(ui.teach[2].body.transition, 'advance');
  await reply(ui, 2);
  const sources = [...ui.container.querySelectorAll('li')].map((li) => /Source: (.*)$/.exec(li.querySelector('summary')?.textContent ?? '')?.[1]);
  assert.equal(sources.at(-1), 'page 3'); // the next step's chunks, not the evaluator's id for the previous step
  await ui.click('Regenerate');
  await reply(ui, 3);
  assert.equal([...ui.container.querySelectorAll('li')].at(-1).textContent.includes('Source: page 3'), true);
  await ui.unmount();
});

test('a material question cites every passage supplied to the teacher', async () => {
  const ui = await opened();
  const call = await send(ui, 'What is chlorophyll?');
  await ui.feed(() => call.answer({ intent: 'question', keyPointsMet: [], relevantChunkIds: ['c2'] }));
  assert.deepEqual(ui.teach[1].body.chunks.map((chunk) => chunk.id), ['c1', 'c2']);
  await reply(ui, 1);
  assert.match(ui.container.querySelectorAll('li')[2].textContent, /Source: pages 2, 3/);
  await ui.unmount();
});

test('the composer counts live; over 1,000 characters Send is disabled and the text is kept', async () => {
  const ui = await opened();
  await ui.type('x'.repeat(1000));
  assert.match(ui.text(), /1000 \/ 1000/);
  assert.equal(ui.button('Send').disabled, false);
  await ui.type('x'.repeat(1001));
  assert.match(ui.text(), /1001 \/ 1000/);
  assert.equal(ui.button('Send').disabled, true);
  assert.equal(ui.composer().value.length, 1001);
  await ui.click('Send');
  assert.equal(ui.evaluate.length, 0);
  assert.equal(ui.composer().value.length, 1001);
  await ui.unmount();
});

test('two wrong answers: a nudge, then a reveal with all points; Continue opens step 2', async () => {
  const ui = await opened();
  const first = await send(ui, 'x');
  await ui.feed(() => first.answer(wrong));
  assert.equal(ui.teach[1].body.transition, 'nudge');
  assert.match(first.headers['X-Turn-Id'], /^[0-9a-f-]{36}$/);
  assert.equal(ui.teach[1].headers['X-Turn-Id'], first.headers['X-Turn-Id']);
  assert.deepEqual(ui.teach[1].body.answered.pointsMet, []);
  await reply(ui, 1, 'Think about light.');
  assert.equal(ui.button('Continue'), undefined);
  const second = await send(ui, 'y');
  assert.notEqual(second.headers['X-Turn-Id'], first.headers['X-Turn-Id']);
  assert.deepEqual(second.body.earlier, ['x'], 'earlier answers on the step travel with the next one');
  await ui.feed(() => second.answer(wrong));
  assert.equal(ui.teach[2].body.transition, 'reveal');
  assert.match(ui.text(), /Step 1 of 2/); // a reveal stays on its step until Continue
  await reply(ui, 2, 'The answer is X.');
  assert.equal(ui.composer().disabled, true);
  await ui.click('Continue');
  assert.equal(ui.teach.length, 4);
  assert.equal(ui.teach[3].body.transition, 'opening');
  assert.equal(ui.teach[3].body.step.index, 2);
  assert.ok(!JSON.stringify(ui.teach[3].body).includes('secret key point'), 'an opening carries no key points');
  assert.match(ui.text(), /Step 2 of 2/);
  assert.equal(ui.button('Continue'), undefined);
  await reply(ui, 3, 'Sugar now.');
  assert.equal(ui.locked(), false);
  await ui.unmount();
});

test('a correct answer on the last step is followed by a recap of mastered and revealed steps', async () => {
  const ui = await opened();
  const first = await send(ui, 'x');
  await ui.feed(() => first.answer(wrong));
  await reply(ui, 1);
  const second = await send(ui, 'y');
  await ui.feed(() => second.answer(wrong));
  await reply(ui, 2);
  await ui.click('Continue');
  await reply(ui, 3);
  const last = await send(ui, 'p');
  await ui.feed(() => last.answer(right));
  const { body } = ui.teach[4];
  assert.equal(body.transition, 'recap');
  assert.deepEqual(body.recap, { mastered: ['Sugar'], revealed: ['Light'] });
  assert.deepEqual(body.answered, { title: 'Sugar', checkQuestion: 'Why sugar?', expected: ['p'], pointsMet: [0] });
  await reply(ui, 4, 'Well done.');
  assert.match(ui.text(), /Well done\./);
  assert.match(ui.text(), /Step 2 of 2/);
  assert.equal(ui.locked(), true);
  await ui.unmount();
});

test('a reveal on the last step is followed by Continue, which asks for a recap with no answer to confirm', async () => {
  const ui = await opened();
  const a = await send(ui, 'a');
  await ui.feed(() => a.answer(right));
  await reply(ui, 1);
  const b = await send(ui, 'x');
  await ui.feed(() => b.answer(wrong));
  await reply(ui, 2);
  const c = await send(ui, 'y');
  await ui.feed(() => c.answer(wrong));
  assert.equal(ui.teach[3].body.transition, 'reveal');
  await reply(ui, 3);
  await ui.click('Continue');
  const { body } = ui.teach[4];
  assert.equal(body.transition, 'recap');
  assert.deepEqual(body.recap, { mastered: ['Light'], revealed: ['Sugar'] });
  assert.equal(body.answered, undefined);
  await reply(ui, 4);
  assert.equal(ui.button('Continue'), undefined);
  await ui.unmount();
});

test('Stop on the reply after an evaluation keeps the step the evaluation moved to', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.answer(right));
  await ui.feed(() => { ui.teach[1].stream.start('id-1'); ui.teach[1].stream.text('Right'); });
  await ui.click('Stop');
  assert.match(ui.text(), /Stopped/);
  assert.match(ui.text(), /Step 2 of 2/);
  await ui.click('Regenerate');
  assert.equal(ui.teach[2].body.transition, 'advance');
  assert.deepEqual(ui.teach[2].body.step, ui.teach[1].body.step);
  assert.deepEqual(ui.teach[2].body.answered, ui.teach[1].body.answered);
  await ui.unmount();
});

test('an evaluation that fails keeps the answer, shows the error and Retry evaluates the same message again', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.fail('rate_limited', 429));
  assert.match(ui.text(), /rate-limiting/);
  assert.match(ui.text(), /sugar/);
  assert.equal(ui.teach.length, 1);
  assert.equal(ui.locked(), true); // the answer waits for its evaluation
  await ui.click('Retry');
  assert.equal(ui.evaluate.length, 2);
  assert.equal(ui.evaluate[1].body.message, 'sugar');
  assert.deepEqual(ui.evaluate[1].body.earlier, []);
  await ui.feed(() => ui.evaluate[1].answer(right));
  assert.equal(ui.teach.length, 2);
  assert.ok(!ui.text().includes('rate-limiting'));
  assert.equal(ui.container.querySelectorAll('li').length, 3); // opening, the answer once, the reply
  await ui.unmount();
});

test('a rate limit already retried by evaluation is passed to teaching, whose error offers Retry', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.answer(right, { rateLimitRetried: true }));
  assert.equal(ui.teach[1].body.rateLimitRetried, true);
  await ui.feed(() => { ui.teach[1].stream.start('id-1'); ui.teach[1].stream.fail('rate_limited'); });
  assert.match(ui.text(), /rate-limiting/);
  assert.ok(ui.button('Retry'));
  await ui.unmount();
});

test('a rejected evaluator key opens Settings and saving a new key retries the same answer', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.fail('invalid_key', 401));
  assert.equal(ui.openedSettings(), 1);
  await ui.render({ ...settings, apiKey: 'new-key' }, 1);
  assert.equal(ui.evaluate[1].headers['X-Api-Key'], 'new-key');
  assert.equal(ui.evaluate[1].body.message, 'sugar');
  await ui.unmount();
});

test('a rejected teacher key opens Settings and saving a new key retries the reply', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.feed(() => { ui.teach[0].stream.start('id-0'); ui.teach[0].stream.fail('invalid_key'); });
  assert.equal(ui.openedSettings(), 1);
  await ui.render({ ...settings, apiKey: 'new-key' }, 1);
  assert.equal(ui.teach[1].headers['X-Api-Key'], 'new-key');
  assert.equal(ui.teach[1].body.transition, 'opening');
  await ui.unmount();
});

test('a key changed during evaluation ends the turn with Retry', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.render({ ...settings, apiKey: 'new-key' }, 1);
  await ui.feed(() => call.fail('invalid_key', 401));
  assert.equal(ui.openedSettings(), 0);
  assert.equal(ui.evaluate.length, 1);
  assert.ok(ui.button('Retry'));
  await ui.click('Retry');
  assert.equal(ui.evaluate[1].headers['X-Api-Key'], 'new-key');
  assert.equal(ui.evaluate[1].body.message, 'sugar');
  await ui.unmount();
});

test('a key changed during teaching ends the turn with Retry', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.render({ ...settings, apiKey: 'new-key' }, 1);
  await ui.feed(() => { ui.teach[0].stream.start('id-0'); ui.teach[0].stream.fail('invalid_key'); });
  assert.equal(ui.openedSettings(), 0);
  assert.equal(ui.teach.length, 1);
  assert.ok(ui.button('Retry'));
  await ui.click('Retry');
  assert.equal(ui.teach[1].headers['X-Api-Key'], 'new-key');
  await ui.unmount();
});

test('asking for the answer starts a scaffold and leaves the step active', async () => {
  const ui = await opened();
  const call = await send(ui, 'what is the answer?');
  await ui.feed(() => call.answer({ intent: 'asks_for_answer', keyPointsMet: [] }));
  assert.equal(ui.teach.length, 2);
  assert.equal(ui.teach[1].body.transition, 'scaffold');
  assert.match(ui.text(), /Step 1 of 2/);
  await reply(ui, 1, 'Try this.');
  assert.equal(ui.locked(), false);
  await ui.unmount();
});

// Repeating a reply (Regenerate, Retry) keeps the answered step, its met points and its history.
const twoPoints = [
  { id: 's1', title: 'Light', objective: 'o1', chunkIds: ['c1', 'c2'], checkQuestion: 'Why light?', expected: ['alpha', 'beta'] },
  { id: 's2', title: 'Sugar', objective: 'o2', chunkIds: ['c2'], checkQuestion: 'Why sugar?', expected: ['p'] },
];
const partial = { intent: 'answer', keyPointsMet: [0] };
const both = { intent: 'answer', keyPointsMet: [0, 1] };

test('Regenerate and Retry on a nudge keep the answered step, its met points and the conversation', async () => {
  const ui = await opened(twoPoints);
  const call = await send(ui, 'alpha only');
  await ui.feed(() => call.answer(partial));
  const first = ui.teach[1].body;
  assert.equal(first.transition, 'nudge');
  assert.deepEqual(first.answered, { title: 'Light', checkQuestion: 'Why light?', expected: ['alpha', 'beta'], pointsMet: [0] });
  assert.deepEqual(first.history, [{ role: 'tutor', text: 'Plants eat light.' }, { role: 'student', text: 'alpha only' }]);
  await reply(ui, 1, 'Hint one.');
  await ui.click('Regenerate');
  assert.deepEqual(ui.teach[2].body.answered, first.answered);
  assert.deepEqual(ui.teach[2].body.history, first.history); // the reply being regenerated is not its own history
  await ui.feed(() => { ui.teach[2].stream.start('id-2'); ui.teach[2].stream.fail('rate_limited'); });
  await ui.click('Retry');
  assert.equal(ui.teach[3].body.transition, 'nudge');
  assert.deepEqual(ui.teach[3].body.answered, first.answered);
  await ui.unmount();
});

test('a second nudge carries the first nudge and both answers as history, at most 8 turns', async () => {
  const ui = await opened(twoPoints);
  let n = 0;
  for (const text of ['one', 'two', 'three', 'four']) {
    const call = await send(ui, text);
    await ui.feed(() => call.answer(n++ ? { intent: 'answer', keyPointsMet: [] } : partial));
    if (ui.teach.at(-1).body.transition === 'reveal') break;
    await reply(ui, ui.teach.length - 1, `Hint ${text}.`);
  }
  const bodies = ui.teach.map((t) => t.body).filter((b) => b.transition === 'nudge');
  assert.deepEqual(bodies[1].history.map((m) => m.text), ['Plants eat light.', 'one', 'Hint one.', 'two']);
  assert.ok(bodies.every((b) => b.history.length <= 8));
  await ui.unmount();
});

test('Regenerate and Retry on an advance keep the answered step and all its points', async () => {
  const ui = await opened(twoPoints);
  const call = await send(ui, 'alpha and beta');
  await ui.feed(() => call.answer(both));
  const first = ui.teach[1].body;
  assert.equal(first.transition, 'advance');
  assert.deepEqual(first.answered.pointsMet, [0, 1]);
  await reply(ui, 1, 'Right.');
  await ui.click('Regenerate');
  assert.deepEqual(ui.teach[2].body.answered, first.answered);
  assert.deepEqual(ui.teach[2].body.step, first.step);
  await ui.feed(() => { ui.teach[2].stream.start('id-2'); ui.teach[2].stream.fail('unreachable'); });
  await ui.click('Retry');
  assert.deepEqual(ui.teach[3].body.answered, first.answered);
  assert.deepEqual(ui.teach[3].body.history, first.history);
  await ui.unmount();
});

test('the composer stays off after a failed reply, until Retry finishes it', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.feed(() => { const s = ui.teach[0].stream; s.start('id-0'); s.fail('unreachable'); });
  assert.equal(ui.locked(), true);
  await ui.click('Retry');
  await reply(ui, 1, 'Plants eat light.');
  assert.equal(ui.locked(), false);
  await ui.unmount();
});

test('only the tail of a long tutor reply goes to the evaluator', async () => {
  const ui = await mount();
  await ui.click('Start');
  const long = `${'a'.repeat(7000)} Why light?`;
  await reply(ui, 0, long);
  const call = await send(ui, 'sugar');
  assert.equal(call.body.lastTutor.length, 5000);
  assert.ok(call.body.lastTutor.endsWith('Why light?'));
  await ui.unmount();
});

test('a null evaluation streams an uncounted nudge citing the step', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.answer(null));
  assert.equal(ui.teach.length, 2);
  assert.equal(ui.teach[1].body.transition, 'nudge');
  assert.deepEqual(ui.teach[1].body.answered.pointsMet, []);
  assert.match(ui.text(), /Source: pages 2, 3/);
  await ui.unmount();
});

test('a rejected evaluator model names the evaluator, and a rejected request has its own message', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.fail('model_not_found', 404));
  assert.match(ui.text(), /evaluator model/);
  assert.ok(ui.button('Open Settings'));
  await ui.click('Retry');
  await ui.feed(() => ui.evaluate[1].fail('invalid_request', 400));
  assert.match(ui.text(), /server couldn't accept/);
  await ui.unmount();
});

// Tutor replies are Markdown with raw HTML off; student messages stay plain text.
const startedWith = async (text) => {
  const ui = await mount();
  await ui.click('Start');
  await reply(ui, 0, text);
  return ui;
};

test('bold and a quote in a tutor reply render as strong and blockquote', async () => {
  const ui = await startedWith('A **chloroplast** makes sugar.\n\n> Photosynthesis turns light into sugar.');
  assert.equal(ui.container.querySelector('strong').textContent, 'chloroplast');
  assert.equal(ui.container.querySelector('blockquote').textContent.trim(), 'Photosynthesis turns light into sugar.');
  assert.ok(!ui.text().includes('**'));
  await ui.unmount();
});

// The quote box's rule sits on the blockquote's inline-start side, so the blockquote needs the quote's own
// direction: dir="auto" would skip its paragraph (which sets its own dir) and fall back to left to right.
test('a quote takes the direction of its text', async () => {
  const ui = await startedWith('התשובה:\n\n> פוטוסינתזה הופכת אור לסוכר.\n\nThen:\n\n> Light becomes sugar.');
  const [hebrew, english] = ui.container.querySelectorAll('blockquote');
  assert.equal(hebrew.getAttribute('dir'), 'rtl');
  assert.equal(english.getAttribute('dir'), 'ltr');
  assert.ok(hebrew.className.includes('tutor-source-quote'));
  await ui.unmount();
});

test('HTML in a tutor reply is shown as text and creates no element', async () => {
  const ui = await startedWith('Look: <img src=x onerror=alert(1)> and <script>alert(2)</script> done.');
  assert.equal(ui.container.querySelector('img'), null);
  assert.equal(ui.container.querySelector('script'), null);
  assert.match(ui.text(), /<img src=x onerror=alert\(1\)>/);
  assert.match(ui.text(), /<script>alert\(2\)<\/script>/);
  await ui.unmount();
});

test('every block of a tutor reply has dir="auto", tables scroll inside the message and links are safe', async () => {
  const ui = await startedWith('First.\n\nSecond.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[docs](https://example.com)');
  const li = ui.container.querySelector('ol > li');
  const blocks = [...li.querySelectorAll('p, ul, ol, li, blockquote, table, th, td, pre, h3')].filter((el) => !el.closest('details'));
  assert.ok(blocks.length >= 5);
  for (const el of blocks) assert.equal(el.getAttribute('dir'), 'auto', el.tagName);
  assert.ok(li.querySelector('table').parentElement.className.includes('overflow-x-auto'));
  const a = li.querySelector('a');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(a.getAttribute('target'), '_blank');
  await ui.unmount();
});

test('a student message stays plain text', async () => {
  const ui = await opened();
  await send(ui, '**bold** <b>x</b>');
  assert.equal(ui.container.querySelector('strong'), null);
  assert.match(ui.text(), /\*\*bold\*\* <b>x<\/b>/);
  await ui.unmount();
});

// The list is not a live region; one visually hidden polite region gets each finished reply once.
const region = (ui) => ui.container.querySelector('[aria-live="polite"]');

test('the live region receives a streamed reply once, when it finishes', async () => {
  const ui = await mount();
  await ui.click('Start');
  const seen = []; // the region's text after every step: it must change exactly once
  const look = () => seen.push(region(ui).textContent.trim());
  assert.equal(ui.container.querySelectorAll('[aria-live]').length, 1);
  assert.equal(ui.container.querySelector('ol').getAttribute('aria-live'), null);
  look();
  assert.equal(ui.container.querySelector('ol > li').getAttribute('aria-busy'), 'true'); // waiting
  const { stream } = ui.teach[0];
  await ui.feed(() => { stream.start('id-1'); stream.text('Plants '); });
  look();
  assert.equal(ui.container.querySelector('ol > li').getAttribute('aria-busy'), 'true'); // streaming
  await ui.feed(() => { stream.text('eat **light**.'); });
  look();
  await ui.feed(() => stream.done());
  look();
  await ui.type('an unrelated render');
  look();
  assert.deepEqual(seen, ['', '', '', 'Plants eat light.', 'Plants eat light.']);
  assert.equal(ui.container.querySelector('ol > li').getAttribute('aria-busy'), 'false');
  await ui.unmount();
});

test('a reply restored as finished is not announced again', async () => {
  const started = [{ type: 'fileRead', source: doc }, received, { type: 'lessonStarted' }, { type: 'teachStarted', stepId: 's1', transition: 'opening', chunkIds: ['c1'] }, { type: 'teachChunk', text: 'Back again.' }, { type: 'teachDone' }].reduce(reduce, initialLesson());
  function Restored() {
    const [lesson, dispatch] = React.useReducer(reduce, started);
    return React.createElement(Lesson, { lesson, dispatch, settings, saveCount: 0, openSettings() {} });
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Restored)));
  assert.match(container.textContent, /Back again\./);
  assert.equal(container.querySelector('[aria-live="polite"]').textContent, '');
  await act(() => root.unmount());
});

test('an image in a tutor reply is dropped, so nothing loads from another site', async () => {
  const ui = await startedWith('See ![diagram](https://example.com/x.png) here.');
  assert.equal(ui.container.querySelector('img'), null);
  await ui.unmount();
});

test('a stopped reply is announced; a failed one is not', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.feed(() => { ui.teach[0].stream.start('id-1'); ui.teach[0].stream.text('Plants '); });
  await ui.click('Stop');
  assert.equal(region(ui).textContent.trim(), 'Plants');
  await ui.click('Regenerate');
  await ui.feed(() => { ui.teach[1].stream.start('id-2'); ui.teach[1].stream.text('Half'); ui.teach[1].stream.fail('rate_limited'); });
  assert.equal(region(ui).textContent.trim(), '');
  await ui.unmount();
});

// Waiting states. The status line names the stage; a protected reply is buffered by the server, so it appears whole.
const status = (ui) => ui.container.querySelector('[role="status"]').textContent;
const typing = (ui) => ui.container.querySelector('.typing-indicator');

test('Send reads the answer, then writes and checks the reply with a typing indicator, then shows it whole', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  assert.equal(status(ui), 'Reading your answer…');
  assert.ok(ui.button('Stop'), 'Stop is there while the answer is read');
  await ui.feed(() => call.answer(wrong));
  assert.equal(status(ui), 'Writing and checking the reply…');
  const pending = ui.container.querySelectorAll('li')[2];
  assert.equal(pending.getAttribute('aria-busy'), 'true');
  assert.ok(typing(ui));
  assert.ok(ui.button('Stop'));
  await ui.feed(() => { const s = ui.teach[1].stream; s.start('id-1'); s.text('Think about light, the whole reply.'); s.done(); });
  assert.equal(status(ui), '');
  assert.equal(typing(ui), null);
  assert.match(ui.text(), /Think about light, the whole reply\./);
  await ui.unmount();
});

test('a reveal is not checked, so its wait says only that it is writing', async () => {
  const ui = await opened();
  const first = await send(ui, 'x');
  await ui.feed(() => first.answer(wrong));
  await reply(ui, 1);
  const second = await send(ui, 'y');
  await ui.feed(() => second.answer(wrong));
  assert.equal(ui.teach[2].body.transition, 'reveal');
  assert.equal(status(ui), 'Writing the reply…');
  await ui.feed(() => { ui.teach[2].stream.start('id-2'); ui.teach[2].stream.text('The answer'); });
  assert.equal(status(ui), '', 'a reveal streams, so the text shows as it arrives');
  assert.match(ui.text(), /The answer/);
  await ui.unmount();
});

test('Stop while the answer is read puts it back in the composer, which stays usable', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.click('Stop');
  assert.equal(ui.composer().value, 'sugar');
  assert.equal(ui.locked(), false);
  assert.equal(ui.container.querySelectorAll('li').length, 1, 'the withdrawn answer leaves the transcript');
  assert.equal(status(ui), '');
  await ui.feed(() => call.answer(right)); // a late answer is ignored
  assert.equal(ui.teach.length, 1);
  assert.equal(ui.button('Send').disabled, false);
  await ui.unmount();
});

test('Stop while the reply is written and checked leaves the composer usable', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.answer(wrong));
  await ui.feed(() => ui.teach[1].stream.start('id-1'));
  await ui.click('Stop');
  assert.deepEqual(ui.cancelled, ['id-1']);
  assert.equal(status(ui), '');
  assert.equal(ui.locked(), false);
  await ui.type('light');
  assert.equal(ui.button('Send').disabled, false);
  await ui.unmount();
});

test('a first request with no answer after 3 seconds adds "Waking the server…"; a later slow one does not', async (t) => {
  const ui = await mount();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await ui.click('Start');
  await ui.feed(() => t.mock.timers.tick(2999));
  assert.doesNotMatch(status(ui), /Waking/);
  await ui.feed(() => t.mock.timers.tick(1));
  assert.equal(status(ui), 'Writing and checking the reply… Waking the server…');
  await ui.feed(() => ui.teach[0].stream.start('id-0'));
  assert.equal(status(ui), 'Writing and checking the reply…');
  await ui.feed(() => { ui.teach[0].stream.text('Hi.'); ui.teach[0].stream.done(); });
  await send(ui, 'sugar');
  await ui.feed(() => t.mock.timers.tick(5000));
  assert.equal(status(ui), 'Reading your answer…');
  t.mock.timers.reset();
  await ui.unmount();
});

test('offline disables Send and says so; back online re-enables it', async () => {
  const ui = await opened();
  await ui.type('light');
  await ui.feed(() => window.dispatchEvent(new window.Event('offline')));
  assert.equal(ui.button('Send').disabled, true);
  assert.match(status(ui), /You're offline/);
  await ui.feed(() => window.dispatchEvent(new window.Event('online')));
  assert.equal(ui.button('Send').disabled, false);
  assert.doesNotMatch(status(ui), /offline/);
  await ui.unmount();
});

test('Enter sends, Shift+Enter does not, and the composer keeps focus after Send', async () => {
  const ui = await opened();
  await ui.type('light');
  let focused = 0;
  ui.composer().focus = () => { focused++; }; // the fake DOM keeps no focus; count the call instead
  await ui.key({ key: 'Enter', shiftKey: true });
  assert.equal(ui.evaluate.length, 0);
  await ui.key({ key: 'Enter' });
  assert.equal(ui.evaluate.length, 1);
  assert.equal(ui.evaluate[0].body.message, 'light');
  assert.equal(focused, 1, 'focus returns to the composer after Send');
  await ui.unmount();
});

test('Continue is the primary button after a reveal, and the composer is off while it shows', async () => {
  const ui = await opened();
  const first = await send(ui, 'x');
  await ui.feed(() => first.answer(wrong));
  await reply(ui, 1);
  const second = await send(ui, 'y');
  await ui.feed(() => second.answer(wrong));
  await reply(ui, 2, 'The answer is X.');
  assert.match(ui.button('Continue').className, /btn-primary/);
  assert.equal(ui.composer().hasAttribute('disabled'), true);
  assert.match(ui.button('Regenerate').className, /btn-secondary/);
  await ui.unmount();
});

test('a server error counts as an answer, so the next wait does not say the server is waking', async (t) => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.fail('rate_limited', 429));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await ui.click('Retry');
  await ui.feed(() => t.mock.timers.tick(5000));
  assert.equal(status(ui), 'Reading your answer…');
  t.mock.timers.reset();
  await ui.unmount();
});

test('Retry and Regenerate are secondary buttons', async () => {
  const ui = await mount();
  await ui.click('Start');
  await ui.feed(() => { const s = ui.teach[0].stream; s.start('id-0'); s.fail('unreachable'); });
  assert.match(ui.button('Retry').className, /btn-secondary/);
  assert.equal(ui.container.querySelector('[role="alert"]').textContent.trim(), "Couldn't reach the model provider. Try again.");
  await ui.click('Retry');
  await reply(ui, 1);
  assert.match(ui.button('Regenerate').className, /btn-secondary/);
  await ui.unmount();
});
