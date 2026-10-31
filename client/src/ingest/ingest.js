// File in, chunks out. Picks a reader by extension; every reader returns pages
// ({ page, pageLabel, heading, text }) and the shared chunker does the rest.
import { MAX_FILE_BYTES, MAX_FILE_MB } from '../../../shared/limits.js';
import { chunkPages } from './chunk.js';
import { decodeText } from './decode.js';
import { IngestError } from './errors.js';
import { readPdf } from './pdf.js';

export { IngestError };

async function readText(file, options) {
  const text = decodeText(new Uint8Array(await file.arrayBuffer()), options);
  if (text.includes('\0')) throw new IngestError('unreadable', "This file doesn't contain readable text.");
  if (options.allowDamagedText && !text.replace(/[�\p{C}\s]/gu, '')) throw new IngestError('unreadable', 'This file has no readable text. Choose another file.');
  return { pages: [{ page: null, pageLabel: null, heading: null, text }] };
}

// docx loads on demand: mammoth is large and most files are not Word.
const readDocx = async (file) => (await import('./docx.js')).readDocx(file);

// pptx likewise: jszip is only needed for slides.
const readPptx = async (file) => (await import('./pptx.js')).readPptx(file);

const READERS = { pdf: readPdf, docx: readDocx, pptx: readPptx, txt: readText, md: readText };
const LEGACY = new Set(['doc', 'rtf', 'odt', 'ppt', 'odp']);

export const ACCEPTED = Object.keys(READERS).map((ext) => `.${ext}`);

// options go to the reader: onProgress({ page, total }) for readers with pages, and pdfjs
// to pass a pdf.js build (tests use the Node one).
export async function ingestFile(file, options = {}) {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const read = READERS[ext];
  if (!read) {
    throw new IngestError(
      'unsupported_type',
      LEGACY.has(ext)
        ? `.${ext} files can't be read. Open the file and save it as PDF, DOCX or PPTX, then try again.`
        : `This file type isn't supported. Use ${ACCEPTED.join(', ')}.`,
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new IngestError('too_large', `This file is larger than ${MAX_FILE_MB} MB.`);
  }
  if (!file.size) throw new IngestError('empty', 'This file is empty.');

  // totalPages is whatever the reader reports (PDF, PPTX); formats without pages report none.
  const { pages, skippedPages = [], totalPages = null } = await read(file, options);
  const result = chunkPages(pages);
  if (!result.chunks.length) throw new IngestError('empty', 'This file has no text to teach from.');
  return { name: file.name, kind: ext, ...result, totalPages, skippedPages };
}
