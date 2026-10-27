// PDF reader: pdf.js text items in, pages of logical-order text out. pdf.js itself is
// loaded only when a PDF is read; the line logic below is pure and unit-tested.
import { IngestError } from './ingest.js';

const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}]/u;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };
const EDGE = 2; // lines at the top and at the bottom of a page that may be header or footer
const LIST_MARK = /^\s*[,;:]\s*$/;
const NUMBER_ONLY =/^[\s\p{P}]*\d+[\s\p{P}]*$/u;

const x = (it) => it.transform[4];
const y = (it) => it.transform[5];

// Joins items in the given order; spaces come from the gaps between them, because some
// producers (Word) drop the spaces where the script changes.
function join(items) {
  let out = '';
  items.forEach((it, i) => {
    const prev = items[i - 1];
    if (prev) {
      const leftToRight = x(it) >= x(prev);
      const gap = leftToRight ? x(it) - (x(prev) + prev.width) : x(prev) - (x(it) + it.width);
      if (gap > (it.height || 10) * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
    }
    out += it.str;
  });
  return out.trim();
}

function balanced(text) {
  let depth = 0;
  for (const c of text) {
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && --depth < 0) return false;
  }
  return depth === 0;
}

const flip = (it) => ({ ...it, str: [...it.str].map((c) => MIRROR[c] ?? c).join('') });

// A right-to-left line stored in display order (Chrome, InDesign): read right to left by
// position, except runs of Latin words and numbers (a formula, "Melvin Calvin"), which
// read left to right. A comma, semicolon or colon standing alone ends such a run, as
// producers draw "A, B" in a Hebrew sentence with A on the right. A sentence period drawn
// to the left of a closing Latin run (".Calvin") moves to its end.
// ponytail: a simplified bidi algorithm per item; enough for teaching text, not for nested
// mixed-direction quotes.
function displayToReading(items) {
  const sorted = [...items].sort((a, b) => x(b) - x(a));
  const strong = (it) => /[\p{L}\p{N}]/u.test(it.str);
  const ordered = [];
  for (let i = 0; i < sorted.length; ) {
    if (RTL.test(sorted[i].str) || !strong(sorted[i])) {
      ordered.push(sorted[i++]);
      continue;
    }
    let end = i;
    for (let j = i; j < sorted.length && !RTL.test(sorted[j].str) && !LIST_MARK.test(sorted[j].str); j++) {
      if (strong(sorted[j])) end = j;
    }
    const run = sorted.slice(i, end + 1).reverse();
    ordered.push(...run.map((it) => ({ ...it, str: it.str.replace(/^([.,:;!?]+)(.+)$/s, '$2$1') })));
    i = end + 1;
  }
  return ordered;
}

// Puts a right-to-left line's items in reading order. Word and Ghostscript store reading
// order already; Chrome and InDesign store display order (most items left to right).
// Chrome and Ghostscript also store brackets as drawn, so "(1961)" comes out ")1961(":
// brackets that stand alone are mirrored when that, and only that, balances the line.
function rtlLineText(items) {
  const rising = items.slice(1).filter((it, i) => x(it) > x(items[i])).length;
  const ordered = rising > (items.length - 1) / 2 ? displayToReading(items) : items;
  const text = join(ordered);
  if (balanced(text)) return text;
  const mirrored = join(ordered.map((it) => (!RTL.test(it.str) && /^[()[\]{}<>\s]+$/.test(it.str) ? flip(it) : it)));
  return balanced(mirrored) ? mirrored : text;
}

const lineText = (items) => (items.some((it) => RTL.test(it.str)) ? rtlLineText(items) : join(items));

// Groups text items into lines: only items that follow each other in the stream and share
// a baseline, so two columns side by side stay two runs of lines.
// ponytail: a producer that writes both columns row by row still interleaves them; that
// needs layout analysis.
export function joinItems(items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (!it.str) continue; // pdf.js end-of-line markers
    if (!cur || Math.abs(y(it) - cur.y) >= (it.height || 10) * 0.5) lines.push((cur = { y: y(it), items: [] }));
    cur.items.push(it);
  }
  return lines.map((l) => ({ y: l.y, text: lineText(l.items) })).filter((l) => l.text);
}

