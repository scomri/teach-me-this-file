// DOM to Markdown-ish text, shared by the formats that arrive as markup
// (DOCX today, PPTX next). Headings become `#` lines, list items `- item` or
// `1. item`, table rows `cell | cell`. Blocks are separated by blank lines.
const BLOCK = /^(p|div|li|ul|ol|table|tr|td|th|h[1-6])$/;
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

// ponytail: a literal "|" inside a cell is not escaped; the tutor reads rows as prose.
function table(el) {
  const rows = [];
  for (const tr of el.querySelectorAll('tr')) {
    const cells = [...tr.children].filter((c) => /^t[dh]$/.test(c.localName)).map(text);
    if (cells.some(Boolean)) rows.push(cells.join(' | '));
  }
  return rows;
}

function walk(el, out) {
  for (const c of el.children) {
    const tag = c.localName;
    const level = /^h([1-6])$/.exec(tag)?.[1];
    let block;
    if (level) block = text(c) && `${'#'.repeat(level)} ${text(c)}`;
    else if (LIST.test(tag)) block = list(c, 0).join('\n');
    else if (tag === 'table') block = table(c).join('\n');
    else if (tag === 'p') block = text(c);
    else if (BLOCK.test(tag)) { walk(c, out); continue; }
    if (block) out.push(block);
  }
}

export function htmlToText(doc) {
  const out = [];
  walk(doc.body, out);
  return out.join('\n\n');
}
