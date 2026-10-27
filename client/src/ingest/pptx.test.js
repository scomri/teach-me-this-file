import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { readPptx } from './pptx.js';
import { ingestFile, IngestError } from './ingest.js';

const bytes = readFileSync(new URL('./fixtures/lesson.pptx', import.meta.url));
const pptx = (name = 'lesson.pptx') => new File([bytes], name);

test('slides follow presentation.xml, not file names', async () => {
  const { pages } = await readPptx(pptx(), { DOMParser });
  // The picture-only slide 2 is not a page, but it keeps its number.
  assert.deepEqual(pages.map((p) => [p.page, p.pageLabel, p.heading]), [
    [1, null, 'Photosynthesis'],
    [3, null, 'Inputs and outputs · קלט ופלט'],
  ]);
});

test('slide text, notes and ignored placeholders', async () => {
  const { pages } = await readPptx(pptx(), { DOMParser });
  assert.equal(
    pages[0].text,
    [
      '# Photosynthesis',
      'How plants make sugar\nצמחים הופכים אור שמש לסוכר',
      'Notes:\nRemind the class that chlorophyll is green. תזכירו לכיתה שכלורופיל ירוק.',
    ].join('\n\n'),
  );
});

test('tables become cell | cell rows', async () => {
  const { pages } = await readPptx(pptx(), { DOMParser });
  assert.equal(
    pages[1].text,
    '# Inputs and outputs · קלט ופלט\n\nInput | קלט | Output\nCO2 | פחמן דו חמצני | Sugar\nWater | מים | Oxygen',
  );
});

test('a picture-only slide is skipped, the others are not', async () => {
  const r = await readPptx(pptx(), { DOMParser });
  assert.deepEqual(r.skippedPages, [2]);
  globalThis.DOMParser = DOMParser;
  const doc = await ingestFile(pptx());
  assert.equal(doc.kind, 'pptx');
  assert.deepEqual(doc.skippedPages, [2]);
  assert.deepEqual(doc.chunks.map((c) => [c.page, c.heading]), [[1, 'Photosynthesis'], [3, 'Inputs and outputs · קלט ופלט']]);
});

test('a renamed text file is unreadable', async () => {
  await assert.rejects(readPptx(new File(['just text'], 'x.pptx'), { DOMParser }), (e) => e instanceof IngestError && e.code === 'unreadable');
});

test('a zip that is not a presentation is unreadable', async () => {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip().file('hello.txt', 'hi');
  const file = new File([await zip.generateAsync({ type: 'nodebuffer' })], 'x.pptx');
  await assert.rejects(readPptx(file, { DOMParser }), (e) => e instanceof IngestError && e.code === 'unreadable');
});

test('a deck with no text is empty', async () => {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  for (const n of ['1', '2', '3']) {
    const f = `ppt/slides/slide${n}.xml`;
    zip.file(f, (await zip.file(f).async('string')).replace(/<a:t>[^<]*<\/a:t>/g, '<a:t></a:t>'));
  }
  zip.remove('ppt/notesSlides/notesSlide1.xml');
  globalThis.DOMParser = DOMParser;
  const file = new File([await zip.generateAsync({ type: 'nodebuffer' })], 'blank.pptx');
  await assert.rejects(ingestFile(file), (e) => e instanceof IngestError && e.code === 'empty');
});
