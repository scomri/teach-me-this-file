import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'; // the browser build needs a DOM
import { IngestError } from './ingest.js';
import { dropRepeated, joinItems, printedLabels, readPdf, unreadable } from './pdf.js';

const fixture = (name) => new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name);
const read = (f, opts) => readPdf(f, { pdfjs, ...opts });
const flat = (s) => s.replace(/\s+/g, ' ').trim();

// Sentences as written in the source documents (fixtures/*.html; the -word files were
// saved as PDF from Word with the same text).
const HE_SIMPLE = [
  'פוטוסינתזה היא התהליך שבו צמחים הופכים אור לאנרגיה כימית.',
  'התהליך מתרחש בעלים, בתוך תאים מיוחדים, ובעיקר בשעות היום!',
  'האם ידעת שבלי פוטוסינתזה לא היה חמצן באוויר? זה נכון: כמעט כל החמצן מגיע מצמחים ומאצות.',
];
const HE_MIXED = [
  'הפיגמנט הירוק נקרא chlorophyll והוא סופג אור כחול ואדום.',
  'בשנת 2024 נמדדו 6CO2 מולקולות בכל מחזור (בערך), והיחס היה 3.14 בממוצע.',
  'Light reactions: השלב הראשון מתרחש בממברנת התילקואיד.',
  'המים (H2O) מתפרקים ומשחררים חמצן [O2] לאוויר.',
  'שלב ראשון: קליטת אור',
  'שלב שני: מעגל Calvin',
  'שלב שלישי: יצירת גלוקוז C6H12O6',
  'כלורופיל',
  'פיגמנט ירוק בעלה',
  'סטומה',
  'פתח בעלה לחילוף גזים',
];
const SOURCES = {
  'he-simple.pdf': HE_SIMPLE,
  'he-simple-word.pdf': HE_SIMPLE,
  'he-mixed.pdf': HE_MIXED,
  'he-mixed-word.pdf': HE_MIXED,
  'he-edge.pdf': [
    'התהליך נקרא the Calvin cycle על שם החוקר Melvin Calvin (1961).',
    'הנוסחה היא 6CO2 + 6H2O → C6H12O6 + 6O2 בתנאי אור.',
    'ראו גם: https://example.com/photo ו-pH 7.4 (ניטרלי).',
  ],
  'en-control.pdf': [
    'Photosynthesis is the process by which plants turn light into chemical energy.',
    'In 2024, researchers measured 6CO2 molecules per cycle (roughly), with a ratio of 3.14.',
    'Water (H2O) is split and releases oxygen [O2] into the air.',
  ],
  'he-columns.pdf': [
    'התא הוא יחידת החיים הבסיסית. כל יצור חי בנוי מתא אחד או מתאים רבים. בתוך התא נמצא גרעין שמכיל את החומר התורשתי.',
    'קרום התא שומר על הסביבה הפנימית. הוא מאפשר למים ולחומרים מסוימים לעבור, וחוסם חומרים אחרים.',
    'המיטוכונדריה מפיקה אנרגיה עבור התא. תאי שריר מכילים מיטוכונדריות רבות במיוחד, כי הם צורכים הרבה אנרגיה.',
    'בתאי צמח יש גם דופן תא קשיחה וכלורופלסטים. בכלורופלסטים מתרחשת הפוטוסינתזה, שבה אור הופך לסוכר.',
  ],
  'en-columns.pdf': [
    'The cell is the basic unit of life. Every living thing is made of one cell or of many cells. Inside the cell is a nucleus that holds the genetic material.',
    'The cell membrane protects the inner environment. It lets water and some substances pass, and blocks others.',
    'Mitochondria produce energy for the cell. Muscle cells contain especially many mitochondria, because they use a lot of energy.',
    'Plant cells also have a rigid cell wall and chloroplasts. Photosynthesis happens in the chloroplasts, where light becomes sugar.',
  ],
};

