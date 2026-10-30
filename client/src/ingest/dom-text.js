// DOM to Markdown-ish text for formats that arrive as markup. Headings become `#`
// lines, list items `- item` or `1. item`, table rows `cell | cell`. Blocks are
// separated by blank lines.
const BLOCK = /^(p|div|li|ul|ol|table|tr|td|th|blockquote|pre|h[1-6])$/;
const LIST = /^(ul|ol)$/;
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// Text of a node, with a space around blocks and <br> so cells holding several
// paragraphs don't run together. Nested lists are left to their own walk.
function text(node) {
  let out = '';
  for (const c of node.childNodes) {
    if (c.nodeType === 3) out += c.data;
    else if (c.nodeType === 1) {
      const tag = c.localName;
      if (LIST.test(tag) && node.localName === 'li') continue;
      out += tag === 'br' ? ' ' : BLOCK.test(tag) ? ` ${text(c)} ` : text(c);
    }
  }
  return squash(out);
}

function list(el, depth) {
  const ordered = el.localName === 'ol';
  const lines = [];
  let n = 0;
  for (const li of el.children) {
    if (li.localName !== 'li') continue;
    const t = text(li);
    if (t) lines.push(`${'  '.repeat(depth)}${ordered ? `${++n}.` : '-'} ${t}`);
    for (const sub of li.children) if (LIST.test(sub.localName)) lines.push(...list(sub, depth + 1));
  }
  return lines;
}

// Rows of this table only: a nested table's rows belong to its cell, which text() already flattened.
// ponytail: a literal "|" inside a cell is not escaped, and merged cells are not padded.
function table(el) {
  const rows = [];
  const trs = [...el.children].flatMap((c) => (c.localName === 'tr' ? [c] : [...c.children].filter((r) => r.localName === 'tr')));
  for (const tr of trs) {
    const cells = [...tr.children].filter((c) => /^t[dh]$/.test(c.localName)).map(text);
    if (cells.some(Boolean)) rows.push(cells.join(' | '));
  }
  return rows;
}

// Anything not handled below is kept as a paragraph rather than dropped: loose text and
// inline elements gather into one paragraph, a block with block children is walked into.
function walk(el, out) {
  let run = '';
  const flush = () => {
    if (squash(run)) out.push(squash(run));
    run = '';
  };
  for (const c of el.childNodes) {
    if (c.nodeType === 3) { run += c.data; continue; }
    if (c.nodeType !== 1) continue;
    const tag = c.localName;
    const level = /^h([1-6])$/.exec(tag)?.[1];
    const hasBlock = [...c.children].some((k) => BLOCK.test(k.localName));
    if (!level && !LIST.test(tag) && tag !== 'table' && !BLOCK.test(tag) && !hasBlock) { run += ` ${text(c)} `; continue; }
    flush();
    let block;
    if (level) block = text(c) && `${'#'.repeat(level)} ${text(c)}`;
    else if (LIST.test(tag)) block = list(c, 0).join('\n');
    else if (tag === 'table') block = table(c).join('\n');
    else if (hasBlock && tag !== 'p') { walk(c, out); continue; }
    else block = text(c);
    if (block) out.push(block);
  }
  flush();
}

export function htmlToText(doc) {
  const out = [];
  walk(doc.body, out);
  return out.join('\n\n');
}
