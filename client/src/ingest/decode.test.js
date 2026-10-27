import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeText } from './decode.js';

// Encodes text in a single-byte legacy code page by inverting TextDecoder's table.
function legacy(text, encoding) {
  const table = new Map();
  const dec = new TextDecoder(encoding);
  for (let b = 0; b < 256; b++) table.set(dec.decode(Uint8Array.of(b)), b);
  return Uint8Array.from([...text].map((ch) => {
    if (!table.has(ch)) throw new Error(`${ch} not in ${encoding}`);
    return table.get(ch);
  }));
}

const hebrew = 'פוטוסינתזה היא התהליך שבו צמחים הופכים אור לסוכר. הכלורופיל קולט אור.';
const nikud = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ.';
const arabic = 'التمثيل الضوئي هو العملية التي تحول بها النباتات الضوء إلى سكر. يمتص الكلوروفيل الضوء.';
const french = 'La photosynthèse est le procédé par lequel les plantes créent du sucre à partir de la lumière.';

test('UTF-8, with and without BOM', () => {
  const bytes = new TextEncoder().encode(hebrew);
  assert.equal(decodeText(bytes), hebrew);
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes])), hebrew);
});

test('UTF-16 by byte-order mark, both endians', () => {
  const le = [0xff, 0xfe];
  const be = [0xfe, 0xff];
  for (const ch of arabic) {
    const c = ch.charCodeAt(0);
    le.push(c & 0xff, c >> 8);
    be.push(c >> 8, c & 0xff);
  }
  assert.equal(decodeText(Uint8Array.from(le)), arabic);
  assert.equal(decodeText(Uint8Array.from(be)), arabic);
});

test('legacy Hebrew (windows-1255), with and without nikud', () => {
  assert.equal(decodeText(legacy(hebrew, 'windows-1255')), hebrew);
  assert.equal(decodeText(legacy(nikud, 'windows-1255')), nikud);
});

test('legacy Arabic (windows-1256)', () => {
  assert.equal(decodeText(legacy(arabic, 'windows-1256')), arabic);
});

test('legacy Hebrew file that is mostly English keeps its Hebrew', () => {
  const mixed = 'Chapter 1: Introduction to the topic of photosynthesis in plants. Key term: פוטוסינתזה';
  assert.equal(decodeText(legacy(mixed, 'windows-1255')), mixed);
});

test('legacy Arabic without a word-initial alef', () => {
  const text = 'مرحبا من مصر';
  assert.equal(decodeText(legacy(text, 'windows-1256')), text);
});

test('legacy Latin (windows-1252) is not mistaken for Hebrew', () => {
  assert.equal(decodeText(legacy(french, 'windows-1252')), french);
});
