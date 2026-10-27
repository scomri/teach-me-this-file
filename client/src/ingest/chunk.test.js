import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages, normalize } from './chunk.js';

const page = (text, extra = {}) => ({ page: null, pageLabel: null, heading: null, text, ...extra });
const para = (n, ch = 'a') => ch.repeat(n);

test('normalize strips BOM, CRLF, trailing spaces and extra blank lines', () => {
  assert.equal(normalize('﻿one  \r\ntwo\r\n\r\n\r\n\r\nthree\t\n'), 'one\ntwo\n\nthree');
});

test('packs short paragraphs into one chunk up to the limit', () => {
  const { chunks } = chunkPages([page('first\n\nsecond\n\nthird')]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, 'first\n\nsecond\n\nthird');
});

test('starts a new chunk when the next paragraph would pass 1,500 chars', () => {
  const { chunks } = chunkPages([page(`${para(1000)}\n\n${para(600, 'b')}`)]);
  assert.deepEqual(chunks.map((c) => c.text.length), [1000, 600]);
});

test('splits a long paragraph at a sentence end', () => {
  const sentence = 'Plants turn light into sugar. ';
  const text = sentence.repeat(80).trim(); // ~2,400 chars, one paragraph
  const { chunks } = chunkPages([page(text)]);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.ok(c.text.length <= 1500);
    assert.ok(c.text.endsWith('sugar.'), 'each piece ends on a sentence');
  }
  assert.equal(chunks.map((c) => c.text).join(' '), text);
});

test('splits at whitespace when there is no sentence end, then hard', () => {
  const words = Array(400).fill('word').join(' '); // 1,999 chars, no punctuation
  const soft = chunkPages([page(words)]).chunks;
  assert.ok(soft.every((c) => c.text.length <= 1500 && !c.text.startsWith(' ')));
  assert.equal(soft.map((c) => c.text).join(' '), words);

  const hard = chunkPages([page(para(3200))]).chunks;
  assert.deepEqual(hard.map((c) => c.text.length), [1500, 1500, 200]);
});

test('chunks never cross pages and keep page and label', () => {
  const { chunks, totalPages } = chunkPages([
    page('one', { page: 1, pageLabel: 'i' }),
    page('two', { page: 2, pageLabel: '1' }),
  ]);
  assert.deepEqual(
    chunks.map(({ id, page, pageLabel, text }) => ({ id, page, pageLabel, text })),
    [
      { id: 'c1', page: 1, pageLabel: 'i', text: 'one' },
      { id: 'c2', page: 2, pageLabel: '1', text: 'two' },
    ],
  );
  assert.equal(totalPages, 2);
});

test('each chunk gets the heading in effect at its first paragraph', () => {
  const { chunks } = chunkPages([
    page(`intro\n\n# Photosynthesis\n\n${para(1490)}\n\n## Light reactions\n\nmore`, { heading: 'Slide title' }),
    page('next page', { heading: null }),
  ]);
  assert.deepEqual(chunks.map((c) => c.heading), ['Slide title', 'Photosynthesis', 'Light reactions', 'Light reactions']);
  assert.equal(chunks[0].text, 'intro\n\n# Photosynthesis');
});

test('a page heading replaces the carried one', () => {
  const { chunks } = chunkPages([page('# Old\n\ntext'), page('slide text', { heading: 'Slide 2' })]);
  assert.deepEqual(chunks.map((c) => c.heading), ['Old', 'Slide 2']);
});

test('drops empty pages and whitespace-only paragraphs, ids stay sequential', () => {
  const { chunks } = chunkPages([page('   \n\n  '), page('a\n\n\n\n   \n\nb'), page('c', { page: 3 })]);
  assert.deepEqual(chunks.map((c) => c.id), ['c1', 'c2']);
  assert.equal(chunks[0].text, 'a\n\nb');
});

test('keeps every page and reports totals', () => {
  const pages = [1, 2, 3].map((n) => page(`${para(1400)}\n\n${para(1400)}`, { page: n }));
  const r = chunkPages(pages);
  assert.equal(r.chunks.length, 6);
  assert.equal(r.totalChars, 3 * (2800 + 2));
  assert.equal(r.totalPages, 3);
});

test('text files report a null page count', () => {
  assert.equal(chunkPages([page('hello')]).totalPages, null);
});
