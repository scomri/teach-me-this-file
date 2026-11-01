// Opt-in end-to-end check against real providers. Not part of `npm test`: it needs a key and spends quota.
//
//   node --env-file=<env file> --test scripts/live-check.mjs
//
// Keys come from GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY. Gemini runs by default;
// LIVE_PRESETS=gemini,openrouter runs more. A preset without a key is skipped.
// The server runs in-process on a free port and the real client components drive it in a fake DOM, so a run
// covers the request shapes as the app builds them. Only what code controls is asserted; formatting that
// depends on the model is logged as an observation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp } from '../server/app.js';
import { PRESETS } from '../shared/presets.js';
import { ingestFile } from '../client/src/ingest/ingest.js';
import { initialLesson, reduce } from '../client/src/lesson/lesson.js';

const KEY_VARS = { gemini: 'GEMINI_API_KEY', openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
const presets = (process.env.LIVE_PRESETS ?? 'gemini').split(',').map((p) => p.trim()).filter(Boolean);
const WAIT_MS = Number(process.env.LIVE_WAIT_MS ?? 120_000);

const EN_TEXT = `# Photosynthesis

Plants make their own food through photosynthesis. Chlorophyll in the leaves absorbs sunlight.

The plant takes in carbon dioxide from the air and water from the soil. Using the energy of light, it turns them into glucose, a sugar it uses for energy and growth.

Oxygen is released as a by-product. This is why plants are important for the air animals breathe.`;
const HE_TEXT = `# מחזור המים

המים על פני כדור הארץ נעים במחזור קבוע. השמש מחממת את מי הים והאגמים, והמים מתאדים והופכים לאדים.

האדים עולים לשמיים, מתקררים ומתעבים לעננים. כשטיפות המים בענן גדלות, הן יורדות כגשם או כשלג.

מי הגשם זורמים בנהרות חזרה לים, או מחלחלים לאדמה ומזינים את מי התהום, וכך המחזור מתחיל מחדש.`;

// The fake DOM must exist before React and the components load.
const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
globalThis.HTMLElement = window.HTMLElement;

const logs = [];
const server = createApp({ log: (line) => logs.push(String(line)) }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const realFetch = globalThis.fetch;
// The client calls relative /api URLs, as in the browser.
globalThis.fetch = (url, init) => realFetch(new URL(url, base), init);

const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../client', import.meta.url)), plugins: [react()], appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' });
const { default: PlanLesson } = await vite.ssrLoadModule('/src/ui/PlanLesson.jsx');
const { default: Lesson } = await vite.ssrLoadModule('/src/ui/Lesson.jsx');

const summary = [];
const keys = [];
test.after(async () => {
  await vite.close();
  server.close();
  const width = (k) => Math.max(k.length, ...summary.map((r) => String(r[k]).length));
  const cols = ['preset', 'check', 'result', 'seconds', 'notes'];
  const line = (r) => cols.map((k) => String(r[k]).padEnd(width(k))).join(' | ');
  console.log('\n' + line(Object.fromEntries(cols.map((k) => [k, k]))) + '\n' + cols.map((k) => '-'.repeat(width(k))).join('-|-'));
  for (const r of summary) console.log(line(r));
  // The request logger must never see a key.
  for (const key of keys) assert.ok(!logs.some((l) => l.includes(key)), 'a key reached the request log');
});

async function timed(row, fn) {
  const started = Date.now();
  try {
    const notes = await fn();
    summary.push({ ...row, result: 'pass', seconds: ((Date.now() - started) / 1000).toFixed(1), notes: notes ?? '' });
  } catch (error) {
    summary.push({ ...row, result: 'FAIL', seconds: ((Date.now() - started) / 1000).toFixed(1), notes: error.message.split('\n')[0].slice(0, 80) });
    throw error;
  }
}

function Host({ doc, prompt, ...props }) {
  const [lesson, dispatch] = React.useReducer(reduce, undefined, () =>
    [{ type: 'fileRead', source: doc }, { type: 'promptChanged', prompt }].reduce(reduce, initialLesson()));
  return lesson.progress
    ? React.createElement(Lesson, { ...props, lesson, dispatch })
    : React.createElement(PlanLesson, { ...props, lesson, dispatch, saveCount: 0 });
}

async function mount(doc, prompt, settings) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Host, { doc, prompt, settings, openSettings() {} })));
  const tick = () => new Promise((r) => setTimeout(r, 50));
  const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const alert = () => container.querySelector('[role="alert"]')?.textContent;
  const click = (label) => act(async () => { button(label).dispatchEvent(new window.Event('click', { bubbles: true })); await tick(); });
  // Waits for a real provider round trip; an error alert ends the wait early with its text.
  const until = async (what, done) => {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const result = done();
      if (result) return result;
      if (alert()) throw new Error(`${what}: ${alert()}`);
      if (Date.now() > deadline) throw new Error(`${what}: timed out after ${WAIT_MS / 1000}s`);
      await act(tick);
    }
  };
  const composer = () => container.querySelector('#answer');
  const idle = () => composer() && !composer().disabled && !button('Stop') && !container.querySelector('[aria-busy="true"]');
  // React loaded before this fake DOM, so typing calls the textarea's change handler directly (as in the UI tests).
  const type = (value) => act(async () => {
    const props = composer()[Object.keys(composer()).find((k) => k.startsWith('__reactProps$'))];
    props.onChange({ target: { value } });
    await tick();
  });
  const tutorMessages = () => [...container.querySelectorAll('li')].filter((li) => !/^You/.test(li.textContent));
  // A tutor message also holds its Source passages in a <details>; measure the reply without them.
  const replyText = (li) => { const copy = li.cloneNode(true); copy.querySelectorAll('details').forEach((d) => d.remove()); return copy.textContent; };
  return { container, button, click, until, type, idle, tutorMessages, replyText, text: () => container.textContent, unmount: () => act(() => root.unmount()) };
}

