// DOCX reader: mammoth turns the file into HTML (loaded on demand, so it stays
// out of the main bundle), then dom-text keeps headings, lists and tables.
import { htmlToText } from './dom-text.js';
import { IngestError } from './ingest.js';

// Tests pass linkedom's parser; the browser has its own.
export async function readDocx(file, { DOMParser: Parser = globalThis.DOMParser } = {}) {
  const { default: mammoth } = await import('mammoth');
  let html;
  try {
    // Images are dropped by the walk, so skip encoding them into the HTML.
    const convertImage = mammoth.images.imgElement(async () => ({ src: '' }));
    // mammoth's Node build only takes a Buffer, its browser build only an ArrayBuffer.
    const ab = await file.arrayBuffer();
    const input = globalThis.Buffer ? { buffer: Buffer.from(ab) } : { arrayBuffer: ab };
    ({ value: html } = await mammoth.convertToHtml(input, { convertImage }));
  } catch {
    throw new IngestError('unreadable', "This file isn't a valid Word document.");
  }
  const text = htmlToText(new Parser().parseFromString(`<html><body>${html}</body></html>`, 'text/html'));
  // DOCX has no fixed pages: one page, no number.
  return { pages: [{ page: null, pageLabel: null, heading: null, text }] };
}
