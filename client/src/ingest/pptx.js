// PPTX reader: the file is a zip of XML. Slides come in the order presentation.xml
// lists them; each slide is a page with its title as heading, its text, tables as
// `cell | cell` rows, and the speaker notes under a `Notes:` line. jszip is loaded
// on demand, so it stays out of the main bundle.
import { IngestError } from './ingest.js';

const BAD = () => new IngestError('unreadable', "This file isn't a valid PowerPoint presentation.");
// Slides with fewer letters than this (pictures only) are listed as skipped.
// ponytail: same rule as the PDF reader's unreadable pages; share one constant once both are merged.
const MIN_LETTERS = 20;
// Slide furniture that repeats on every slide and says nothing.
const FURNITURE = new Set(['sldNum', 'dt', 'ftr', 'hdr']);
const TITLE = new Set(['title', 'ctrTitle']);
// linkedom keeps the prefix in localName ('a:t'); browsers don't.
const local = (el) => el.localName.replace(/^.*:/, '');
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// Descendants by local name, in document order (prefixes vary between producers).
function find(el, name, out = []) {
  for (const c of el.children) {
    if (local(c) === name) out.push(c);
    else find(c, name, out);
  }
  return out;
}

// One <a:p>: its runs and fields, a line break as a space.
function paragraph(p) {
  let s = '';
  const go = (el) => {
    for (const c of el.children) {
      if (local(c) === 't') s += c.textContent;
      else if (local(c) === 'br') s += ' ';
      else go(c);
    }
  };
  go(p);
  return squash(s);
}

const paragraphs = (el) => find(el, 'p').map(paragraph).filter(Boolean);
const placeholder = (sp) => find(sp, 'ph')[0]?.getAttribute('type') ?? null;

function table(tbl) {
  return find(tbl, 'tr')
    .map((tr) => find(tr, 'tc').map((tc) => paragraphs(tc).join(' ')))
    .filter((cells) => cells.some(Boolean))
    .map((cells) => cells.join(' | '));
}

// Shapes in z-order, which is the reading order PowerPoint stores (also for Hebrew).
function shapes(tree, out) {
  for (const c of tree.children) {
    if (local(c) === 'grpSp') shapes(c, out);
    else if (local(c) === 'sp') {
      const type = placeholder(c);
      if (FURNITURE.has(type)) continue;
      const lines = paragraphs(c);
      if (!lines.length) continue;
      if (TITLE.has(type)) out.title ??= lines.join(' ');
      else out.blocks.push(lines.join('\n'));
    } else if (local(c) === 'graphicFrame') {
      for (const tbl of find(c, 'tbl')) out.blocks.push(table(tbl).join('\n'));
    }
  }
}

// Notes pages also hold a slide thumbnail and a number; only the body is speaker text.
function notesText(doc) {
  return find(doc.documentElement, 'sp')
    .filter((sp) => placeholder(sp) === 'body')
    .flatMap(paragraphs)
    .join('\n');
}

const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);
// Rels targets are relative to the part's folder, or absolute from the package root.
const resolve = (from, target) => new URL(target, `http://x/${from}`).pathname.slice(1);

export async function readPptx(file, { DOMParser: Parser = globalThis.DOMParser } = {}) {
  const { default: JSZip } = await import('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw BAD();
  }
  const xml = async (path) => {
    const f = zip.file(path);
    return f ? new Parser().parseFromString(await f.async('string'), 'text/xml') : null;
  };
  const relTargets = async (part, type) => {
    const rels = await xml(`${dirOf(part)}_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`);
    const map = new Map();
    if (rels) {
      for (const r of find(rels.documentElement, 'Relationship')) {
        if (r.getAttribute('Type').endsWith(`/${type}`)) map.set(r.getAttribute('Id'), resolve(part, r.getAttribute('Target')));
      }
    }
    return map;
  };

  const main = 'ppt/presentation.xml';
  const pres = await xml(main);
  const ids = pres && find(pres.documentElement, 'sldId').map((s) => s.getAttribute('r:id') ?? s.getAttributeNS?.('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
  if (!ids?.length) throw BAD();
  const slideFiles = await relTargets(main, 'slide');

  const pages = [];
  const skippedPages = [];
  for (const [i, id] of ids.entries()) {
    const part = slideFiles.get(id);
    const doc = part && (await xml(part));
    if (!doc) throw BAD();
    const out = { title: null, blocks: [] };
    const tree = find(doc.documentElement, 'spTree')[0];
    if (tree) shapes(tree, out);
    const notesPart = [...(await relTargets(part, 'notesSlide')).values()][0];
    const notesDoc = notesPart && (await xml(notesPart));
    const notes = notesDoc ? notesText(notesDoc) : '';
    const text = [out.title && `# ${out.title}`, ...out.blocks, notes && `Notes:\n${notes}`].filter(Boolean).join('\n\n');
    if ((text.match(/\p{L}/gu) ?? []).length < MIN_LETTERS) skippedPages.push(i + 1);
    else pages.push({ page: i + 1, pageLabel: null, heading: out.title, text });
  }
  return { pages, skippedPages };
}
