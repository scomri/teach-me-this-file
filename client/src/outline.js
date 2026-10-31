// What a plan request carries: the full text when it fits the preset's token budget, otherwise an
// outline of the whole document. Pure; no React, no network, no model call.
import { MAX_DOC_CHARS, PLAN_OUTPUT_TOKENS, PLAN_OVERHEAD_TOKENS } from '../../shared/limits.js';
import { PRESETS } from '../../shared/presets.js';

// Tokens per character, set just above the highest value measured on real Hebrew, Arabic and English
// teaching files read with the app's PDF reader. Hebrew and every other script share the highest.
export const TOKENS_PER_CHAR = { latin: 0.3, arabic: 0.45, hebrew: 0.85, other: 0.85 };

const WRAPPER_CHARS = 40; // the tag around a chunk, counted at the text's own ratio
const ENTRY_WRAPPER_CHARS = 80; // the longer tag around an outline entry
const SNIPPET_CHARS = 150; // opening text kept per entry
const SHORTER_SNIPPETS = [50, 0]; // tried in turn when the outline is over budget
const HEADING_CHARS = 100;
const GROUP_CHUNKS = 5; // chunks per entry when a document has neither headings nor pages

export const estimateTokens = (chars, script) => Math.ceil(chars * TOKENS_PER_CHAR[script]);

// Document token budget: the preset's planning setting, less allowances for output and prompt.
// An unknown preset gets Gemini's; the server refuses it.
export const planBudget = (preset) => (PRESETS[preset] ?? PRESETS.gemini).tpm - PLAN_OUTPUT_TOKENS - PLAN_OVERHEAD_TOKENS;

const squash = (s) => s.replace(/\s+/g, ' ').trim();

// Consecutive chunks that share a heading; without headings, a page; without pages, a fixed group.
function sections(chunks) {
  const key = chunks.some((c) => c.heading) ? (c) => c.heading ?? null
    : chunks.some((c) => c.page != null) ? (c) => c.page
      : (c, i) => Math.floor(i / GROUP_CHUNKS);
  const out = [];
  chunks.forEach((c, i) => {
    const k = key(c, i);
    if (out.length && out.at(-1).k === k) out.at(-1).chunks.push(c);
    else out.push({ k, chunks: [c] });
  });
  return out.map((s) => s.chunks);
}

// The chunk text without its own heading, which the entry already shows: a Markdown line, or the
// bare heading text a PDF chunk may open with.
function body(c) {
  const text = squash(c.text.replace(/^#{1,6}[^\n]*/, ''));
  const heading = squash(c.heading ?? '');
  return heading && text.startsWith(heading) ? text.slice(heading.length).trim() : text;
}

// One entry per section: { first, last, page, heading, text }, covering every chunk in order.
export function buildOutline(chunks, script, budget) {
  const chars = (list) => list.reduce((n, e) => n + e.heading.length + e.text.length, 0); // what the route caps
  const fits = (list) => chars(list) <= MAX_DOC_CHARS && estimateTokens(chars(list) + ENTRY_WRAPPER_CHARS * list.length, script) <= budget;
  let entries = sections(chunks).map((s) => ({
    first: s[0].id,
    last: s.at(-1).id,
    page: s[0].page ?? null,
    heading: squash(s[0].heading ?? '').slice(0, HEADING_CHARS),
    text: (s.map(body).find(Boolean) ?? '').slice(0, SNIPPET_CHARS),
  }));
  for (const keep of SHORTER_SNIPPETS) {
    if (fits(entries)) return entries;
    entries = entries.map((e) => ({ ...e, text: e.text.slice(0, keep) }));
  }
  // Still over: join neighbours until it fits (one entry always does).
  while (entries.length > 1 && !fits(entries)) {
    entries = Array.from({ length: Math.ceil(entries.length / 2) }, (_, i) => {
      const [a, b = a] = entries.slice(2 * i, 2 * i + 2);
      return { ...a, last: b.last };
    });
  }
  return entries;
}

// The document part of a plan request body: { chunks } or { outline, chunkIds }.
export function planInput(chunks, script, budget) {
  const chars = chunks.reduce((n, c) => n + c.text.length, 0);
  if (chars <= MAX_DOC_CHARS && estimateTokens(chars + WRAPPER_CHARS * chunks.length, script) <= budget) {
    return { chunks: chunks.map(({ id, page, text }) => ({ id, page, text })) };
  }
  return { outline: buildOutline(chunks, script, budget), chunkIds: chunks.map((c) => c.id) };
}
