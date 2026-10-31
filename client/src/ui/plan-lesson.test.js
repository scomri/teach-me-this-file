import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// The plan flow end to end in a fake DOM: stubbed model replies come back through a stubbed fetch,
// and the components are the real ones (compiled by Vite, as in the app).
const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
globalThis.HTMLElement = window.HTMLElement;
const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)), plugins: [react()], appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' });
const { default: PlanLesson } = await vite.ssrLoadModule('/src/ui/PlanLesson.jsx');
test.after(() => vite.close());

const doc = { kind: 'txt', chunks: [{ id: 'c1', page: null, text: 'Photosynthesis turns light into sugar.' }] };
const settings = { preset: 'gemini', apiKey: 'k', teacher: 'm' };
const step = (n) => ({ id: `s${n}`, title: `Step ${n}`, objective: 'o', chunkIds: ['c1'], checkQuestion: 'q?', expected: ['p'] });
const planOf = (n) => ({ title: 'A lesson', steps: Array.from({ length: n }, (_, i) => step(i + 1)) });
const constraints = (over = {}) => ({ language: 'English', audience: null, style: null, minutes: null, steps: null, outsideSources: false, maxSteps: 5, ...over });

async function mount(replies, { prompt = 'teach it' } = {}) {
  const sent = [];
  // A reply is a result body, or a function of the fetch init for a custom response (an error, a hanging request).
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); const r = replies.shift(); return typeof r === 'function' ? r(init) : Response.json(r); };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (p, saveCount = 0) => act(async () => root.render(React.createElement(PlanLesson, { doc, settings, saveCount, prompt: p, setPrompt() {}, openSettings() {} })));
  await render(prompt);
  const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const click = (label) => act(async () => { button(label).dispatchEvent(new window.Event('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
  return { container, sent, button, click, render, text: () => container.textContent, unmount: () => act(() => root.unmount()) };
}

test('an empty prompt can be planned: the request carries no prompt and no whole-file flag', async () => {
  const ui = await mount([{ plan: planOf(4), constraints: constraints(), coverage: 'full', coverageNote: '' }], { prompt: '' });
  assert.equal(ui.button('Plan').disabled, false);
  await ui.click('Plan');
  assert.equal(ui.sent.length, 1);
  assert.equal(ui.sent[0].prompt, '');
  assert.ok(!('wholeFile' in ui.sent[0]));
  assert.match(ui.text(), /4 steps/);
  assert.ok(!ui.text().includes('Not in the file'));
  await ui.unmount();
});

test('partial coverage shows what is not in the file above the plan', async () => {
  const ui = await mount([{ plan: planOf(3), constraints: constraints(), coverage: 'partial', coverageNote: 'the Krebs cycle' }]);
  await ui.click('Plan');
  assert.match(ui.text(), /Not in the file: the Krebs cycle/);
  assert.match(ui.text(), /3 steps/);
  await ui.unmount();
});

test('no coverage shows the message and no plan; Plan from whole file re-requests without the topic', async () => {
  const ui = await mount([
    { plan: null, constraints: constraints(), coverage: 'none', coverageNote: 'The file is about photosynthesis.' },
    { plan: planOf(4), constraints: constraints(), coverage: 'full', coverageNote: '' },
    { plan: planOf(4), constraints: constraints(), coverage: 'full', coverageNote: '' },
  ], { prompt: 'teach World War II' });
  await ui.click('Plan');
  assert.match(ui.text(), /doesn't cover your request/);
  assert.match(ui.text(), /The file is about photosynthesis\./);
  assert.ok(!ui.text().includes('Check question'));
  assert.ok(!ui.button('Regenerate'));
  assert.ok(!('wholeFile' in ui.sent[0]));

  await ui.click('Plan from whole file');
  assert.equal(ui.sent[1].wholeFile, true);
  assert.match(ui.text(), /4 steps/);
  assert.ok(!ui.text().includes("doesn't cover"));

  await ui.click('Regenerate'); // a regenerated whole-file plan stays a whole-file plan
  assert.equal(ui.sent[2].wholeFile, true);
  await ui.unmount();
});

test('length notes: capped at the ceiling, and shorter than the minutes asked for', async () => {
  const capped = await mount([{ plan: planOf(10), constraints: constraints({ minutes: 45, maxSteps: 10 }), coverage: 'full', coverageNote: '' }]);
  await capped.click('Plan');
  assert.match(capped.text(), /45 min requested, capped at 10 steps \(~25 min\)/);
  assert.ok(!capped.text().includes('supports'));
  await capped.unmount();

  const short = await mount([{ plan: planOf(4), constraints: constraints({ minutes: 25, maxSteps: 10 }), coverage: 'full', coverageNote: '' }]);
  await short.click('Plan');
  assert.match(short.text(), /This file supports 4 steps \(~10 min\), shorter than the 25 min requested/);
  assert.ok(!short.text().includes('capped'));
  await short.unmount();

  const exact = await mount([{ plan: planOf(6), constraints: constraints({ minutes: 15, maxSteps: 6 }), coverage: 'full', coverageNote: '' }]);
  await exact.click('Plan');
  assert.ok(!exact.text().includes('requested'));
  await exact.unmount();
});

test('Regenerate keeps a whole-file plan whole-file only while the prompt is unchanged', async () => {
  const full = { plan: planOf(4), constraints: constraints(), coverage: 'full', coverageNote: '' };
  const ui = await mount([
    { plan: null, constraints: constraints(), coverage: 'none', coverageNote: 'About biology.' }, full, full, full,
  ], { prompt: 'teach World War II' });
  await ui.click('Plan');
  await ui.click('Plan from whole file');
  await ui.click('Regenerate');
  assert.equal(ui.sent[2].wholeFile, true);

  await ui.render('teach photosynthesis'); // a new topic: it must not be dropped again
  await ui.click('Regenerate');
  assert.ok(!('wholeFile' in ui.sent[3]));
  assert.equal(ui.sent[3].prompt, 'teach photosynthesis');
  await ui.unmount();
});

const none = { plan: null, constraints: constraints(), coverage: 'none', coverageNote: 'About biology.' };
const full = { plan: planOf(4), constraints: constraints(), coverage: 'full', coverageNote: '' };

test('Plan from whole file repeats the request that found no coverage, not an edited prompt', async () => {
  const ui = await mount([none, full], { prompt: 'teach World War II in 10 minutes' });
  await ui.click('Plan');
  await ui.render('something else entirely');
  await ui.click('Plan from whole file');
  assert.equal(ui.sent[1].prompt, 'teach World War II in 10 minutes');
  assert.equal(ui.sent[1].wholeFile, true);
  await ui.unmount();
});

test('after no coverage: a rejected key replaces the message, and a saved key repeats the whole-file request', async () => {
  const rejected = () => Response.json({ code: 'invalid_key' }, { status: 401 });
  const ui = await mount([none, rejected, full], { prompt: 'teach World War II' });
  await ui.click('Plan');
  await ui.click('Plan from whole file');
  assert.match(ui.text(), /Your key was rejected/);
  assert.ok(!ui.text().includes("doesn't cover"));

  await ui.render('teach World War II', 1); // a new key was saved
  assert.equal(ui.sent.length, 3);
  assert.deepEqual([ui.sent[2].wholeFile, ui.sent[2].prompt], [true, 'teach World War II']);
  assert.match(ui.text(), /4 steps/);
  await ui.unmount();
});

test('cancelling a request made after no coverage keeps the message and its button', async () => {
  const hangs = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const ui = await mount([none, hangs]);
  await ui.click('Plan');
  await ui.click('Plan from whole file');
  assert.ok(ui.button('Cancel'));
  assert.ok(ui.button('Plan from whole file').disabled);
  await ui.click('Cancel');
  assert.match(ui.text(), /doesn't cover your request/);
  assert.equal(ui.button('Plan from whole file').disabled, false);
  assert.ok(!ui.button('Cancel'));
  await ui.unmount();
});

test('the plan screen says when a step count or outside sources were not followed', async () => {
  const asked = { plan: planOf(2), constraints: constraints({ minutes: 5, steps: 20, outsideSources: true, maxSteps: 2 }), coverage: 'full', coverageNote: '' };
  const ui = await mount([asked]);
  await ui.click('Plan');
  assert.match(ui.text(), /20 steps requested, capped at 2 steps \(~5 min\)/);
  assert.match(ui.text(), /Outside sources were requested\. The lesson teaches only from the file\./);
  await ui.unmount();
});

test('a provider that says the key has no credit gets its own message, not "couldn\'t reach"', async () => {
  const ui = await mount([() => Response.json({ code: 'out_of_credit' }, { status: 402 })]);
  await ui.click('Plan');
  assert.match(ui.text(), /doesn't have enough credit/);
  assert.ok(!ui.text().includes("Couldn't reach"));
  await ui.unmount();
});
