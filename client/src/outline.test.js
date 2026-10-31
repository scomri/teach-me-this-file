import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOC_CHARS } from '../../shared/limits.js';
import { PRESETS } from '../../shared/presets.js';
import { buildOutline, estimateTokens, planBudget, planInput } from './outline.js';
import { requestPlan } from './plan.js';

const chunk = (n, over = {}) => ({ id: `c${n}`, page: null, pageLabel: null, heading: null, text: `Text of chunk ${n}`, ...over });
const many = (n, over) => Array.from({ length: n }, (_, i) => chunk(i + 1, typeof over === 'function' ? over(i) : over));

test('the token estimate uses the ratio of the detected script', () => {
  assert.equal(estimateTokens(1000, 'latin'), 300);
  assert.equal(estimateTokens(1000, 'arabic'), 450);
  assert.equal(estimateTokens(1000, 'hebrew'), 850);
  assert.equal(estimateTokens(1000, 'other'), 850);
});

test('every preset has a positive budget below its tokens per minute', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.ok(planBudget(name) > 0 && planBudget(name) < preset.tpm, name);
  }
});

test('the full text is sent while it fits the budget, an outline otherwise', () => {
  const doc = [chunk(1, { text: 'x'.repeat(1000) })];
  const need = estimateTokens(1000 + 40, 'latin'); // the text plus the chunk wrapper
  assert.deepEqual(planInput(doc, 'latin', need).chunks, [{ id: 'c1', page: null, text: 'x'.repeat(1000) }]);
  const over = planInput(doc, 'latin', need - 1);
  assert.equal(over.chunks, undefined);
  assert.deepEqual(over.chunkIds, ['c1']);
  assert.equal(over.outline.length, 1);

  // The same characters cost more in Hebrew: 24,000 characters exceed an 8,000-token budget.
  assert.ok(planInput([chunk(1, { text: 'ש'.repeat(24_000) })], 'hebrew', 8000).outline);
  assert.ok(planInput([chunk(1, { text: 'a'.repeat(24_000) })], 'latin', 8000).chunks);
});

test('a document over the character ceiling is outlined even when the budget would allow it', () => {
  assert.ok(60 * 1500 <= MAX_DOC_CHARS && 70 * 1500 > MAX_DOC_CHARS);
  const doc = many(70, { text: 'x'.repeat(1500) });
  assert.ok(planInput(doc, 'latin', 10_000_000).outline);
  assert.ok(planInput(doc.slice(0, 60), 'latin', 10_000_000).chunks);
});

test('the outline has one entry per heading, with the id range, page and opening text', () => {
  const doc = [
    chunk(1, { page: 1, heading: 'Intro', text: '# Intro\n\nWelcome   to\nthe book.' }),
    chunk(2, { page: 1, heading: 'Intro', text: 'More intro.' }),
    chunk(3, { page: 2, heading: 'Cells', text: '## Cells\n' + 'y'.repeat(300) }),
    chunk(4, { page: 3, heading: 'Cells', text: 'Mitochondria.' }),
    chunk(5, { page: 3, heading: 'DNA', text: 'Helix.' }),
  ];
  assert.deepEqual(buildOutline(doc, 'latin', 100_000), [
    { first: 'c1', last: 'c2', page: 1, heading: 'Intro', text: 'Welcome to the book.' },
    { first: 'c3', last: 'c4', page: 2, heading: 'Cells', text: 'y'.repeat(150) },
    { first: 'c5', last: 'c5', page: 3, heading: 'DNA', text: 'Helix.' },
  ]);
});

test('without headings the outline has one entry per page, and without pages even groups of chunks', () => {
  const pages = buildOutline(many(6, (i) => ({ page: Math.floor(i / 2) + 1 })), 'latin', 100_000);
  assert.deepEqual(pages.map((e) => [e.first, e.last, e.page, e.heading]), [['c1', 'c2', 1, ''], ['c3', 'c4', 2, ''], ['c5', 'c6', 3, '']]);

  const groups = buildOutline(many(12), 'latin', 100_000);
  assert.deepEqual(groups.map((e) => [e.first, e.last, e.page]), [['c1', 'c5', null], ['c6', 'c10', null], ['c11', 'c12', null]]);
});