for (const [name, sentences] of Object.entries(SOURCES)) {
  test(`every source sentence comes out exactly: ${name}`, async () => {
    const { pages } = await read(fixture(name));
    const text = flat(pages.map((p) => p.text).join('\n'));
    for (const s of sentences) assert.ok(text.includes(s), `missing: ${s}\n in: ${text}`);
  });
}

// pdf.js text items: x, baseline y, width, font height.
const item = (str, x, y, width = str.length * 6, h = 12) => ({ str, transform: [h, 0, 0, h, x, y], width, height: h });

test('only consecutive items on one baseline form a line, so columns stay apart', () => {
  const lines = joinItems([
    item('left one', 50, 700), item('left two', 50, 686),
    item('right one', 300, 700), item('right two', 300, 686),
  ]);
  assert.deepEqual(lines.map((l) => l.text), ['left one', 'left two', 'right one', 'right two']);
});

test('inserts a space only where items have a gap', () => {
  const [line] = joinItems([item('H', 50, 700, 9), item('2', 59, 697, 6, 8), item('O', 65, 700, 9), item('is water', 80, 700)]);
  assert.equal(line.text, 'H2O is water');
});

test('right-to-left lines stored in display order are reversed, with lone brackets swapped', () => {
  // Chrome writes these lines left to right as displayed; the period of "Calvin." sits at its left.
  const visual = joinItems([
    item('.Calvin', 100, 700, 40), item('על שם', 150, 700, 30),
    item('היא', 50, 680, 18), item('(', 80, 680, 4), item('1961', 84, 680, 24), item(')', 108, 680, 4), item('שנת', 120, 680, 20),
  ]);
  assert.deepEqual(visual.map((l) => l.text), ['על שם Calvin.', 'שנת (1961) היא']);
  // Word writes them in reading order already: kept as they are.
  const logical = joinItems([item('על שם', 150, 700, 30), item('Calvin.', 100, 700, 40)]);
  assert.equal(logical[0].text, 'על שם Calvin.');
});

test('brackets drawn mirrored in reading order are swapped back only when that balances the line', () => {
  // Ghostscript: reading order, but the glyphs as drawn.
  const [gs] = joinItems([item('בשנת', 340, 700, 25), item(')', 330, 700, 3), item('1996', 309, 700, 21), item('(', 306, 700, 3)]);
  assert.equal(gs.text, 'בשנת (1996)');
  const [list] = joinItems([item('א', 340, 700, 6), item(')', 337, 700, 3), item('מצאו', 300, 700, 25)]);
  assert.equal(list.text, 'א) מצאו'); // one bracket: nothing to balance, left alone
});

test('a formula inside a right-to-left line reads left to right', () => {
  // InDesign: "נתונה הפרבולה y = 2x - 12." with the formula items out of order.
  const [line] = joinItems([
    item('.', 380, 700, 2), item('y', 385, 700, 5), item('x', 409, 700, 5), item('2', 403, 700, 5),
    item('12', 454, 700, 11), item('=', 393, 700, 8), item('-', 421, 700, 8),
    item('הפרבולה', 470, 700, 35), item('נתונה', 508, 700, 22),
  ]);
  assert.equal(line.text, 'נתונה הפרבולה y = 2x - 12 .');
  // A comma ends the run: "A, B" in a Hebrew sentence is drawn A right of B.
  const [list] = joinItems([
    item('.', 100, 700, 2), item('C', 105, 700, 6), item('ו־', 113, 700, 10), item('B', 125, 700, 6),
    item(',', 133, 700, 2), item('A', 137, 700, 6), item('את', 150, 700, 12),
  ]);
  assert.equal(list.text, 'את A , B ו־ C .');
});

const pageOf = (...lines) => lines.map((text, i) => ({ y: 800 - i * 20, text }));

