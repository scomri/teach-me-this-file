import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { htmlToText } from './dom-text.js';

// linkedom needs a full document; the browser's DOMParser accepts the same.
const text = (html) => htmlToText(new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html'));

test('headings, lists, tables and paragraphs in order', () => {
  assert.equal(
    text('<h1>A</h1><p>one <strong>two</strong></p><ul><li>x<ul><li>y</li></ul></li></ul><ol><li>p</li><li>q</li></ol>' +
      '<table><tr><td><p>a</p><p>b</p></td><td>c</td></tr><tr><td></td><td></td></tr></table><img src="x">'),
    '# A\n\none two\n\n- x\n  - y\n\n1. p\n2. q\n\na b | c',
  );
});

test('a nested table is one cell of its parent, not extra rows', () => {
  assert.equal(
    text('<table><tbody><tr><td>q1</td><td><table><tr><td>x</td><td>y</td></tr></table></td></tr><tr><td>q2</td><td>z</td></tr></tbody></table>'),
    'q1 | x y\nq2 | z',
  );
});

test('text in blocks the walk has no format for is kept', () => {
  assert.equal(
    text('loose <b>start</b><blockquote>quoted</blockquote><pre>code  here</pre><div><p>in div</p>tail</div>'),
    'loose start\n\nquoted\n\ncode here\n\nin div\n\ntail',
  );
});
