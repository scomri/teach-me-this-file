import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanError, estimatedMinutes, requestPlan, sourcePages } from './plan.js';

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
