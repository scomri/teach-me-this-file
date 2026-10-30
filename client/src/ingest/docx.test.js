import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { readDocx } from './docx.js';
import { ingestFile, IngestError } from './ingest.js';

const bytes = readFileSync(new URL('./fixtures/worksheet.docx', import.meta.url));
const docx = (name = 'worksheet.docx') => new File([bytes], name);
const savedParser = globalThis.DOMParser;
after(() => { globalThis.DOMParser = savedParser; });
const emptyDocx = await (async () => {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  zip.file('word/document.xml', (await zip.file('word/document.xml').async('string')).replace(/<w:body>.*<\/w:body>/s, '<w:body><w:p/></w:body>'));
  return zip.generateAsync({ type: 'nodebuffer' });
})();

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

test('a failure outside mammoth is not reported as an invalid document', async () => {
  const broken = { name: 'x.docx', size: 10, arrayBuffer: () => Promise.reject(new Error('disk gone')) };
  await assert.rejects(readDocx(broken, { DOMParser }), /disk gone/);
});