// Model-dependent formatting: logged, never failed.
function observe(ui) {
  const replies = ui.tutorMessages();
  const raw = replies.filter((li) => /\*\*|^\s*>/m.test(ui.replyText(li))).length;
  const strong = ui.container.querySelectorAll('li strong').length;
  const quotes = ui.container.querySelectorAll('li blockquote').length;
  const auto = replies.every((li) => li.querySelector('[dir="auto"]'));
  return `replies ${replies.length}, raw markdown in ${raw}, strong ${strong}, quotes ${quotes}, dir=auto ${auto ? 'yes' : 'no'}`;
}

const hebrewLetters = (s) => (s.match(/[֐-׿]/g) ?? []).length;

async function send(ui, text) {
  await ui.type(text);
  await ui.click('Send');
  await ui.until(`reply to "${text}"`, () => ui.idle() || ui.button('Continue'));
}

async function startLesson(ui) {
  await ui.click('Plan');
  await ui.until('plan', () => ui.button('Check plan') || ui.button('Start'));
  assert.match(ui.text(), /\d+ steps?/);
  if (ui.button('Check plan')) {
    await ui.click('Check plan');
    await ui.until('plan check', () => ui.button('Start') && !ui.button('Start').disabled);
  }
  await ui.click('Start');
  await ui.until('opening reply', ui.idle);
  assert.ok(ui.replyText(ui.tutorMessages().at(-1)).trim(), 'opening reply is empty');
}

// One wrong answer, then asking for the answer until Continue appears.
async function reveal(ui, wrongAnswer) {
  await send(ui, wrongAnswer);
  assert.ok(!ui.button('Continue'), 'a wrong first answer must not reveal');
  for (let asks = 0; asks < 3 && !ui.button('Continue'); asks++) await send(ui, 'I give up, just tell me the answer.');
  assert.ok(ui.button('Continue'), 'asking for the answer twice reveals it');
}

for (const preset of presets) {
  const key = process.env[KEY_VARS[preset]]?.trim();
  const skip = !PRESETS[preset] ? `unknown preset ${preset}` : !key && `${KEY_VARS[preset]} is not set`;
  if (key) keys.push(key);
  const settings = { preset, apiKey: key, evaluator: PRESETS[preset]?.evaluator, teacher: PRESETS[preset]?.teacher };

  test(`${preset}: the key check reports ready`, { skip }, () => timed({ preset, check: 'key check' }, async () => {
    const response = await realFetch(`${base}/api/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
      body: JSON.stringify({ preset, evaluator: settings.evaluator, teacher: settings.teacher }),
    });
    const { code } = await response.json();
    assert.equal(code, 'ok', `check returned ${code}`);
  }));

  test(`${preset}: English file, plan to reveal through the real components`, { skip }, () => timed({ preset, check: 'en lesson' }, async () => {
    const doc = await ingestFile(new File([EN_TEXT], 'photosynthesis.md'));
    const ui = await mount(doc, 'Teach this in 5 minutes.', settings);
    try {
      await startLesson(ui);
      await reveal(ui, 'It is because the moon is made of cheese.');
      return observe(ui);
    } finally { await ui.unmount(); }
  }));

  test(`${preset}: Hebrew file taught in English, plan to reveal`, { skip }, () => timed({ preset, check: 'he lesson' }, async () => {
    const doc = await ingestFile(new File([HE_TEXT], 'water-cycle.txt'));
    const ui = await mount(doc, 'Teach this in English in 5 minutes.', settings);
    try {
      await startLesson(ui);
      const opening = ui.replyText(ui.tutorMessages().at(-1));
      await reveal(ui, 'Because the moon pulls the water up.');
      // The reveal should quote the Hebrew passage with an English translation; the rest stays English.
      const last = ui.tutorMessages().at(-1);
      const quote = [...last.querySelectorAll('blockquote')].map((b) => b.textContent).join(' ');
      const body = ui.replyText(last).replace(quote, '');
      return `${observe(ui)}, Hebrew letters: opening ${hebrewLetters(opening)}, reveal quote ${hebrewLetters(quote)} (Latin ${(quote.match(/[a-z]/gi) ?? []).length}), reveal outside quote ${hebrewLetters(body)}`;
    } finally { await ui.unmount(); }
  }));
}