test('entries are shortened until the outline fits the budget, and always cover the whole document', () => {
  const doc = many(900, (i) => ({ page: i + 1, heading: `Heading number ${i + 1}`, text: 'z'.repeat(400) }));
  const cost = (entries) => estimateTokens(entries.reduce((n, e) => n + 80 + e.heading.length + e.text.length, 0), 'hebrew');
  const full = buildOutline(doc, 'hebrew', 10_000_000);
  assert.equal(full.length, 900);
  for (const budget of [20_000, 2_000, 300]) {
    const out = buildOutline(doc, 'hebrew', budget);
    assert.ok(cost(out) <= budget, `budget ${budget}`);
    assert.equal(out[0].first, 'c1');
    assert.equal(out.at(-1).last, 'c900');
    out.slice(1).forEach((e, i) => assert.equal(Number(e.first.slice(1)), Number(out[i].last.slice(1)) + 1)); // no gaps, no overlaps
  }
});

test('an outline also stays within the route character cap, for headings, pages and groups', () => {
  const heads = many(2000, (i) => ({ page: i + 1, heading: 'H'.repeat(90) + i, text: 'z'.repeat(400) }));
  const pages = many(4000, (i) => ({ page: i + 1, text: 'z'.repeat(400) }));
  const groups = many(20_000, { text: 'z'.repeat(400) });
  for (const doc of [heads, pages, groups]) {
    const out = buildOutline(doc, 'latin', 10_000_000);
    assert.ok(out.reduce((n, e) => n + e.heading.length + e.text.length, 0) <= MAX_DOC_CHARS);
    assert.equal(out[0].first, 'c1');
    assert.equal(out.at(-1).last, doc.at(-1).id);
  }
});

const settings = { preset: 'anthropic', apiKey: 'k', teacher: 'm' };
const ok = (seen) => async (url, init) => { seen.body = JSON.parse(init.body); return Response.json({ plan: { title: 'T', steps: [] }, constraints: {} }); };

test('a long document is sent as an outline with every chunk id', async () => {
  const doc = { kind: 'pdf', chunks: Array.from({ length: 200 }, (_, i) => ({ id: `c${i + 1}`, page: i + 1, heading: `H${i + 1}`, text: 'שלום '.repeat(300) })) };
  const seen = {};
  await requestPlan({ doc, prompt: 'chapter 5', settings }, ok(seen));
  assert.equal(seen.body.chunks, undefined);
  assert.equal(seen.body.chunkIds.length, 200);
  assert.equal(seen.body.outline[0].first, 'c1');
  assert.equal(seen.body.outline.at(-1).last, 'c200');
  assert.ok(seen.body.outline.every((e) => e.text.length <= 150));
});

test('a short document is still sent whole', async () => {
  const seen = {};
  await requestPlan({ doc: { kind: 'txt', chunks: [chunk(1)] }, prompt: '', settings }, ok(seen));
  assert.equal(seen.body.outline, undefined);
  assert.deepEqual(seen.body.chunks, [{ id: 'c1', page: null, text: 'Text of chunk 1' }]);
});

test('a 413 becomes document_too_long, with or without the route own body', async () => {
  const doc = { kind: 'txt', chunks: [chunk(1)] };
  const tooLarge = (body) => async () => new Response(body, { status: 413 });
  await assert.rejects(requestPlan({ doc, prompt: '', settings }, tooLarge('{"code":"document_too_long"}')), { code: 'document_too_long' });
  await assert.rejects(requestPlan({ doc, prompt: '', settings }, tooLarge('{"error":"request_too_large"}')), { code: 'document_too_long' });
  await assert.rejects(requestPlan({ doc, prompt: '', settings }, tooLarge('<html>')), { code: 'document_too_long' });
});
