// Builds client/src/ingest/fixtures/worksheet.docx: a tiny Hebrew and English
// worksheet with headings, a bullet list, a numbered list and a table.
// Run: node scripts/make-docx-fixture.js
import { mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const run = (t) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const rtl = /\p{Script=Hebrew}/u;
const p = (t, { style, num } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${
    num ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${num}"/></w:numPr>` : ''
  }${rtl.test(t) ? '<w:bidi/>' : ''}</w:pPr>${run(t)}</w:p>`;
const cell = (t) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${p(t)}</w:tc>`;
const row = (...cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;

const body = [
  p('Photosynthesis worksheet', { style: 'Heading1' }),
  p('Plants turn light into sugar.'),
  p('פוטוסינתזה', { style: 'Heading2' }),
  p('צמחים הופכים אור שמש לסוכר.'),
  p('Bring with you', { style: 'Heading2' }),
  p('A leaf', { style: 'ListParagraph', num: 1 }),
  p('עט וכחול', { style: 'ListParagraph', num: 1 }),
  p('Steps', { style: 'Heading2' }),
  p('Collect light', { style: 'ListParagraph', num: 2 }),
  p('Make sugar', { style: 'ListParagraph', num: 2 }),
  p('Answers', { style: 'Heading2' }),
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${[
    row('Question', 'שאלה', 'Answer'),
    row('1', 'מה הצמח לוקח מהאוויר?', 'CO2'),
    row('2', 'Where does it happen?', 'בכלורופלסט'),
  ].join('')}</w:tbl>`,
  p('Well done.'),
].join('');

const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const styles = (id, name) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
const level = (fmt) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="%1."/></w:lvl>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`);
zip.file('_rels/.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
zip.file('word/_rels/document.xml.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`);
zip.file('word/document.xml', `${head}<w:document ${NS}><w:body>${body}</w:body></w:document>`);
zip.file('word/styles.xml', `${head}<w:styles ${NS}>${styles('Heading1', 'heading 1')}${styles('Heading2', 'heading 2')}${styles('ListParagraph', 'List Paragraph')}</w:styles>`);
zip.file('word/numbering.xml', `${head}<w:numbering ${NS}><w:abstractNum w:abstractNumId="0">${level('bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="1">${level('decimal')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`);

mkdirSync('client/src/ingest/fixtures', { recursive: true });
writeFileSync('client/src/ingest/fixtures/worksheet.docx', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
