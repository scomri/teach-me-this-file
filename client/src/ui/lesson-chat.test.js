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
let planEvent = received; // a test may swap the plan before mounting
const settings = { preset: 'gemini', apiKey: 'k', teacher: 'm' };

// App's choice of screen: the plan until the lesson starts, then the chat.
function Host(props) {
  const [lesson, dispatch] = React.useReducer(reduce, undefined, () => [{ type: 'fileRead', source: doc }, planEvent].reduce(reduce, initialLesson()));
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

async function mount(steps) {
  planEvent = steps ? { ...received, plan: { title: 'A lesson', steps } } : received;
  const teach = []; // one per /api/teach request: { body, headers, stream }
  const cancelled = [];
  const evaluate = []; // one per /api/evaluate request: { body, headers, answer(evaluation), fail(code, status) }
  globalThis.fetch = async (url, init) => {
    if (url === '/api/evaluate') {
      return new Promise((resolve) => evaluate.push({
        body: JSON.parse(init.body), headers: init.headers,
        answer: (evaluation) => resolve(Response.json({ evaluation: evaluation && { relevantChunkIds: [], ...evaluation } })),
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
  await act(async () => root.render(React.createElement(Host, { settings, openSettings() {} })));
  const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const tick = () => new Promise((r) => setTimeout(r, 0));
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
  return { container, teach, evaluate, cancelled, button, click, feed, type, composer, text: () => container.textContent, unmount: () => act(() => root.unmount()) };
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
  assert.equal(ui.composer().disabled, true);
  await ui.feed(() => { const s = ui.teach[0].stream; s.start('id-0'); s.text('Hi.'); s.done(); });
  assert.equal(ui.composer().disabled, false);
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
  assert.match(ui.text(), /Thinking/);
  assert.equal(ui.composer().value, '');
  assert.equal(ui.composer().disabled, true);
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
  assert.equal(ui.composer().disabled, false);
  await ui.unmount();
});

test('the tutor message cites the evaluator\'s chunk ids when it named any', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.answer({ ...wrong, relevantChunkIds: ['c1'] }));
  await reply(ui, 1);
  assert.match(ui.text(), /Source: page 2(?!,)/);
  const next = await send(ui, 'sugar again');
  await ui.feed(() => next.answer({ ...right, relevantChunkIds: ['c1'] }));
  assert.equal(ui.teach[2].body.transition, 'advance');
  await reply(ui, 2);
  const sources = [...ui.container.querySelectorAll('li')].map((li) => /Source: (.*)$/.exec(li.textContent)?.[1]);
  assert.equal(sources.at(-1), 'page 3'); // the next step's chunks, not the evaluator's id for the previous step
  await ui.click('Regenerate');
  await reply(ui, 3);
  assert.equal([...ui.container.querySelectorAll('li')].at(-1).textContent.includes('Source: page 3'), true);
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
  assert.deepEqual(ui.teach[1].body.answered.pointsMet, []);
  await reply(ui, 1, 'Think about light.');
  assert.equal(ui.button('Continue'), undefined);
  const second = await send(ui, 'y');
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
  assert.equal(ui.composer().disabled, false);
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
  assert.equal(ui.composer().disabled, true);
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
  assert.equal(ui.composer().disabled, true); // the answer waits for its evaluation
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

test('a message that is not an answer gets no reply here and leaves the progress alone', async () => {
  const ui = await opened();
  const call = await send(ui, 'what is the answer?');
  await ui.feed(() => call.answer({ intent: 'asks_for_answer', keyPointsMet: [] }));
  assert.equal(ui.teach.length, 1);
  assert.match(ui.text(), /Step 1 of 2/);
  assert.equal(ui.composer().disabled, false);
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
  assert.equal(ui.composer().disabled, true);
  await ui.click('Retry');
  await reply(ui, 1, 'Plants eat light.');
  assert.equal(ui.composer().disabled, false);
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

test('an evaluation the server could not get (null) is an error with Retry, and no reply streams', async () => {
  const ui = await opened();
  const call = await send(ui, 'sugar');
  await ui.feed(() => call.answer(null));
  assert.match(ui.text(), /couldn't read that answer/);
  assert.equal(ui.teach.length, 1);
  assert.ok(ui.button('Retry'));
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
