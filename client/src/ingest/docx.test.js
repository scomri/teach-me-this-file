import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { readDocx } from './docx.js';
import { htmlToText } from './dom-text.js';
import { ingestFile, IngestError } from './ingest.js';

const bytes = readFileSync(new URL('./fixtures/worksheet.docx', import.meta.url));
const docx = (name = 'worksheet.docx') => new File([bytes], name);
const parse = (html) => new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
const emptyDocx = await (async () => {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  zip.file('word/document.xml', (await zip.file('word/document.xml').async('string')).replace(/<w:body>.*<\/w:body>/s, '<w:body><w:p/></w:body>'));
  return zip.generateAsync({ type: 'nodebuffer' });
})();

test('walk: headings, lists, tables, paragraphs in order', () => {
  const text = htmlToText(
    parse('<h1>A</h1><p>one <strong>two</strong></p><ul><li>x<ul><li>y</li></ul></li></ul><ol><li>p</li><li>q</li></ol>' +
      '<table><tr><td><p>a</p><p>b</p></td><td>c</td></tr><tr><td></td><td></td></tr></table><img src="x">'),
  );
  assert.equal(text, '# A\n\none two\n\n- x\n  - y\n\n1. p\n2. q\n\na b | c');
});

test('reads the Hebrew and English fixture', async () => {
  const { pages } = await readDocx(docx(), { DOMParser });
  assert.equal(pages.length, 1);
  assert.deepEqual([pages[0].page, pages[0].pageLabel, pages[0].heading], [null, null, null]);
  assert.equal(
    pages[0].text,
    [
      '# Photosynthesis worksheet',
      'Plants turn light into sugar.',
      '## פוטוסינתזה',
      'צמחים הופכים אור שמש לסוכר.',
      '## Bring with you',
      '- A leaf\n- עט וכחול',
      '## Steps',
      '1. Collect light\n2. Make sugar',
      '## Answers',
      'Question | שאלה | Answer\n1 | מה הצמח לוקח מהאוויר? | CO2\n2 | Where does it happen? | בכלורופלסט',
      'Well done.',
    ].join('\n\n'),
  );
});

test('ingestFile chunks the fixture by heading', async () => {
  globalThis.DOMParser = DOMParser;
  const r = await ingestFile(docx());
  assert.equal(r.kind, 'docx');
  assert.deepEqual(r.chunks.map((c) => [c.page, c.heading]), [
    [null, 'Photosynthesis worksheet'], [null, 'פוטוסינתזה'], [null, 'Bring with you'], [null, 'Steps'], [null, 'Answers'],
  ]);
  assert.ok(r.chunks[4].text.includes('Question | שאלה | Answer'));
  assert.ok(r.chunks[4].text.includes('Well done.'));
});

test('a renamed text file is unreadable', async () => {
  await assert.rejects(readDocx(new File(['just text'], 'notes.docx'), { DOMParser }), (e) => e instanceof IngestError && e.code === 'unreadable');
});

test('a document with no text is empty', async () => {
  globalThis.DOMParser = DOMParser;
  await assert.rejects(ingestFile(new File([emptyDocx], 'blank.docx')), (e) => e instanceof IngestError && e.code === 'empty');
});
