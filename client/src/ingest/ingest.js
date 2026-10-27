// File in, chunks out. Picks a reader by extension; every reader returns pages
// ({ page, pageLabel, heading, text }) and the shared chunker does the rest.
import { MAX_FILE_BYTES, MAX_FILE_MB } from '../../../shared/limits.js';
import { chunkPages } from './chunk.js';
import { decodeText } from './decode.js';

export class IngestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function readText(file) {
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  if (text.includes('\0')) throw new IngestError('unreadable', "This file doesn't contain readable text.");
  return { pages: [{ page: null, pageLabel: null, heading: null, text }] };
}

// docx loads on demand: mammoth is large and most files are not Word.
const readDocx = async (file) => (await import('./docx.js')).readDocx(file);

const READERS = { docx: readDocx, txt: readText, md: readText };
const LEGACY = new Set(['doc', 'rtf', 'odt', 'ppt', 'odp']);

export const ACCEPTED = Object.keys(READERS).map((ext) => `.${ext}`);

export async function ingestFile(file) {
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

  const { pages, skippedPages = [] } = await read(file);
  const result = chunkPages(pages);
  if (!result.chunks.length) throw new IngestError('empty', 'This file has no text to teach from.');
  return { name: file.name, kind: ext, ...result, skippedPages };
}
