// Pure chunker: pages of text in, chunks with stable ids out. No DOM, no network.

export const CHUNK_CHARS = 1500;

const HEADING = /^#{1,6}\s+(.+)/; // Markdown heading; the DOCX reader emits the same form
const SENTENCE_END = /[.!?׃…](?=\s)|\n/g;

export function normalize(text) {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Cuts one paragraph into pieces of at most `max` chars: at a sentence end in the
// second half of the window, else at the last whitespace, else hard.
function splitLong(s, max) {
  const out = [];
  while (s.length > max) {
    const win = s.slice(0, max + 1);
    let cut = -1;
    for (const m of win.matchAll(SENTENCE_END)) if (m.index < max && m.index >= max / 2) cut = m.index + 1;
    if (cut < 0) for (const m of win.matchAll(/\s/g)) if (m.index > 0) cut = m.index;
    if (cut < 0) cut = max;
    out.push(s.slice(0, cut).trim());
    s = s.slice(cut).trim();
  }
  if (s) out.push(s);
  return out;
}

// pages: [{ page, pageLabel, heading, text }]. Chunks never cross pages; each carries
// the heading in effect at its first paragraph. Every page is kept: the size limit
// applies when the plan request is built, not here.
export function chunkPages(pages, { max = CHUNK_CHARS } = {}) {
  const chunks = [];
  let totalChars = 0;
  let heading = null;

  for (const p of pages) {
    const text = normalize(p.text);
    totalChars += text.length;
    if (p.heading) heading = p.heading;
    if (!text) continue;

    let buf = '';
    let bufHeading = heading;
    const flush = () => {
      if (!buf) return;
      chunks.push({ id: `c${chunks.length + 1}`, page: p.page, pageLabel: p.pageLabel, heading: bufHeading, text: buf });
      buf = '';
    };

    for (const para of text.split(/\n{2,}/)) {
      const h = HEADING.exec(para);
      if (h) heading = h[1].trim();
      for (const piece of splitLong(para, max)) {
        if (buf && buf.length + 2 + piece.length <= max) {
          buf += `\n\n${piece}`;
        } else {
          flush();
          buf = piece;
          bufHeading = heading;
        }
      }
    }
    flush();
  }

  return { chunks, totalChars, totalPages: pages.some((p) => p.page != null) ? pages.length : null };
}