// The top and bottom lines of a page, by position (producers store headers and footers
// anywhere in the stream).
function edges(lines) {
  const byY = [...lines].sort((a, b) => b.y - a.y);
  return new Set([...byY.slice(0, EDGE), ...byY.slice(-EDGE)]);
}

const shape = (text) => text.replace(/\d+/g, '#'); // "Unit 3 · 41" matches "Unit 3 · 42"

// Drops running headers and footers: top or bottom lines whose text (numbers aside) is on
// more than half the pages of a 3+ page document, and top or bottom lines that are only a
// number.
export function dropRepeated(pages) {
  if (pages.length < 3) return pages;
  const seen = new Map();
  for (const lines of pages) {
    for (const s of new Set([...edges(lines)].map((l) => shape(l.text)))) seen.set(s, (seen.get(s) ?? 0) + 1);
  }
  return pages.map((lines) => {
    const edge = edges(lines);
    return lines.filter((l) => !edge.has(l) || (seen.get(shape(l.text)) <= pages.length / 2 && !NUMBER_ONLY.test(l.text)));
  });
}

// Printed page numbers: the numbers in top and bottom lines that keep one offset from the
// page position on at least 60% of pages. Pages before the first printed number (cover,
// contents) get null.
export function printedLabels(pages) {
  if (pages.length < 3) return null;
  const votes = new Map(); // offset -> { count, first page index showing it }
  pages.forEach((lines, i) => {
    const offsets = new Set();
    for (const l of edges(lines)) for (const n of l.text.match(/\d+/g) ?? []) offsets.add(Number(n) - (i + 1));
    for (const d of offsets) {
      const v = votes.get(d) ?? votes.set(d, { count: 0, first: i }).get(d);
      v.count++;
    }
  });
  const [offset, best] = [...votes].reduce((a, b) => (b[1].count > a[1].count ? b : a), [0, { count: 0 }]);
  if (best.count < pages.length * 0.6) return null;
  return pages.map((_, i) => (i >= best.first ? String(i + 1 + offset) : null));
}

// No usable text layer: fewer than 20 letters (a scan, a figure), or more than 20% of the
// characters broken (a font without a usable character map).
export function unreadable(text) {
  const chars = text.replace(/\s/g, '');
  const letters = chars.match(/\p{L}/gu)?.length ?? 0;
  const broken = chars.match(/[�\p{Co}\p{Cc}]/gu)?.length ?? 0;
  return letters < 20 || broken > chars.length * 0.2;
}

async function open(pdfjs, data) {
  try {
    return await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new IngestError('password_protected', 'This PDF is protected with a password. Remove the password and try again.');
    }
    throw new IngestError('unreadable', "This PDF couldn't be opened. It may be damaged.");
  }
}

// Reads every page; the file size limit bounds the work.
export async function readPdf(file, { onProgress, pdfjs } = {}) {
  pdfjs ??= (await import('./pdfjs.js')).default;
  const doc = await open(pdfjs, new Uint8Array(await file.arrayBuffer()));
  try {
    const total = doc.numPages;
    const lines = [];
    for (let n = 1; n <= total; n++) {
      const page = await doc.getPage(n);
      lines.push(joinItems((await page.getTextContent()).items));
      page.cleanup();
      onProgress?.({ page: n, total });
    }
    const own = await doc.getPageLabels().catch(() => null);
    const labels = own?.map((l) => l || null) ?? printedLabels(lines);

    const pages = [];
    const skippedPages = [];
    dropRepeated(lines).forEach((pageLines, i) => {
      const text = pageLines.map((l) => l.text).join('\n');
      if (unreadable(text)) skippedPages.push(i + 1);
      else pages.push({ page: i + 1, pageLabel: labels?.[i] ?? null, heading: null, text });
    });
    if (!pages.length) {
      throw new IngestError('no_text', 'This PDF has no readable text; it looks scanned. Support for scanned pages is planned.');
    }
    return { pages, skippedPages };
  } finally {
    doc.loadingTask.destroy();
  }
}