test('drops lines repeated on most pages and number-only lines at the top and bottom', () => {
  const pages = [1, 2, 3, 4].map((n) => pageOf('Biology, Unit 3', ['Cells.', 'Nuclei.', 'Membranes.', 'Walls.'][n - 1], `- ${n + 10} -`));
  pages[3][0].text = 'Answers'; // one page without the running header
  const out = dropRepeated(pages);
  assert.deepEqual(out.map((p) => p.map((l) => l.text)), [
    ['Cells.'], ['Nuclei.'], ['Membranes.'], ['Answers', 'Walls.'],
  ]);
});

test('keeps repeated lines in documents under three pages, and numbers in the body', () => {
  const two = [pageOf('Header', 'one'), pageOf('Header', 'two')];
  assert.deepEqual(dropRepeated(two), two);
  const body = [pageOf('a', 'b', '42', 'c', 'd'), pageOf('a2', 'b2', 'x', 'c2', 'd2'), pageOf('a3', 'b3', 'y', 'c3', 'd3')];
  assert.equal(dropRepeated(body)[0][2].text, '42');
});

test('printed page numbers become labels when they keep a constant offset', () => {
  const pages = [
    pageOf('Cover'), pageOf('Contents'),
    pageOf('Rockets 7', 'body'), pageOf('body', '8'), pageOf('body', '9'), pageOf('Rockets 10', 'body'), pageOf('body', '11'),
  ];
  assert.deepEqual(printedLabels(pages), [null, null, '7', '8', '9', '10', '11']); // 5 of 7 pages agree
  pages[3][1].text = 'body';
  assert.equal(printedLabels(pages), null); // 4 of 7 is under 60%
  assert.equal(printedLabels([pageOf('2024'), pageOf('2024'), pageOf('2024')]), null); // a year is not a page number
});

test('a page is unreadable with under 20 letters or over 20% broken characters', () => {
  assert.equal(unreadable('Fig. 2'), true);
  assert.equal(unreadable('The nucleus holds the genetic material.'), false);
  const broken = String.fromCharCode(0xfffd, 0xe000, 0x7).repeat(4); // replacement, private-use, control
  assert.equal(unreadable(`The nucleus holds the genetic material ${broken}`), true);
  assert.equal(unreadable('תא הוא יחידת החיים הבסיסית'), false);
});

test('a book: running header and page numbers dropped, printed labels kept, a figure page skipped', async () => {
  const progress = [];
  const { pages, skippedPages } = await read(fixture('book.pdf'), { onProgress: (p) => progress.push(p) });
  assert.deepEqual(progress.map((p) => p.page), [1, 2, 3, 4]);
  assert.ok(progress.every((p) => p.total === 4));
  assert.deepEqual(skippedPages, [3]);
  assert.deepEqual(pages.map((p) => [p.page, p.pageLabel]), [[1, '37'], [2, '38'], [4, '40']]);
  assert.equal(flat(pages[0].text), 'Cells are the smallest units that can live on their own. Every plant and animal is built from them.');
});

// A PDF whose text layer is empty or unusable, built by hand.
function pdfWith(extraTrailer = '', content = '') {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${extraTrailer}>>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([body], 'made.pdf');
}

async function fails(f, code, message) {
  await assert.rejects(read(f), (err) => err instanceof IngestError && err.code === code && message.test(err.message));
}

test('no text on any page is no_text, and says the file looks scanned', async () => {
  await fails(pdfWith(), 'no_text', /scanned/);
});

test('encrypted and corrupt files get named errors', async () => {
  const hex = (b, n) => `<${b.repeat(n)}>`;
  const id = hex('33', 16);
  const encrypt = `/Encrypt << /Filter /Standard /V 1 /R 2 /O ${hex('11', 32)} /U ${hex('22', 32)} /P -4 >> /ID [${id} ${id}] `;
  await fails(pdfWith(encrypt), 'password_protected', /password/i);
  await fails(new File(['%PDF-1.4 this is not really a pdf'], 'broken.pdf'), 'unreadable', /./);
});
