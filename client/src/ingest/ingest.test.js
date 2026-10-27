import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestFile, IngestError } from './ingest.js';
import { MAX_DOC_CHARS, MAX_FILE_BYTES } from '../../../shared/limits.js';

const file = (content, name) => new File([content], name);

async function fails(f, code) {
  await assert.rejects(ingestFile(f), (err) => err instanceof IngestError && err.code === code);
}

test('reads a Markdown file into chunks with headings', async () => {
  const r = await ingestFile(file('# Cells\n\nCells are small.\n\n## Nucleus\n\nIt holds DNA.', 'Notes.MD'));
  assert.equal(r.name, 'Notes.MD');
  assert.equal(r.kind, 'md');
  assert.deepEqual(r.chunks.map((c) => [c.id, c.page, c.heading]), [['c1', null, 'Cells'], ['c2', null, 'Nucleus']]);
  assert.deepEqual(r.skippedPages, []);
});

test('keeps the whole text, even far past the planning cap', async () => {
  const text = Array(200).fill('x'.repeat(1400)).join('\n\n');
  assert.ok(text.length > MAX_DOC_CHARS);
  const r = await ingestFile(file(text, 'long.txt'));
  assert.equal(r.chunks.length, 200);
  assert.equal(r.totalChars, text.length);
});

test('named errors', async () => {
  await fails(file('x', 'slides.key'), 'unsupported_type');
  await fails(file('x', 'old.doc'), 'unsupported_type');
  await fails(file('', 'empty.txt'), 'empty');
  await fails(file(' \n\n \n', 'blank.txt'), 'empty');
  await fails(file(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00), 'renamed.txt'), 'unreadable');
  await fails({ name: 'huge.txt', size: MAX_FILE_BYTES + 1 }, 'too_large');
});

test('legacy formats are told to save as a supported type', async () => {
  await assert.rejects(ingestFile(file('x', 'old.doc')), /save it as PDF, DOCX or PPTX/i);
});
