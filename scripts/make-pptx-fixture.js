// Builds client/src/ingest/fixtures/lesson.pptx: three slides, Hebrew and English.
// File names run slide1..3 but the deck order is 3, 1, 2: slide2 is a table, slide3
// carries speaker notes, slide1 is picture-only.
// Run: node scripts/make-pptx-fixture.js
import { mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';

const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const para = (t, rtl) => `<a:p><a:pPr${rtl ? ' rtl="1"' : ''}/><a:r><a:rPr lang="en-US"/><a:t>${esc(t)}</a:t></a:r></a:p>`;
const shape = (id, ph, paras) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s${id}"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
const cell = (t) => `<a:tc><a:txBody><a:bodyPr/>${para(t)}</a:txBody></a:tc>`;
const table = (rows) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid/>${rows
    .map((r) => `<a:tr h="300">${r.map(cell).join('')}</a:tr>`)
    .join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
const picture = '<p:pic><p:nvPicPr><p:cNvPr id="5" name="pic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr/></p:pic>';
const slide = (...children) =>
  `${head}<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${children.join('')}</p:spTree></p:cSld></p:sld>`;
const notes = (t) => `${head}<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${shape(2, 'sldImg', '<a:p/>')}${shape(3, 'body', para(t))}${shape(4, 'sldNum', '<a:p><a:fld id="{1}" type="slidenum"><a:t>3</a:t></a:fld></a:p>')}</p:spTree></p:cSld></p:notes>`;
const rels = (...items) =>
  `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
    .join('')}</Relationships>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
zip.file('_rels/.rels', rels(['rId1', 'officeDocument', 'ppt/presentation.xml']));
zip.file('ppt/presentation.xml', `${head}<p:presentation ${NS}><p:sldIdLst><p:sldId id="258" r:id="rId3"/><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`);
zip.file('ppt/_rels/presentation.xml.rels', rels(['rId1', 'slide', 'slides/slide1.xml'], ['rId2', 'slide', 'slides/slide2.xml'], ['rId3', 'slide', 'slides/slide3.xml']));

// Deck order 1: slide3.xml, with notes. Mixed Hebrew and English, a footer and slide number to ignore.
zip.file('ppt/slides/slide3.xml', slide(
  shape(2, 'ctrTitle', para('Photosynthesis')),
  shape(3, 'subTitle', para('How plants make sugar') + para('צמחים הופכים אור שמש לסוכר', true)),
  shape(4, 'sldNum', '<a:p><a:fld id="{2}" type="slidenum"><a:t>1</a:t></a:fld></a:p>'),
  shape(5, 'ftr', para('Biology 101')),
));
zip.file('ppt/slides/_rels/slide3.xml.rels', rels(['rId1', 'notesSlide', '../notesSlides/notesSlide1.xml']));
zip.file('ppt/notesSlides/notesSlide1.xml', notes('Remind the class that chlorophyll is green. תזכירו לכיתה שכלורופיל ירוק.'));

// Deck order 2: slide1.xml, a picture and a caption too short to read.
zip.file('ppt/slides/slide1.xml', slide(shape(2, 'title', para('Diagram')), picture));

// Deck order 3: slide2.xml, a title and a table.
zip.file('ppt/slides/slide2.xml', slide(
  shape(2, 'title', para('Inputs and outputs · קלט ופלט')),
  table([['Input', 'קלט', 'Output'], ['CO2', 'פחמן דו חמצני', 'Sugar'], ['Water', 'מים', 'Oxygen']]),
));

mkdirSync('client/src/ingest/fixtures', { recursive: true });
writeFileSync('client/src/ingest/fixtures/lesson.pptx', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
