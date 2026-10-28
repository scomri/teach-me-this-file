// DOCX reader: mammoth turns the file into HTML (loaded on demand, so it stays
// out of the main bundle), then dom-text keeps headings, lists and tables.
import { htmlToText } from './dom-text.js';
import { IngestError } from './ingest.js';

// Tests pass linkedom's parser; the browser has its own.
export async function readDocx(file, { DOMParser: Parser = globalThis.DOMParser } = {}) {
  const { default: mammoth } = await import('mammoth');
  // ponytail: images are dropped by the walk, so mammoth gets an empty src instead of encoding them.
  const convertImage = mammoth.images.imgElement(async () => ({ src: '' }));
  // ponytail: mammoth's Node build only takes a Buffer, its browser build only an ArrayBuffer;
  // `Buffer` existing is the switch, which a bundler polyfill would break.
  const ab = await file.arrayBuffer();
  const input = globalThis.Buffer ? { buffer: Buffer.from(ab) } : { arrayBuffer: ab };
  let html;
  try {
    ({ value: html } = await mammoth.convertToHtml(input, { convertImage }));
  } catch {
    throw new IngestError('unreadable', "This file isn't a valid Word document.");
  }
  const text = htmlToText(new Parser().parseFromString(`<html><body>${html}</body></html>`, 'text/html'));
  // ponytail: DOCX has no fixed pages, so the whole file is one unnumbered page.
  return { pages: [{ page: null, pageLabel: null, heading: null, text }] };
}
