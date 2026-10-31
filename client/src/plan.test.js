import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanError, estimatedMinutes, requestNotes, requestPlan, sourcePages } from './plan.js';

const doc = {
  kind: 'pdf',
  chunks: [{ id: 'c1', page: 3, pageLabel: 'iii', text: 'שלום' }, { id: 'c2', page: 1, pageLabel: '1', text: 'x' }, { id: 'c3', page: null, text: 'y' }],
};
const settings = { preset: 'gemini', apiKey: 'k', teacher: 'm' };

test('sourcePages lists unique pages in order, by the document unit', () => {
  assert.equal(sourcePages({ chunkIds: ['c1', 'c2', 'c1'] }, doc), 'pages 1, iii');
  assert.equal(sourcePages({ chunkIds: ['c2'] }, doc), 'page 1');
  assert.equal(sourcePages({ chunkIds: ['c3'] }, doc), '');
  assert.equal(sourcePages({ chunkIds: ['c2'] }, { ...doc, kind: 'pptx' }), 'slide 1');
});

test('requestPlan sends chunks with the key header and maps failures to codes', async () => {
  let sent;
  const ok = async (url, init) => { sent = { url, init, body: JSON.parse(init.body) }; return Response.json({ plan: { title: 'T', steps: [] }, constraints: {} }); };
  assert.equal((await requestPlan({ doc, prompt: 'p', settings }, ok)).plan.title, 'T');
  assert.equal(sent.url, '/api/plan');
  assert.equal(sent.init.headers['X-Api-Key'], 'k');
  assert.equal(sent.body.script, 'hebrew');
  assert.deepEqual(sent.body.chunks[0], { id: 'c1', page: 3, text: 'שלום' });

  await assert.rejects(requestPlan({ doc, prompt: '', settings }, async () => Response.json({ code: 'invalid_key' }, { status: 401 })), { code: 'invalid_key' });
  await assert.rejects(requestPlan({ doc, prompt: '', settings }, async () => new Response('<html>', { status: 502 })), { code: 'unreachable' });
  await assert.rejects(requestPlan({ doc, prompt: '', settings }, async () => { throw new TypeError('offline'); }), { code: 'unreachable' });
  await assert.rejects(requestPlan({ doc: { ...doc, chunks: [{ id: 'c1', page: 1, text: 'x'.repeat(100_001) }] }, prompt: '', settings }, ok), { code: 'document_too_long' });
});

test('an abort while the body is read is an abort, and an empty 200 is not a plan', async () => {
  const ac = new AbortController();
  const aborted = async () => ({ ok: true, json: async () => { ac.abort(); throw new DOMException('aborted', 'AbortError'); } });
  await assert.rejects(requestPlan({ doc, prompt: '', settings, signal: ac.signal }, aborted), { name: 'AbortError' });
  await assert.rejects(requestPlan({ doc, prompt: '', settings }, async () => Response.json({})), { code: 'plan_invalid' });
  await assert.rejects(requestPlan({ doc, prompt: '', settings }, async () => Response.json({ plan: {} })), { code: 'plan_invalid' });
});

test('estimated length is steps times 2.5 minutes, rounded', () => {
  assert.equal(estimatedMinutes({ steps: new Array(6) }), 15);
  assert.equal(estimatedMinutes({ steps: new Array(5) }), 13);
});

test('requestPlan sends wholeFile only when asked, and accepts a coverage-none reply without a plan', async () => {
  let sent;
  const reply = (body) => async (url, init) => { sent = JSON.parse(init.body); return Response.json(body); };
  const none = { plan: null, constraints: { maxSteps: 5 }, coverage: 'none', coverageNote: 'About biology.' };
  const full = { plan: { steps: [] }, constraints: {}, coverage: 'full', coverageNote: '' };

  const first = await requestPlan({ doc, prompt: 'teach WWII', settings }, reply(none));
  assert.deepEqual([first.plan, first.coverage, first.coverageNote], [null, 'none', 'About biology.']);
  assert.ok(!('wholeFile' in sent));
  assert.equal(sent.prompt, 'teach WWII');

  await requestPlan({ doc, prompt: 'teach WWII', settings, wholeFile: true }, reply(full));
  assert.equal(sent.wholeFile, true);
  assert.equal(sent.prompt, 'teach WWII'); // constraints are still read from the prompt

  await requestPlan({ doc, prompt: '', settings }, reply(full));
  assert.equal(sent.prompt, ''); // an empty prompt is sent as is: the server applies the defaults
  assert.ok(!('wholeFile' in sent));

  await assert.rejects(requestPlan({ doc, prompt: '', settings }, reply({ plan: null, constraints: {}, coverage: 'full' })), { code: 'plan_invalid' });
});

test('request notes: capped, shorter, steps capped, outside sources', () => {
  const plan = (n) => ({ steps: new Array(n) });
  const c = (minutes, maxSteps, extra) => ({ minutes, maxSteps, steps: null, outsideSources: false, ...extra });
  const notes = (n, constraints) => requestNotes(plan(n), constraints);
  assert.deepEqual(notes(10, c(45, 10)), ['45 min requested, capped at 10 steps (~25 min)']);
  assert.deepEqual(notes(4, c(25, 10)), ['This file supports 4 steps (~10 min), shorter than the 25 min requested']);
  assert.equal(notes(1, c(25, 10))[0], 'This file supports 1 step (~3 min), shorter than the 25 min requested');
  // Clamped and the file supports fewer steps than the ceiling: the shorter note says it all.
  assert.deepEqual(notes(8, c(45, 10)), ['This file supports 8 steps (~20 min), shorter than the 45 min requested']);
  // A short request has a short ceiling and no floor note: 5 min allows 2 steps, 1 min allows 1.
  assert.deepEqual(notes(2, c(5, 2)), []);
  assert.deepEqual(notes(1, c(1, 1)), []);
  // An explicit step count above the ceiling is capped; within it, no note.
  assert.deepEqual(notes(5, c(null, 5, { steps: 20 })), ['20 steps requested, capped at 5 steps (~13 min)']);
  assert.deepEqual(notes(5, c(null, 5, { steps: 5 })), []);
  assert.deepEqual(notes(10, c(45, 10, { steps: 20 })).length, 2);
  // Outside sources are never used, and the screen says so.
  assert.deepEqual(notes(5, c(null, 5, { outsideSources: true })), ['Outside sources were requested. The lesson teaches only from the file.']);
  // No notes: nothing stated, an exact fit, or the ceiling reached exactly.
  assert.deepEqual(notes(5, c(null, 5)), []);
  assert.deepEqual(notes(6, c(15, 6)), []);
  assert.deepEqual(notes(10, c(25, 10)), []);
  assert.deepEqual(notes(5, { minutes: null, maxSteps: 5 }), []); // a reply from before these fields existed
});
